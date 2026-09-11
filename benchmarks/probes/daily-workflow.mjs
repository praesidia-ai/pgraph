// Controlled synthetic workflow diagnostic. Does not execute an application or prove task completion.
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PGraph, bpeCounter } from "../../packages/graph-core/dist/index.js";
import {
  dispatchTool,
  toolDefinitions,
  toolJsonSchema,
} from "../../packages/graph-tools/dist/index.js";
const root = mkdtempSync(join(tmpdir(), "pgraph-daily-probe-"));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const git = (...args) =>
  execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
let graph;
try {
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "package.json"),
    '{"name":"daily-probe","type":"module","scripts":{"test":"echo fixture only"}}',
  );
  writeFileSync(join(root, ".gitignore"), ".pgraph/\n");
  const source =
    Array.from(
      { length: 20 },
      (_, i) =>
        `export function op${i}(value: number) { if(value<0) throw new Error('invalid amount ${i}'); return value + ${i}; }`,
    ).join("\n") + "\n";
  writeFileSync(join(root, "src/operations.ts"), source);
  for (let i = 0; i < 20; i++)
    writeFileSync(
      join(root, `src/consumer${i}.ts`),
      `import { op${i} } from './operations.js'; export function consumer${i}() { return op${i}(1); }\n`,
    );
  git("init");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "fixture",
  );
  graph = PGraph.open(root);
  graph.index();
  writeFileSync(
    join(root, "src/operations.ts"),
    source.replace("return value + 7;", "return value * 7;"),
  );
  graph.index();
  const call = (name, input) => {
    const start = performance.now(),
      output = dispatchTool(graph, name, input);
    return {
      inputTokens: bpeCounter.count(JSON.stringify({ name, input })),
      outputTokens: bpeCounter.count(output),
      latencyMs: performance.now() - start,
      data: JSON.parse(output),
    };
  };
  const broad = call("review_changes", { maxTokens: 8000 });
  const changed = call("workflow", { action: "changes", maxTokens: 2000 });
  const target = changed.data.declarations?.find((d) => d.node.symbol === "op7")
    ?.node.id;
  if (!target) throw new Error("Edited target was not mapped");
  const impact = call("impact", { symbol: target, maxTokens: 3000 });
  const text = call("workflow", {
    action: "text",
    query: "invalid amount 7",
    maxTokens: 800,
  });
  const health = call("workflow", { action: "health", maxTokens: 1000 });
  const schemaTokens = bpeCounter.count(
    JSON.stringify(
      toolDefinitions.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: toolJsonSchema(t.name),
      })),
    ),
  );
  const report = {
    generatedAt: new Date().toISOString(),
    version: JSON.parse(readFileSync("package.json", "utf8")).version,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    fixtureHash: hash(source),
    workerHash: hash(readFileSync("apps/vscode-extension/dist/worker.cjs")),
    tokenizer: bpeCounter.name,
    declaredToolSchemaTokens: schemaTokens,
    methodology:
      "Same current engine and identical indexed fixture for existing file-level review versus hunk mapping plus targeted impact. Twenty independent functions share a file; one is edited. Compares exact tool responses and JSON request envelopes; new global tool schema cost is reported separately. Names are explicit oracle knowledge, not blind search. This is a favorable constructed case for hunk mapping; no removed symbols, runtime dispatch, application execution, model calls or completed-task acceptance are measured. Timings are single-run diagnostics.",
    comparison: {
      fileReviewAffected: broad.data.affected?.map((r) => r.node.symbol),
      hunkTargets: changed.data.declarations.map((d) => d.node.symbol),
      targetedAffected: impact.data.likelyChangeSurface?.map(
        (r) => r.node.symbol,
      ),
      existingTrafficTokens: broad.inputTokens + broad.outputTokens,
      focusedTrafficTokens:
        changed.inputTokens +
        changed.outputTokens +
        impact.inputTokens +
        impact.outputTokens,
    },
    calls: {
      fileReview: broad,
      changedDeclarations: changed,
      targetedImpact: impact,
      literalSearch: text,
      health,
    },
  };
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({ comparison: report.comparison, schemaTokens }, null, 2),
  );
} finally {
  graph?.close();
  rmSync(root, { recursive: true, force: true });
}
