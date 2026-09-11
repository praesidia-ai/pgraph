// Diagnostic retrieval probe, not an independent coding-task evaluation.
// Run from the repository root after npm run build:
// node benchmarks/probes/natural-language.mjs [output.json]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PGraph } from "../../packages/graph-core/dist/index.js";
import { SqliteGraphStore } from "../../packages/graph-store-sqlite/dist/index.js";
import { GraphIndexer } from "../../packages/graph-indexer/dist/index.js";
import { loadConfig } from "../../packages/shared/dist/index.js";

const paraphrases = {
  locate:
    "Where is the code that selects relevant symbols for a task within a token budget?",
  flow: "Explain how repository indexing parses TypeScript and stores the resulting relationships in SQLite.",
  architecture:
    "Explain how opening a repository connects the database, queries and context engine.",
  impact:
    "What could break if symbol lookup changes its handling of ambiguous names?",
  debug:
    "Why does reading an indexed implementation reject source that has changed on disk?",
  single:
    "Improve how the context budget chooses between summaries, signatures and implementation source.",
  multi:
    "Add a new query tool available to both coding agents and editor users.",
  monorepo:
    "How are workspace path aliases resolved when parsing multiple TypeScript projects?",
  tests:
    "Find tests for rejecting stale implementation reads and selecting task-specific context.",
  refactor:
    "Refactor database neighbor queries and dependency path traversal together.",
};

const root = process.cwd();
const graph = PGraph.open(root, { store: new SqliteGraphStore(":memory:") });
try {
  // Keep the probe's own implementation out of the retrieval corpus.
  const config = loadConfig(root);
  config.exclude = [...config.exclude, "benchmarks/probes/**"];
  const indexing = new GraphIndexer(root, graph.store, config).index();
  const scenarios = JSON.parse(readFileSync("benchmarks/self.json", "utf8"));
  const results = scenarios.map((scenario) => {
    const run = (task) => {
      const result = graph.context({
        task,
        maxTokens: scenario.maxTokens,
        options: { format: "markdown" },
      });
      const symbols = result.package.symbols.map((symbol) => symbol.symbol);
      const missing = scenario.requiredSymbols.filter(
        (symbol) => !symbols.includes(symbol),
      );
      return {
        task,
        symbols,
        missing,
        recall:
          (scenario.requiredSymbols.length - missing.length) /
          scenario.requiredSymbols.length,
        tokens: result.metrics.contextTokens,
        sourceSlices: result.metrics.sourceSlices,
        tests: result.package.tests,
        latencyMs: result.metrics.latencyMs,
      };
    };
    return {
      id: scenario.id,
      maxTokens: scenario.maxTokens,
      requiredSymbols: scenario.requiredSymbols,
      identifierAssisted: run(scenario.task),
      naturalLanguage: run(paraphrases[scenario.id]),
    };
  });
  const totalRequired = results.reduce(
    (sum, result) => sum + result.requiredSymbols.length,
    0,
  );
  const summarize = (key) => ({
    fullRecallTasks: results.filter(
      (result) => result[key].missing.length === 0,
    ).length,
    totalTasks: results.length,
    retrievedRequired:
      totalRequired -
      results.reduce((sum, result) => sum + result[key].missing.length, 0),
    totalRequired,
    sourceSlices: results.reduce(
      (sum, result) => sum + result[key].sourceSlices,
      0,
    ),
  });
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    repositoryFingerprint: createHash("sha256")
      .update(
        graph.store
          .files()
          .map((file) => `${file.path}:${file.hash}`)
          .sort()
          .join("\n"),
      )
      .digest("hex"),
    methodology:
      "One manually authored paraphrase for each existing self-suite task; same required-symbol oracle and token budget; Markdown output; fresh in-memory SQLite graph; no semantic enrichment; benchmarks/probes excluded from indexing to avoid self-contamination. Diagnostic only: paraphrases and oracles are not independently validated, and timings are single-run with warm-cache/order effects. No agent edits, tests or task-correctness measurement.",
    indexing,
    summary: {
      identifierAssisted: summarize("identifierAssisted"),
      naturalLanguage: summarize("naturalLanguage"),
    },
    results,
  };
  if (process.argv[2])
    writeFileSync(
      resolve(process.argv[2]),
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(
    JSON.stringify(
      {
        summary: report.summary,
        results: results.map(({ id, naturalLanguage }) => ({
          id,
          recall: naturalLanguage.recall,
          missing: naturalLanguage.missing,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  graph.close();
}
