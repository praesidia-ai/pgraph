// Freeze BEFORE editing an engine, then compare both engines on that same graph/source.
// node benchmarks/probes/selection-quality.mjs freeze /tmp/pgraph-selection-snapshot
// node benchmarks/probes/selection-quality.mjs compare /tmp/pgraph-selection-snapshot report.json
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  readdirSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { ContextEngine } from "../../packages/graph-context/dist/index.js";
import { GraphQuery } from "../../packages/graph-query/dist/index.js";
import { GraphIndexer } from "../../packages/graph-indexer/dist/index.js";
import { SqliteGraphStore } from "../../packages/graph-store-sqlite/dist/index.js";
import { loadConfig } from "../../packages/shared/dist/index.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const repo = process.cwd();
const [mode, directory, output] = process.argv.slice(2);
if (!directory || !["freeze", "compare"].includes(mode))
  throw Error(
    "Use freeze SNAPSHOT_DIRECTORY or compare SNAPSHOT_DIRECTORY REPORT_JSON",
  );
const snapshotDir = resolve(directory);
const file = (path) => join(snapshotDir, path);
const jsFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? jsFiles(path)
      : path.endsWith(".js")
        ? [path]
        : [];
  });
const fingerprint = (dir) =>
  hash(
    JSON.stringify(
      jsFiles(dir)
        .sort()
        .map((path) => [relative(dir, path), hash(readFileSync(path))]),
    ),
  );
const engineFingerprint = (base) =>
  hash(
    JSON.stringify(
      ["graph-context", "graph-ranking"].map((pkg) => [
        pkg,
        fingerprint(join(base, pkg)),
      ]),
    ),
  );
