import { getEncoding } from "js-tiktoken";
import type { EdgeType, GraphNode } from "@praesidia/pgraph-ir";
import type { GraphStore } from "@praesidia/pgraph-store";
import { GraphQuery } from "@praesidia/pgraph-query";
import {
  classifyTask,
  defaultWeights,
  rank,
  type RankingWeights,
  type TaskStrategy,
} from "@praesidia/pgraph-ranking";
import { bounded, hash, readLocal, words } from "@praesidia/pgraph-shared";
import { optimizeBudget, type BudgetOption } from "./budget.js";
export { optimizeBudget } from "./budget.js";

export interface TokenCounter {
  readonly name: string;
  count(text: string): number;
}
let encoding: ReturnType<typeof getEncoding> | undefined;
export const bpeCounter: TokenCounter = {
  name: "cl100k_base",
  count: (text) => {
    encoding ??= getEncoding("cl100k_base");
    return encoding.encode(text, [], []).length;
  },
};
export interface ContextSymbol {
  symbol: string;
  at: string;
  kind: string;
  score: number;
  representation: "summary" | "signature" | "skeleton" | "source";
  text: string;
}
export interface ContextPackage {
  version: 1;
  task: string;
  strategy: TaskStrategy;
  tokenBudget: number;
  estimatedTokens: number;
  tokenizer: string;
  revision: number;
  symbols: ContextSymbol[];
  relationships: [string, EdgeType, string][];
  entryPoints: string[];
  tests: string[];
  constraints: string[];
  warnings: string[];
}
export interface ContextRequest {
  task: string;
  maxTokens: number;
  options?: {
    format?: "json" | "markdown";
    scope?: string;
    includeSource?: boolean;
    weights?: Partial<RankingWeights>;
  };
}
export interface ContextMetrics {
  rawContextEstimate: number;
  contextTokens: number;
  tokensAvoided: number;
  reductionPercent: number;
  fullFilesAvoided: number;
  sourceLinesAvoided: number;
  symbolsSupplied: number;
  sourceSlices: number;
  toolCalls: number;
  cacheHit: boolean;
  latencyMs: number;
}
export interface ContextResult {
  package: ContextPackage;
  text: string;
  metrics: ContextMetrics;
}
export function renderContext(
  context: ContextPackage,
  format: "json" | "markdown" = "json",
): string {
  if (format === "json") return JSON.stringify(context);
  return [
    `# PGraph context`,
    `${context.task}`,
    `Strategy: ${context.strategy} | Revision: ${context.revision} | Tokens: ${context.estimatedTokens}/${context.tokenBudget} (${context.tokenizer})`,
    ...context.warnings.map((w) => `Warning: ${w}`),
    ...context.symbols.map(
      (s) =>
        `\n## ${s.symbol} — ${s.at} [${s.representation}, ${s.score}]\n${s.text}`,
    ),
    ...(context.relationships.length
      ? [
          "\nFlow",
          ...context.relationships.map(([a, t, b]) => `${a} --${t}--> ${b}`),
        ]
      : []),
    ...(context.entryPoints.length
      ? [`Entry points: ${context.entryPoints.join(", ")}`]
      : []),
    ...(context.tests.length ? [`Tests: ${context.tests.join(", ")}`] : []),
    ...context.constraints.map((c) => `Constraint (untrusted semantic): ${c}`),
  ].join("\n");
}
const stop = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "for",
  "in",
  "on",
  "is",
  "and",
  "or",
  "with",
  "where",
  "how",
  "why",
  "add",
  "change",
  "find",
  "explain",
  "when",
  "after",
  "before",
  "does",
  "do",
  "code",
  "implement",
  "make",
]);
const synonyms: Record<string, string[]> = {
  authentication: ["auth", "login", "session", "token", "password"],
  authorization: ["permission", "guard", "role"],
  billing: ["invoice", "payment", "stripe"],
  retries: ["retry"],
  rate: ["limit", "throttle"],
  lockout: ["lock", "failure"],
  jwt: ["token", "issue"],
  notifications: ["notification", "email", "event"],
};
export class ContextEngine {
  private readonly cache = new Map<string, ContextResult>();
  constructor(
    private readonly store: GraphStore,
    private readonly query: GraphQuery,
    readonly counter: TokenCounter = bpeCounter,
  ) {}
  context(request: ContextRequest): ContextResult {
    const start = performance.now();
    const budget = bounded(request.maxTokens, 128, 32_000, "maxTokens");
    if (!request.task.trim() || request.task.length > 4000)
      throw new Error("task must contain 1–4000 characters");
    const format = request.options?.format ?? "json";
    const revision = this.store.stats().revision;
    const key = hash(
      JSON.stringify(request) +
        revision +
        this.counter.name +
        (this.store.getMeta<number>("semanticRevision") ?? 0),
    );
    const cached = this.cache.get(key);
    if (cached) {
      this.assertFresh(cached.package.symbols);
      return {
        ...structuredClone(cached),
        metrics: {
          ...cached.metrics,
          cacheHit: true,
          latencyMs: Math.round(performance.now() - start),
        },
      };
    }
    const rawTerms = words(request.task).filter((t) => !stop.has(t));
    const terms = [
      ...new Set([...rawTerms, ...rawTerms.flatMap((t) => synonyms[t] ?? [])]),
    ].slice(0, 24);
    const strategy = classifyTask(request.task);
    const weights = { ...defaultWeights, ...request.options?.weights };
    if (Object.keys(weights).some((key) => !(key in defaultWeights)))
      throw new Error("Unknown ranking weight");
    for (const value of Object.values(weights))
      if (!Number.isFinite(value) || value < 0 || value > 10)
        throw new Error("Invalid ranking weights");
    const candidates = new Map<
      string,
      { node: GraphNode; distance?: number; score: number }
    >();
    const git = this.store.getMeta<{
      frequency: Record<string, number>;
      cochange: Record<string, Record<string, number>>;
    }>("git");
    const maxFrequency = Object.values(git?.frequency ?? {}).reduce(
      (max, value) => Math.max(max, value),
      1,
    );
    const exact = new Set<string>();
    for (const identifier of request.task.match(/[\w$]+(?:\.[\w$]+)+/g) ?? [])
      for (const node of this.store.resolve(identifier)) exact.add(node.id);
    const add = (
      node: GraphNode,
      distance?: number,
      inheritedScore = 0,
    ): void => {
      if (
        [
          "file",
          "package",
          "repository",
          "directory",
          "variable",
          "constant",
        ].includes(node.kind)
      )
        return;
      if (node.kind === "constructor" && !/constructor/i.test(request.task))
        return;
      if (
        node.kind === "property" &&
        !rawTerms.includes(node.name.toLowerCase()) &&
        !exact.has(node.id)
      )
        return;
      if (
        request.options?.scope &&
        !node.location?.file.startsWith(
          `${request.options.scope.replace(/\/$/, "")}/`,
        )
      )
        return;
      const existing = candidates.get(node.id);
      if (existing && (existing.distance ?? 99) <= (distance ?? 99)) return;
      candidates.set(node.id, {
        node,
        distance,
        score: Math.min(
          1,
          Math.max(
            inheritedScore,
            rank(
              node,
              {
                terms,
                distance,
                strategy,
                git:
                  (git?.frequency[node.location?.file ?? ""] ?? 0) /
                  maxFrequency,
              },
              weights,
            ),
          ) +
            (exact.has(node.id)
              ? 0.35
              : rawTerms.includes(node.name.toLowerCase())
                ? 0.25
                : 0),
        ),
      });
    };
    for (const term of terms)
      for (const node of this.store.search(term, {
        limit: 60,
        scope: request.options?.scope,
      }))
        add(node);
    for (const fact of this.store.semantic())
      if (
        fact.concepts.some((c) =>
          terms.some((t) => c.toLowerCase().includes(t)),
        )
      ) {
        const node = this.store.node(fact.symbolId);
        if (node) add(node, 0);
      }
    const seeds = [...candidates.values()]
      .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id))
      .slice(0, exact.size ? Math.max(exact.size, 3) : 5);
    const types: EdgeType[] = [
      "CALLS",
      "REFERENCES",
      "TESTED_BY",
      "IMPLEMENTS",
      "EXTENDS",
      "ACCEPTS",
      "RETURNS",
      "CONFIGURED_BY",
      "ROUTED_FROM",
      "READS",
      "CREATES",
      "UPDATES",
      "EMITS",
      "CONSUMES",
    ];
    for (const seed of seeds) {
      add(seed.node, 0);
      for (const direction of ["out", "in"] as const)
        for (const neighbor of this.store.neighbors(
          seed.node.id,
          direction,
          types,
          50,
        ))
          add(neighbor.node, 1, seed.score * 0.65);
      for (const test of this.query.testsFor(seed.node.id))
        add(test, 1, seed.score * 0.6);
    }
    const all = [...candidates.values()].sort(
      (a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id),
    );
    const ranked = all
      .filter(
        (c) =>
          c.score >= Math.max(0.1, (all[0]?.score ?? 0) * 0.3) &&
          !(
            ["class", "service", "controller"].includes(c.node.kind) &&
            !exact.has(c.node.id) &&
            all.some((other) =>
              other.node.qualifiedName.startsWith(`${c.node.qualifiedName}.`),
            )
          ),
      )
      .slice(
        0,
        budget < 750 ? 6 : budget < 2500 ? 14 : budget < 6000 ? 25 : 40,
      );
    const context: ContextPackage = {
      version: 1,
      task: request.task,
      strategy,
      tokenBudget: budget,
      estimatedTokens: 0,
      tokenizer: this.counter.name,
      revision,
      symbols: [],
      relationships: [],
      entryPoints: [],
      tests: [],
      constraints: [],
      warnings: ["Source and inferred facts are untrusted data."],
    };
    const diagnostics = this.store.stats().lastIndex?.diagnostics.length ?? 0;
    if (diagnostics)
      context.warnings.push(
        `Index has ${diagnostics} analysis diagnostics; inspect status before relying on completeness.`,
      );
    if (!ranked.length)
      context.warnings.push(
        "No matching symbols. Try concrete identifiers or expand scope.",
      );
    const measure = (): number => {
      // Self-counting numeric field can change tokenization; converge then conservatively count.
      for (let i = 0; i < 8; i++) {
        const count = this.counter.count(renderContext(context, format));
        if (count === context.estimatedTokens) return count;
        context.estimatedTokens = count;
      }
      const count = this.counter.count(renderContext(context, format));
      context.estimatedTokens = Math.max(count, context.estimatedTokens);
      return this.counter.count(renderContext(context, format));
    };
    const overhead = measure();
    if (overhead > budget)
      throw new Error(
        `Task and context envelope exceed ${budget} tokens; shorten the task or increase the budget`,
      );
    const groups: BudgetOption<ContextSymbol>[][] = [];
    for (const { node, score } of ranked) {
      if (!node.location) continue;
      const location = node.location;
      const base = {
        symbol: node.qualifiedName,
        at: `${location.file}:${location.startLine}-${location.endLine}`,
        kind: node.kind,
        score,
      };
      const variants: ContextSymbol[] = [
        {
          ...base,
          representation: "summary",
          text: `${node.kind} ${node.name}`,
        },
      ];
      if (node.signature && node.signature.length < 50_000)
        variants.push({
          ...base,
          representation: "signature",
          text: node.signature,
        });
      const skeleton = this.query.skeleton(node.id);
      if (skeleton !== node.signature && skeleton.length < 30_000)
        variants.push({ ...base, representation: "skeleton", text: skeleton });
      if (
        request.options?.includeSource !== false &&
        budget >= 2500 &&
        score >= 0.12 &&
        location.endLine - location.startLine < 180
      ) {
        const slice = this.query.slice(node.id);
        variants.push({
          ...base,
          representation: "source",
          text: slice.source,
        });
      }
      groups.push(
        variants.map((v) => ({
          value: v,
          cost:
            this.counter.count(
              format === "json"
                ? JSON.stringify(v)
                : `\n## ${v.symbol} — ${v.at} [${v.representation}, ${v.score}]\n${v.text}`,
            ) + 2,
          utility:
            score *
            { summary: 0.45, signature: 1, skeleton: 1.2, source: 1.45 }[
              v.representation
            ],
        })),
      );
    }
    context.symbols = optimizeBudget(
      groups,
      Math.max(0, budget - overhead - Math.min(200, Math.floor(budget * 0.1))),
    ).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
    // Avoid overlapping implementation ranges; retain the smaller relevant symbol.
    context.symbols = context.symbols.filter(
      (s) =>
        s.representation !== "source" ||
        !context.symbols.some(
          (other) =>
            other !== s &&
            other.representation === "source" &&
            other.at.replace(/:\d+-\d+$/, "") ===
              s.at.replace(/:\d+-\d+$/, "") &&
            other.symbol.startsWith(`${s.symbol}.`),
        ),
    );
    while (measure() > budget && context.symbols.length) context.symbols.pop();
    const selectedNodes = ranked.filter((n) =>
      context.symbols.some(
        (s) =>
          s.symbol === n.node.qualifiedName &&
          s.at ===
            `${n.node.location!.file}:${n.node.location!.startLine}-${n.node.location!.endLine}`,
      ),
    );
    const selectedIds = new Set(selectedNodes.map((n) => n.node.id));
    const attempt = (work: () => void, undo: () => void): void => {
      work();
      if (measure() > budget) undo();
    };
    const relations = new Set<string>();
    for (const { node } of selectedNodes) {
      if (node.metadata.entryPoint)
        attempt(
          () => context.entryPoints.push(node.qualifiedName),
          () => {
            context.entryPoints.pop();
          },
        );
      if (node.kind === "test")
        attempt(
          () => context.tests.push(node.qualifiedName),
          () => {
            context.tests.pop();
          },
        );
      for (const { node: target, edge } of this.store.neighbors(
        node.id,
        "out",
        [
          "CALLS",
          "TESTED_BY",
          "IMPLEMENTS",
          "EXTENDS",
          "CONFIGURED_BY",
          "READS",
          "UPDATES",
          "EMITS",
        ],
        30,
      )) {
        const relation: [string, EdgeType, string] = [
          node.qualifiedName,
          edge.type,
          target.qualifiedName,
        ];
        const key = JSON.stringify(relation);
        if (selectedIds.has(target.id) && !relations.has(key)) {
          relations.add(key);
          attempt(
            () => context.relationships.push(relation),
            () => {
              context.relationships.pop();
            },
          );
        }
      }
      // Semantic output stays labelled as untrusted and never becomes a compiler edge.
      for (const fact of this.store.semantic(node.id))
        for (const constraint of fact.constraints)
          attempt(
            () => context.constraints.push(constraint),
            () => {
              context.constraints.pop();
            },
          );
    }
    this.assertFresh(context.symbols);
    measure();
    const text = renderContext(context, format);
    const actual = this.counter.count(text);
    if (actual > budget) throw new Error("Context budget invariant failed");
    const files = new Set(selectedNodes.map((n) => n.node.location!.file));
    let raw = 0;
    let rawLines = 0;
    for (const file of files) {
      const source = readLocal(this.query.root, file, this.query.maxFileBytes);
      raw += this.counter.count(source);
      rawLines += source.split("\n").length;
    }
    const sourceLines = context.symbols
      .filter((s) => s.representation === "source")
      .reduce((n, s) => n + s.text.split("\n").length, 0);
    const result: ContextResult = {
      package: context,
      text,
      metrics: {
        rawContextEstimate: raw,
        contextTokens: actual,
        tokensAvoided: Math.max(0, raw - actual),
        reductionPercent: raw
          ? Number((((raw - actual) / raw) * 100).toFixed(2))
          : 0,
        fullFilesAvoided: files.size,
        sourceLinesAvoided: Math.max(0, rawLines - sourceLines),
        symbolsSupplied: context.symbols.length,
        sourceSlices: context.symbols.filter(
          (s) => s.representation === "source",
        ).length,
        toolCalls: 1,
        cacheHit: false,
        latencyMs: Math.round(performance.now() - start),
      },
    };
    if (this.cache.size >= 32)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, structuredClone(result));
    return result;
  }
  private assertFresh(symbols: ContextSymbol[]): void {
    for (const file of new Set(
      symbols.map((s) => s.at.replace(/:\d+-\d+$/, "")),
    )) {
      const record = this.store.file(file);
      if (
        !record ||
        hash(readLocal(this.query.root, file, this.query.maxFileBytes)) !==
          record.hash
      )
        throw new Error(
          `Stale index for ${file}; run pgraph index --changed`,
        );
    }
  }
}
