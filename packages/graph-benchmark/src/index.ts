import { PGraph, bpeCounter } from "@praesidia/pgraph-core";
import { readLocal, hash } from "@praesidia/pgraph-shared";

export interface BenchmarkScenario {
  id: string;
  category: string;
  task: string;
  baselineFiles: string[];
  baselineSearchCalls: number;
  requiredSymbols: string[];
  maxTokens: number;
}
export interface BenchmarkResult {
  id: string;
  category: string;
  task: string;
  repositoryFingerprint: string;
  baseline: {
    filesOpened: number;
    sourceLines: number;
    repositoryTokens: number;
    toolCalls: number;
    workflow: "declared-file-open-trace";
  };
  pgraph: {
    filesOpened: number;
    symbols: string[];
    sourceLines: number;
    repositoryTokens: number;
    toolCalls: number;
    latencyMs: number;
  };
  tokenReductionPercent: number;
  fileReadReductionPercent: number;
  toolCallReductionPercent: number;
  requiredSymbolRecall: number;
  missingSymbols: string[];
  taskCorrectness: null;
  taskCompletion: null;
}
export function runBenchmark(
  root: string,
  scenarios: BenchmarkScenario[],
): {
  version: 1;
  tokenizer: string;
  results: BenchmarkResult[];
  summary: Record<string, unknown>;
} {
  const graph = PGraph.open(root);
  try {
    const indexing = graph.index();
    const fingerprint = hash(
      graph.store
        .files()
        .map((f) => `${f.path}:${f.hash}`)
        .sort()
        .join("\n"),
    );
    const results: BenchmarkResult[] = scenarios.map((scenario) => {
      if (!scenario.requiredSymbols.length || !scenario.baselineFiles.length)
        throw new Error(
          "Benchmarks need baseline files and a required-symbol oracle",
        );
      const baselineFiles = [...new Set(scenario.baselineFiles)];
      const source = baselineFiles.map((f) => readLocal(root, f));
      const rawTokens = source.reduce((n, s) => n + bpeCounter.count(s), 0);
      const lines = source.reduce((n, s) => n + s.split("\n").length, 0);
      const context = graph.context({
        task: scenario.task,
        maxTokens: scenario.maxTokens,
        options: { format: "markdown" },
      });
      const supplied = context.package.symbols.map((s) => s.symbol);
      const missing = scenario.requiredSymbols.filter(
        (s) => !supplied.includes(s),
      );
      const snippets = context.package.symbols.filter(
        (s) => s.representation === "source",
      );
      const filesRead = new Set(
        snippets.map((s) => s.at.replace(/:\d+-\d+$/, "")),
      ).size;
      const baselineCalls = baselineFiles.length + scenario.baselineSearchCalls;
      return {
        id: scenario.id,
        category: scenario.category,
        task: scenario.task,
        repositoryFingerprint: fingerprint,
        baseline: {
          filesOpened: baselineFiles.length,
          sourceLines: lines,
          repositoryTokens: rawTokens,
          toolCalls: baselineCalls,
          workflow: "declared-file-open-trace",
        },
        pgraph: {
          filesOpened: filesRead,
          symbols: supplied,
          sourceLines: snippets.reduce(
            (n, s) => n + s.text.split("\n").length,
            0,
          ),
          repositoryTokens: context.metrics.contextTokens,
          toolCalls: 1,
          latencyMs: context.metrics.latencyMs,
        },
        tokenReductionPercent: Number(
          ((1 - context.metrics.contextTokens / rawTokens) * 100).toFixed(2),
        ),
        fileReadReductionPercent: Number(
          ((1 - filesRead / baselineFiles.length) * 100).toFixed(2),
        ),
        toolCallReductionPercent: Number(
          ((1 - 1 / baselineCalls) * 100).toFixed(2),
        ),
        requiredSymbolRecall:
          (scenario.requiredSymbols.length - missing.length) /
          scenario.requiredSymbols.length,
        missingSymbols: missing,
        taskCorrectness: null,
        taskCompletion: null,
      };
    });
    const baseline = results.reduce(
      (n, r) => n + r.baseline.repositoryTokens,
      0,
    );
    const supplied = results.reduce((n, r) => n + r.pgraph.repositoryTokens, 0);
    return {
      version: 1,
      tokenizer: bpeCounter.name,
      results,
      summary: {
        scenarios: results.length,
        indexing,
        weightedTokenReductionPercent: baseline
          ? Number(((1 - supplied / baseline) * 100).toFixed(2))
          : 0,
        allRequiredSymbolsRetrieved: results.every(
          (r) => r.requiredSymbolRecall === 1,
        ),
        correctnessEvaluated: false,
        claim:
          "Retrieval benchmark only. Paired coding-agent correctness and representative medium/large repository KPI remain unproven.",
      },
    };
  } finally {
    graph.close();
  }
}
export function validateScenarios(value: unknown): BenchmarkScenario[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("Suite must be an array of at most 100 scenarios");
  return value.map((v) => {
    if (!v || typeof v !== "object") throw new Error("Invalid scenario");
    const d = v as Record<string, unknown>;
    for (const key of ["id", "category", "task"])
      if (typeof d[key] !== "string" || String(d[key]).length > 4000)
        throw new Error(`Invalid ${key}`);
    for (const key of ["baselineFiles", "requiredSymbols"])
      if (
        !Array.isArray(d[key]) ||
        !(d[key] as unknown[]).every((s) => typeof s === "string") ||
        (d[key] as unknown[]).length > 500
      )
        throw new Error(`Invalid ${key}`);
    if (
      !Number.isSafeInteger(d.maxTokens) ||
      Number(d.maxTokens) < 128 ||
      Number(d.maxTokens) > 32000 ||
      !Number.isSafeInteger(d.baselineSearchCalls) ||
      Number(d.baselineSearchCalls) < 0
    )
      throw new Error("Invalid benchmark budget/call count");
    return d as unknown as BenchmarkScenario;
  });
}
