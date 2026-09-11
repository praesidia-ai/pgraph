// Research diagnostic: observe public retrieval calls without changing engine behavior.
// Run from the repository root after building: node benchmarks/probes/retrieval-funnel.mjs [report.json]
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PGraph } from "../../packages/graph-core/dist/index.js";
import { SqliteGraphStore } from "../../packages/graph-store-sqlite/dist/index.js";
import { GraphIndexer } from "../../packages/graph-indexer/dist/index.js";
import { loadConfig } from "../../packages/shared/dist/index.js";

const root = process.cwd();
const fingerprint = (files) =>
  createHash("sha256").update(files.sort().join("\n")).digest("hex");
const jsFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? jsFiles(path)
      : path.endsWith(".js")
        ? [path]
        : [];
  });
const graph = PGraph.open(root, { store: new SqliteGraphStore(":memory:") });
const previous = JSON.parse(
  readFileSync("benchmarks/reports/v2-natural-language-probe.json", "utf8"),
);
const config = loadConfig(root);
config.exclude = [...config.exclude, "benchmarks/probes/**"];
const category = (file) =>
  file.startsWith("examples/")
    ? "example"
    : /(^|\/)(tests|__tests__)\/|\.(spec|test)\./.test(file)
      ? "test"
      : "implementation";

function observe(task, maxTokens, focus) {
  const searched = new Map(),
    traversed = new Set();
  let phase = "retrieval";
  const search = graph.store.search,
    neighbors = graph.store.neighbors,
    skeleton = graph.skeleton;
  graph.store.search = function (...args) {
    const nodes = search.apply(this, args);
    nodes.forEach((node, position) => {
      const records = searched.get(node.id) ?? [];
      records.push({ query: args[0], position: position + 1 });
      searched.set(node.id, records);
    });
    return nodes;
  };
  graph.store.neighbors = function (...args) {
    const results = neighbors.apply(this, args);
    if (phase === "retrieval")
      results.forEach(({ node }) => traversed.add(node.id));
    return results;
  };
  graph.skeleton = function (...args) {
    phase = "representation";
    return skeleton.apply(this, args);
  };
  try {
    const result = graph.context({
      task,
      maxTokens,
      options: { format: "markdown", ...(focus ? { focus } : {}) },
    });
    return {
      request: { task, maxTokens, ...(focus ? { focus } : {}) },
      tokens: result.metrics.contextTokens,
      latencyMs: result.metrics.latencyMs,
      selected: result.package.symbols.map(
        ({ id, symbol, at, representation, reasons }) => ({
          id,
          symbol,
          at,
          representation,
          reasons,
        }),
      ),
      selectedCategories: result.package.symbols.reduce((counts, symbol) => {
        const kind = category(
          graph.store.node(symbol.id)?.location?.file ?? "",
        );
        counts[kind] = (counts[kind] ?? 0) + 1;
        return counts;
      }, {}),
      tests: result.package.tests,
      warnings: result.package.warnings,
      searched,
      traversed,
    };
  } finally {
    graph.store.search = search;
    graph.store.neighbors = neighbors;
    graph.skeleton = skeleton;
  }
}

function diagnose(scenario, observed) {
  const { searched, traversed, ...result } = observed;
  return {
    ...result,
    targets: scenario.requiredSymbols.map((name) => {
      const nodes = graph.store.resolve(name);
      const selected = result.selected.filter((symbol) =>
        nodes.some((node) => node.id === symbol.id),
      );
      return {
        name,
        indexed: nodes.map((node) => ({
          id: node.id,
          file: node.location?.file,
          lines: node.location
            ? node.location.endLine - node.location.startLine + 1
            : 0,
          shortSourceEligible:
            !!node.location &&
            node.location.endLine - node.location.startLine < 180,
        })),
        searchHits: nodes.flatMap((node) => searched.get(node.id) ?? []),
        seenInRetrievalTraversal: nodes.some((node) => traversed.has(node.id)),
        selected: selected.map(({ id, representation }) => ({
          id,
          representation,
        })),
      };
    }),
  };
}