function linkDependencies() {
  const base = file("baseline/node_modules");
  mkdirSync(join(base, "@praesidia"), { recursive: true });
  for (const pkg of [
    "graph-ir",
    "graph-store",
    "graph-query",
    "graph-ranking",
    "shared",
  ]) {
    const name = `pgraph-${pkg === "shared" ? pkg : pkg.slice(6)}`;
    const link = join(base, "@praesidia", name);
    if (!existsSync(link))
      symlinkSync(
        pkg === "graph-ranking"
          ? file("baseline/graph-ranking")
          : join(repo, "packages", pkg),
        link,
        "dir",
      );
  }
  for (const pkg of ["js-tiktoken", "stemmer"]) {
    const link = join(base, pkg);
    if (!existsSync(link))
      symlinkSync(join(repo, "node_modules", pkg), link, "dir");
  }
}
if (mode === "freeze") {
  if (existsSync(snapshotDir))
    throw Error("Use a new directory; snapshots are never overwritten");
  mkdirSync(file("corpus"), { recursive: true });
  const config = loadConfig(repo);
  config.exclude.push("benchmarks/probes/**");
  const store = new SqliteGraphStore(file("graph.db"));
  let indexing, files;
  try {
    indexing = new GraphIndexer(repo, store, config).index();
    files = store.files().map((record) => {
      const source = readFileSync(join(repo, record.path));
      if (hash(source) !== record.hash)
        throw Error(`Source changed: ${record.path}`);
      mkdirSync(dirname(file(`corpus/${record.path}`)), { recursive: true });
      writeFileSync(file(`corpus/${record.path}`), source);
      return { path: record.path, hash: record.hash };
    });
  } finally {
    store.close();
  }
  for (const pkg of ["graph-context", "graph-ranking"]) {
    cpSync(join(repo, "packages", pkg, "dist"), file(`baseline/${pkg}`), {
      recursive: true,
    });
    writeFileSync(
      file(`baseline/${pkg}/package.json`),
      '{"type":"module","main":"index.js"}',
    );
  }
  const tasks = JSON.parse(
    readFileSync("benchmarks/reports/v2-natural-language-probe.json"),
  ).results;
  const snapshot = {
    createdAt: new Date().toISOString(),
    files,
    indexing,
    corpusHash: hash(JSON.stringify(files)),
    graphHash: hash(readFileSync(file("graph.db"))),
    baselineEngineHash: engineFingerprint(file("baseline")),
    sharedQueryHash: fingerprint("packages/graph-query/dist"),
    scenarios: tasks.map((task) => ({
      id: task.id,
      cohort: "known self-repository diagnostic",
      request: {
        task: task.naturalLanguage.task,
        maxTokens: task.maxTokens,
        options: { format: "markdown" },
      },
      requiredSymbols: task.requiredSymbols,
    })),
  };
  writeFileSync(file("snapshot.json"), JSON.stringify(snapshot, null, 2));
  console.log(
    JSON.stringify({
      snapshotDir,
      files: files.length,
      corpusHash: snapshot.corpusHash,
    }),
  );
} else {
  if (!output) throw Error("Report path required");
  const snapshot = JSON.parse(readFileSync(file("snapshot.json")));
  for (const record of snapshot.files)
    if (hash(readFileSync(file(`corpus/${record.path}`))) !== record.hash)
      throw Error(`Snapshot source changed: ${record.path}`);
  if (snapshot.graphHash !== hash(readFileSync(file("graph.db"))))
    throw Error("Snapshot graph changed");
  if (snapshot.sharedQueryHash !== fingerprint("packages/graph-query/dist"))
    throw Error(
      "Shared source/graph query implementation changed; this comparison no longer isolates selection",
    );
  // Do not traverse node_modules symlinks when fingerprinting the saved engine.
  const baselineHash = engineFingerprint(file("baseline"));
  if (baselineHash !== snapshot.baselineEngineHash)
    throw Error("Saved baseline engine changed");
  linkDependencies();
  const { ContextEngine: Baseline } = await import(
    pathToFileURL(file("baseline/graph-context/index.js")).href
  );
  const store = new SqliteGraphStore(file("graph.db"), { readOnly: true });
  const query = new GraphQuery(store, file("corpus"));
  const baseline = new Baseline(store, query);
  let trace;
  const current = new ContextEngine(store, query, undefined, (value) => {
    trace = value;
  });
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    corpusHash: snapshot.corpusHash,
    graphHash: snapshot.graphHash,
    baselineHash,
    currentHash: hash(
      JSON.stringify(
        ["graph-context", "graph-ranking"].map((pkg) => [
          pkg,
          fingerprint(join("packages", pkg, "dist")),
        ]),
      ),
    ),
    method:
      "Both library engines use the identical frozen graph, verified source files, requests, tokenizer and shared GraphQuery. Current selection has a local diagnostic hook, absent from response text. One untimed warm-up primes each tokenizer. This isolates selection, not indexing or extension IPC. Ten inherited self-repository name oracles are known development diagnostics, not held-out task correctness or billing. Additional cohorts, if present, are reported separately. Latency is a single warm-tokenizer observation, not a performance benchmark.",
    files: snapshot.files,
    results: [],
    summary: {},
  };
  try {
    baseline.counter.count("warm-up");
    current.counter.count("warm-up");
    for (const scenario of snapshot.scenarios) {
      const required = scenario.requiredSymbols.map((symbol) =>
        query.symbol(symbol),
      );
      const row = { ...scenario };
      for (const [version, engine] of [
        ["baseline", baseline],
        ["current", current],
      ]) {
        const result = engine.context(scenario.request);
        row[version] = {
          tokens: result.metrics.contextTokens,
          latencyMs: result.metrics.latencyMs,
          selected: result.package.symbols.map(
            ({ id, symbol, representation }) => ({
              id,
              symbol,
              representation,
            }),
          ),
          warnings: result.package.warnings,
          targets: required.map((node) => ({
            symbol: node.qualifiedName,
            id: node.id,
            representation:
              result.package.symbols.find((s) => s.id === node.id)
                ?.representation ?? null,
            ...(version === "current"
              ? {
                  diagnostic: trace.candidates.find(
                    (candidate) => candidate.id === node.id,
                  ) ?? { stage: "not retrieved" },
                }
              : {}),
          })),
        };
        if (result.metrics.contextTokens > scenario.request.maxTokens)
          throw Error("Budget exceeded");
      }
      report.results.push(row);
    }
    for (const cohort of new Set(report.results.map((row) => row.cohort))) {
      report.summary[cohort] = Object.fromEntries(
        ["baseline", "current"].map((version) => {
          const rows = report.results.filter((row) => row.cohort === cohort);
          const targets = rows.flatMap((row) => row[version].targets);
          return [
            version,
            {
              requiredTargets: targets.length,
              selectedTargets: targets.filter((target) => target.representation)
                .length,
              implementationTargets: targets.filter((target) =>
                ["source", "excerpt"].includes(target.representation),
              ).length,
              allTargetsSelected: rows.filter((row) =>
                row[version].targets.every((target) => target.representation),
              ).length,
              tasks: rows.length,
              totalOutputTokens: rows.reduce(
                (sum, row) => sum + row[version].tokens,
                0,
              ),
            },
          ];
        }),
      );
    }
    writeFileSync(resolve(output), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.summary));
  } finally {
    store.close();
  }
}