let report;
try {
  const indexing = new GraphIndexer(root, graph.store, config).index();
  const scenarios = previous.results.map((scenario) => {
    const anchor = graph.symbol(scenario.requiredSymbols[0]);
    const task = scenario.naturalLanguage.task;
    return {
      id: scenario.id,
      normal: diagnose(scenario, observe(task, scenario.maxTokens)),
      largerBudget: diagnose(scenario, observe(task, 6000)),
      knownTargetAnchor: diagnose(
        scenario,
        observe(task, scenario.maxTokens, {
          file: anchor.location.file,
          line: anchor.location.startLine,
        }),
      ),
      identifierAssisted: diagnose(
        scenario,
        observe(scenario.identifierAssisted.task, scenario.maxTokens),
      ),
    };
  });
  const summary = {};
  for (const mode of [
    "normal",
    "largerBudget",
    "knownTargetAnchor",
    "identifierAssisted",
  ]) {
    const targets = scenarios.flatMap((scenario) => scenario[mode].targets);
    summary[mode] = {
      retrievedRequired: targets.filter((target) => target.selected.length)
        .length,
      totalRequired: targets.length,
      fullRecallTasks: scenarios.filter((scenario) =>
        scenario[mode].targets.every((target) => target.selected.length),
      ).length,
      totalTasks: scenarios.length,
      selectedAsSource: targets.filter((target) =>
        target.selected.some((symbol) => symbol.representation === "source"),
      ).length,
      missingButReturnedBySearch: targets.filter(
        (target) => !target.selected.length && target.searchHits.length,
      ).length,
      missingButSeenInRetrievalTraversal: targets.filter(
        (target) => !target.selected.length && target.seenInRetrievalTraversal,
      ).length,
      tasksWithSelectedTests: scenarios.filter(
        (scenario) => scenario[mode].tests.length,
      ).length,
    };
  }
  report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    repositoryFingerprint: fingerprint(
      graph.store.files().map((file) => `${file.path}:${file.hash}`),
    ),
    engineFingerprint: fingerprint(
      readdirSync("packages")
        .flatMap((pkg) => jsFiles(`packages/${pkg}/dist`))
        .map(
          (path) =>
            `${path}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`,
        ),
    ),
    dependencyLockFingerprint: createHash("sha256")
      .update(readFileSync("package-lock.json"))
      .digest("hex"),
    configFingerprint: graph.store.getMeta("configHash"),
    methodology:
      "Same fresh in-memory corpus for four request variants. Reuses the existing ten diagnostic prompts and inherited name-based oracles, not held out. Known-target anchors use oracle knowledge and are a control, not a fair automatic-retrieval score. Larger budget changes traversal selection/representation caps as well as available tokens. Wrappers observe search results and neighbor results before representation generation; these are not the final candidate/ranking sets and cannot by themselves identify why a symbol was dropped. Trials do not edit code or execute fixture/application tests. Timings are single-run and order/cache dependent. No models or network calls.",
    indexing,
    summary,
    scenarios,
  };
} finally {
  graph.close();
}

const fixtureRoot = mkdtempSync(join(tmpdir(), "pgraph-dispatch-probe-"));
let fixture;
try {
  writeFileSync(
    join(fixtureRoot, "package.json"),
    '{"name":"dispatch-probe","type":"module"}',
  );
  writeFileSync(
    join(fixtureRoot, "core.ts"),
    `export interface Ledger { save(amount: number): number; }
export class SqlLedger implements Ledger { save(amount: number) { return amount * 2; } }
export function throughInterface(ledger: Ledger, amount: number) { return ledger.save(amount); }
export function directly(amount: number) { return new SqlLedger().save(amount); }
export function injected(amount: number) { return throughInterface(new SqlLedger(), amount); }
`,
  );
  writeFileSync(
    join(fixtureRoot, "core.test.ts"),
    `import { directly, injected } from './core.js';
declare function test(name: string, fn: () => void): void;
test('direct concrete call', () => { directly(3); });
test('injected concrete call', () => { injected(3); });
`,
  );
  fixture = PGraph.open(fixtureRoot, {
    store: new SqliteGraphStore(":memory:"),
  });
  fixture.index();
  report.dispatchProbe = {
    source: readFileSync(join(fixtureRoot, "core.ts"), "utf8"),
    testSource: readFileSync(join(fixtureRoot, "core.test.ts"), "utf8"),
    interfaceCallees: fixture
      .callees("throughInterface")
      .map((node) => node.qualifiedName),
    directCallees: fixture
      .callees("directly")
      .map((node) => node.qualifiedName),
    classImplementations: fixture
      .implementations("Ledger")
      .map((node) => node.qualifiedName),
    memberImplementations: fixture
      .implementations("Ledger.save")
      .map((node) => node.qualifiedName),
    directTestsForMethod: fixture
      .testsFor("SqlLedger.save")
      .map((node) => node.qualifiedName),
    impactTestsForMethod: fixture
      .impact("SqlLedger.save")
      .tests.map((node) => node.qualifiedName),
    impactTestsForInterface: fixture
      .impact("Ledger.save")
      .tests.map((node) => node.qualifiedName),
    note: "Synthetic static extraction probe; fixture tests are indexed, not executed. Implementation membership does not prove runtime receiver identity; the injected call requires a supported receiver/argument flow model.",
  };
} finally {
  fixture?.close();
  rmSync(fixtureRoot, { recursive: true, force: true });
}
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    { summary: report.summary, dispatchProbe: report.dispatchProbe },
    null,
    2,
  ),
);
