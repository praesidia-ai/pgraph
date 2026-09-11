import { getEncoding } from "js-tiktoken";
import type {
  EdgeType,
  GraphNode,
  EvidenceMode,
  SourceFocus,
} from "@praesidia/pgraph-ir";
import { nodeKinds } from "@praesidia/pgraph-ir";
import type { GraphStore } from "@praesidia/pgraph-store";
import { GraphQuery } from "@praesidia/pgraph-query";
import {
  classifyTask,
  defaultWeights,
  rank,
  termStem,
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
  id: string;
  symbol: string;
  at: string;
  kind: string;
  score: number;
  representation: "summary" | "signature" | "skeleton" | "source" | "excerpt";
  text: string;
  reasons: string[];
}
export interface ContextPackage {
  version: 1;
  contextId: string;
  task: string;
  strategy: TaskStrategy;
  tokenBudget: number;
  estimatedTokens: number;
  tokenizer: string;
  revision: number;
  evidenceMode: EvidenceMode;
  symbols: ContextSymbol[];
  relationships: [string, EdgeType, string][];
  entryPoints: string[];
  tests: string[];
  constraints: string[];
  warnings: string[];
  reuseFrom?: string;
  reusedSymbols?: string[];
  selection?: {
    candidates: number;
    shortlisted: number;
    omitted: { id: string; reason: string }[];
    truncated: boolean;
  };
}
export interface ContextRequest {
  task: string;
  maxTokens: number;
  options?: {
    format?: "json" | "markdown";
    scope?: string;
    includeSource?: boolean;
    evidenceMode?: EvidenceMode;
    focus?: SourceFocus;
    previousContextId?: string;
    explain?: boolean;
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
  excerptSlices: number;
  toolCalls: number;
  cacheHit: boolean;
  reusedSymbols?: number;
  latencyMs: number;
}
export interface ContextResult {
  package: ContextPackage;
  text: string;
  metrics: ContextMetrics;
}
/** Local diagnostic hook. Never serialized into agent context or cached responses. */
export interface ContextSelectionTrace {
  candidates: {
    id: string;
    score?: number;
    rank?: number;
    seed?: boolean;
    reasons?: string[];
    stage: string;
    representations?: { kind: string; cost: number; utility: number }[];
  }[];
  truncated: boolean;
}
export function renderContext(
  context: ContextPackage,
  format: "json" | "markdown" = "json",
): string {
  if (format === "json") return JSON.stringify(context);
  return [
    `# PGraph context`,
    `${context.task}`,
    `Context: ${context.contextId} | Strategy: ${context.strategy} | Evidence: ${context.evidenceMode} | Revision: ${context.revision} | Tokens: ${context.estimatedTokens}/${context.tokenBudget} (${context.tokenizer})`,
    ...(context.reuseFrom
      ? [
          `Reuse unchanged entries from ${context.reuseFrom}: ${(context.reusedSymbols ?? []).join(", ")}`,
        ]
      : []),
    ...context.warnings.map((w) => `Warning: ${w}`),
    ...context.symbols.map((s) => renderSymbol(s)),
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
    ...(context.selection
      ? [`Selection: ${JSON.stringify(context.selection)}`]
      : []),
  ].join("\n");
}
function renderSymbol(s: ContextSymbol): string {
  const range = s.at.match(/:(\d+-\d+)$/)?.[1] ?? s.at;
  return `\n## ${s.id} [lines ${range}; ${s.representation}]\nSelected: ${s.reasons.join("; ")}\n${s.text}`;
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
  "what",
  "which",
  "could",
  "would",
  "should",
  "its",
  "this",
  "that",
  "a",
  "an",
  "another",
  "together",
  "using",
  "between",
  "relevant",
  "test",
  "tests",
  "refactor",
  "impact",
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
    private readonly observeSelection?: (trace: ContextSelectionTrace) => void,
  ) {}
  context(request: ContextRequest): ContextResult {
    const start = performance.now();
    const budget = bounded(request.maxTokens, 128, 32_000, "maxTokens");
    if (!request.task.trim() || request.task.length > 4000)
      throw new Error("task must contain 1–4000 characters");
    const format = request.options?.format ?? "json";
    const { previousContextId, ...cacheOptions } = request.options ?? {};
    if (
      previousContextId !== undefined &&
      !/^[a-f0-9]{24}$/.test(previousContextId)
    )
      throw new Error("Invalid previousContextId");
    const previous = previousContextId
      ? [...this.cache.values()].find(
          (entry) => entry.package.contextId === previousContextId,
        )
      : undefined;
    const evidenceMode = request.options?.evidenceMode ?? "local";
    if (!["local", "assisted"].includes(evidenceMode))
      throw new Error("Invalid evidence mode");
    const focus = request.options?.focus
      ? this.query.focus(request.options.focus)
      : undefined;
    if (
      focus &&
      request.options?.scope &&
      request.options.scope !== "." &&
      !focus.location?.file.startsWith(
        `${request.options.scope.replace(/\/$/, "")}/`,
      )
    )
      throw new Error("Focus is outside the requested scope");
    const revision = this.store.stats().revision;
    const key = hash(
      JSON.stringify({ ...request, options: cacheOptions }) +
        this.query.root +
        revision +
        this.counter.name +
        (evidenceMode === "assisted"
          ? (this.store.getMeta<number>("semanticRevision") ?? 0)
          : 0),
    );
    const cached = this.cache.get(key);
    if (cached && !this.observeSelection) {
      this.assertFresh(cached.package.symbols);
      return this.reuse(
        {
          ...structuredClone(cached),
          metrics: {
            ...cached.metrics,
            cacheHit: true,
            latencyMs: Math.round(performance.now() - start),
          },
        },
        previous,
        format,
      );
    }
    const rawTerms = words(request.task).filter((t) => !stop.has(t));
    const rawStems = new Set(rawTerms.map(termStem));
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
      { node: GraphNode; distance?: number; score: number; reasons: string[] }
    >();
    const omissions = new Map<string, string>();
    const omit = (id: string, reason: string): void => {
      if (
        (request.options?.explain || this.observeSelection) &&
        (omissions.size < 500 || candidates.has(id))
      )
        omissions.set(id, reason);
    };
    let truncated = false;
    const git = this.store.getMeta<{
      frequency: Record<string, number>;
      cochange: Record<string, Record<string, number>>;
    }>("git");
    const maxFrequency = Object.values(git?.frequency ?? {}).reduce(
      (max, value) => Math.max(max, value),
      1,
    );
    const exact = new Set<string>();
    const exactNodes = new Map<string, GraphNode>();
    for (const identifier of request.task.match(/[\w$]+(?:\.[\w$]+)+/g) ?? [])
      for (const node of this.store.resolve(identifier)) {
        exact.add(node.id);
        exactNodes.set(node.id, node);
      }
    if (focus) {
      exact.add(focus.id);
      exactNodes.set(focus.id, focus);
    }
    const add = (
      node: GraphNode,
      distance?: number,
      inheritedScore = 0,
      reason = "task terms",
    ): void => {
      if (candidates.size >= 500 && !candidates.has(node.id)) {
        truncated = true;
        omit(node.id, "candidate limit");
        return;
      }
      if (
        !exact.has(node.id) &&
        [
          "file",
          "package",
          "repository",
          "directory",
          "variable",
          "constant",
        ].includes(node.kind)
      ) {
        omit(node.id, "declaration kind excluded from context");
        return;
      }
      if (
        node.kind === "constructor" &&
        !exact.has(node.id) &&
        !/constructor/i.test(request.task)
      ) {
        omit(node.id, "constructor not requested");
        return;
      }
      if (
        node.kind === "property" &&
        !rawTerms.includes(node.name.toLowerCase()) &&
        !exact.has(node.id)
      ) {
        omit(node.id, "property does not match task");
        return;
      }
      if (
        request.options?.scope &&
        request.options.scope !== "." &&
        !node.location?.file.startsWith(
          `${request.options.scope.replace(/\/$/, "")}/`,
        )
      ) {
        omit(node.id, "outside scope");
        return;
      }
      const existing = candidates.get(node.id);
      const score = Math.min(
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
                (git?.frequency[node.location?.file ?? ""] ?? 0) / maxFrequency,
            },
            weights,
          ),
        ) *
          (node.kind === "property" && !exact.has(node.id) ? 0.4 : 1) +
          (distance !== undefined && distance > 0
            ? rank(node, { terms, strategy }, weights) * 0.25
            : 0) +
          (exact.has(node.id)
            ? 0.5
            : node.kind !== "property" &&
                rawTerms.includes(node.name.toLowerCase())
              ? 0.2
              : node.kind !== "property" &&
                  rawStems.has(termStem(node.name.toLowerCase()))
                ? 0.08
                : 0),
      );
      const reasons = [
        ...new Set([
          ...(existing?.reasons ?? []),
          exact.has(node.id)
            ? focus?.id === node.id
              ? "editor focus"
              : "named symbol"
            : reason,
        ]),
      ].slice(0, 2);
      candidates.set(node.id, {
        node,
        distance: Math.min(existing?.distance ?? 99, distance ?? 99),
        score: Math.max(existing?.score ?? 0, score),
        reasons,
      });
    };
    for (const node of exactNodes.values()) add(node, 0);
    // Filter before LIMIT: local variables and files must not crowd declarations
    // out of the retrieval window before candidate filtering sees them.
    const searchOptions = {
      kinds: nodeKinds.filter(
        (kind) =>
          ![
            "file",
            "package",
            "repository",
            "directory",
            "variable",
            "constant",
          ].includes(kind),
      ),
      scope:
        request.options?.scope === "." ? undefined : request.options?.scope,
    };
    for (const [position, node] of this.store
      .search(rawTerms.join(" "), {
        limit: 100,
        ...searchOptions,
      })
      .entries()) {
      if (rawTerms.length)
        add(node, undefined, 0.48 / (1 + position / 10), "ranked text match");
    }
    const termMatches = new Map<
      string,
      { node: GraphNode; hits: number; best: number }
    >();
    let matchedTerms = 0;
    for (const term of terms) {
      const matches = this.store.search(term, {
        limit: 60,
        ...searchOptions,
      });
      if (matches.length) matchedTerms++;
      for (const [position, node] of matches.entries()) {
        const previous = termMatches.get(node.id);
        termMatches.set(node.id, {
          node,
          hits: (previous?.hits ?? 0) + 1,
          best: Math.max(previous?.best ?? 0, 0.24 / (1 + position / 10)),
        });
      }
    }
    for (const { node, hits, best } of [...termMatches.values()].sort(
      (a, b) =>
        b.hits - a.hits ||
        b.best - a.best ||
        a.node.id.localeCompare(b.node.id),
    ))
      add(
        node,
        undefined,
        best + (0.3 * hits) / Math.max(1, matchedTerms),
        "ranked term coverage",
      );
    for (const fact of evidenceMode === "assisted" ? this.store.semantic() : [])
      if (
        fact.concepts.some((c) =>
          terms.some((t) => c.toLowerCase().includes(t)),
        )
      ) {
        const node = this.store.node(fact.symbolId);
        if (node)
          add(node, 0, fact.confidence * 0.3, "cached AI concept (inferred)");
      }
    const seeds = [...candidates.values()]
      .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id))
      .slice(0, exact.size ? Math.max(exact.size, 3) : 5);
    const relatedTests = new Set<string>();
    for (const seed of seeds.slice(0, 2)) {
      const paths = this.query.testPaths(seed.node.id, {
        depth: 4,
        limit: 100,
      });
      truncated ||= paths.truncated;
      for (const test of paths.tests) {
        relatedTests.add(test.node.id);
        add(
          test.node,
          test.path.length,
          (seed.score * (strategy === "tests" ? 0.95 : 0.65)) /
            Math.max(1, test.path.length),
          `${test.potentialDispatch ? "possible dispatch" : "static test path"} for ${seed.node.qualifiedName}`,
        );
      }
    }
    const types: EdgeType[] = [
      "CALLS",
      "REFERENCES",
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
      "CONTAINS",
    ];
    const queue = seeds.map((seed) => ({
      ...seed,
      distance: 0,
      direction: undefined as "in" | "out" | undefined,
    }));
    const visited = new Set<string>();
    const depth = strategy === "locate" ? 1 : 2;
    for (let i = 0; i < queue.length && i < 60; i++) {
      const seed = queue[i]!;
      const visit = `${seed.node.id}:${seed.direction ?? "both"}`;
      if (visited.has(visit) || seed.distance >= depth) continue;
      visited.add(visit);
      for (const direction of ["out", "in"] as const) {
        // A shared helper/type is not evidence connecting all of its consumers.
        const contractBridge = seed.direction && seed.direction !== direction;
        const neighbors = this.store.neighbors(
          seed.node.id,
          direction,
          contractBridge ? ["IMPLEMENTS"] : types,
          50,
        );
        if (neighbors.length === 50) truncated = true;
        for (const neighbor of neighbors) {
          if (
            neighbor.edge.type === "CONTAINS" &&
            (direction === "in" ||
              !["class", "service", "controller", "interface"].includes(
                seed.node.kind,
              ))
          )
            continue;
          const distance = seed.distance + 1;
          const followsFlow = [
            "CALLS",
            "IMPLEMENTS",
            "EXTENDS",
            "ROUTED_FROM",
            "READS",
            "CREATES",
            "UPDATES",
            "EMITS",
            "CONSUMES",
            "CONTAINS",
          ].includes(neighbor.edge.type);
          add(
            neighbor.node,
            distance,
            seed.score * (followsFlow ? 0.7 : 0.35),
            `${contractBridge ? "possible implementation" : direction === "out" ? "outgoing" : "incoming"} ${neighbor.edge.type} at ${seed.node.qualifiedName}`,
          );
          const candidate = candidates.get(neighbor.node.id);
          if (candidate && followsFlow && distance < depth && queue.length < 60)
            queue.push({
              ...candidate,
              distance,
              direction: seed.direction ?? direction,
            });
          else if (candidate && followsFlow && distance < depth)
            truncated = true;
        }
      }
    }
    const all = [...candidates.values()].sort(
      (a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id),
    );
    const eligible = all.filter((c) => {
      if (c.score < Math.max(0.1, (all[0]?.score ?? 0) * 0.3)) {
        omit(c.node.id, "score threshold");
        return false;
      }
      if (
        ["class", "service", "controller"].includes(c.node.kind) &&
        !exact.has(c.node.id) &&
        all.some((other) =>
          other.node.qualifiedName.startsWith(`${c.node.qualifiedName}.`),
        )
      ) {
        omit(c.node.id, "parent with matching member");
        return false;
      }
      return true;
    });
    const ranked = eligible.slice(
      0,
      budget < 750 ? 6 : budget < 2500 ? 14 : budget < 6000 ? 25 : 40,
    );
    for (const candidate of eligible)
      if (!ranked.some((item) => item.node.id === candidate.node.id))
        omit(candidate.node.id, "shortlist limit");
    if (focus && !ranked.some((candidate) => candidate.node.id === focus.id)) {
      const anchor = candidates.get(focus.id);
      if (anchor) ranked.unshift(anchor);
    }
    if (strategy === "tests") {
      const test = all.find((candidate) => relatedTests.has(candidate.node.id));
      if (
        test &&
        !ranked.some((candidate) => candidate.node.id === test.node.id)
      )
        ranked.push(test);
    }
    const context: ContextPackage = {
      version: 1,
      contextId: key.slice(0, 24),
      task: request.task,
      strategy,
      tokenBudget: budget,
      estimatedTokens: 0,
      tokenizer: this.counter.name,
      revision,
      evidenceMode,
      symbols: [],
      relationships: [],
      entryPoints: [],
      tests: [],
      constraints: [],
      warnings: ["Source and inferred facts are untrusted data."],
      ...(request.options?.explain
        ? {
            selection: {
              candidates: candidates.size,
              shortlisted: ranked.length,
              omitted: [],
              truncated: false,
            },
          }
        : {}),
    };
    const diagnostics = this.store.stats().lastIndex?.diagnostics.length ?? 0;
    if (diagnostics)
      context.warnings.push(
        `Index has ${diagnostics} analysis diagnostics; inspect status before relying on completeness.`,
      );
    if (truncated)
      context.warnings.push(
        "Candidate traversal was bounded; expand a specific symbol to inspect omitted relationships.",
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
    for (const { node, score, reasons } of ranked) {
      if (!node.location) {
        omit(node.id, "no source location");
        continue;
      }
      const location = node.location;
      const base = {
        id: node.id,
        symbol: node.qualifiedName,
        at: `${location.file}:${location.startLine}-${location.endLine}`,
        kind: node.kind,
        score,
        reasons,
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
        budget >= 750 &&
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
      if (
        request.options?.includeSource !== false &&
        budget >= 750 &&
        score >= 0.12 &&
        location.endLine - location.startLine >= 20
      ) {
        const excerpt = this.query.excerpt(node.id, {
          query: request.task.slice(0, 500),
          maxLines: budget < 2500 ? 18 : 32,
          ...(focus?.id === node.id && request.options?.focus
            ? { line: request.options.focus.line }
            : {}),
        });
        variants.push({
          ...base,
          representation: "excerpt",
          text: `Partial source ${excerpt.startLine}-${excerpt.endLine}; ${excerpt.omittedBefore} lines before and ${excerpt.omittedAfter} after omitted. Surrounding definitions/control conditions may be missing.\n${excerpt.source}`,
        });
      }
      groups.push(
        variants.map((v) => ({
          value: v,
          cost:
            this.counter.count(
              format === "json" ? JSON.stringify(v) : renderSymbol(v),
            ) + 2,
          utility:
            score *
            {
              summary: 0.45,
              signature: 1,
              skeleton: 1.2,
              excerpt: ["change", "debug", "tests"].includes(strategy)
                ? 1.9
                : 1.25,
              source: ["change", "debug", "tests"].includes(strategy)
                ? 2.4
                : 1.45,
            }[v.representation],
        })),
      );
    }
    const available = Math.max(
      0,
      budget - overhead - Math.min(200, Math.floor(budget * 0.1)),
    );
    const primaryId =
      focus?.id ??
      [...exactNodes.keys()].find((id) =>
        groups.some((group) => group[0]?.value.id === id),
      ) ??
      seeds[0]?.node.id;
    const reserved: BudgetOption<ContextSymbol>[] = [];
    let remaining = available;
    const reserve = (
      id: string | undefined,
      share: number,
      required = false,
    ): void => {
      if (!id || reserved.some((option) => option.value.id === id)) return;
      const group = groups.find((options) => options[0]?.value.id === id);
      const cheapest = group?.reduce((a, b) => (a.cost <= b.cost ? a : b));
      if (!cheapest || cheapest.cost > remaining) {
        if (required)
          throw new Error(
            "Focused symbol exceeds the context budget; increase maxTokens",
          );
        return;
      }
      const best = group!
        .filter(
          (option) =>
            option.cost <=
            Math.min(remaining, Math.max(cheapest.cost, available * share)),
        )
        .sort((a, b) => b.utility - a.utility || a.cost - b.cost)[0]!;
      reserved.push(best);
      remaining -= best.cost;
    };
    reserve(primaryId, 0.55, !!focus);
    if (["tests", "change", "debug"].includes(strategy))
      reserve(
        ranked.find((candidate) => relatedTests.has(candidate.node.id))?.node
          .id,
        0.25,
      );
    for (const id of [...exactNodes.keys()].slice(0, 4)) reserve(id, 0.15);
    const protectedIds = new Set(reserved.map((option) => option.value.id));
    context.symbols = [
      ...reserved.map((option) => option.value),
      ...optimizeBudget(
        groups.filter((group) => !protectedIds.has(group[0]!.value.id)),
        remaining,
      ),
    ].sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
    for (const group of groups)
      if (!context.symbols.some((symbol) => symbol.id === group[0]!.value.id))
        omit(group[0]!.value.id, "representation budget");
    // Prefer the smaller implementation unless the user explicitly focused its parent.
    context.symbols = context.symbols.filter(
      (s) =>
        protectedIds.has(s.id) ||
        s.representation !== "source" ||
        !context.symbols.some(
          (other) =>
            other !== s &&
            other.representation === "source" &&
            other.at.replace(/:\d+-\d+$/, "") ===
              s.at.replace(/:\d+-\d+$/, "") &&
            (other.symbol.startsWith(`${s.symbol}.`) ||
              (protectedIds.has(other.id) &&
                s.symbol.startsWith(`${other.symbol}.`))),
        ),
    );
    for (const group of groups)
      if (
        !context.symbols.some((symbol) => symbol.id === group[0]!.value.id) &&
        !omissions.has(group[0]!.value.id)
      )
        omit(group[0]!.value.id, "overlapping source");
    while (measure() > budget && context.symbols.length) {
      let removable = context.symbols
        .map((symbol) => protectedIds.has(symbol.id))
        .lastIndexOf(false);
      if (removable < 0)
        removable = context.symbols
          .map((symbol) => symbol.id === focus?.id)
          .lastIndexOf(false);
      if (removable < 0)
        throw new Error(
          "Focused symbol exceeds the context budget; increase maxTokens",
        );
      omit(context.symbols[removable]!.id, "serialized budget");
      context.symbols.splice(removable, 1);
    }
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
      for (const fact of evidenceMode === "assisted"
        ? this.store.semantic(node.id)
        : [])
        for (const constraint of fact.constraints)
          attempt(
            () => context.constraints.push(constraint),
            () => {
              context.constraints.pop();
            },
          );
    }
    if (context.selection) {
      const missing = [...omissions].filter(([id]) => !selectedIds.has(id));
      context.selection.truncated = missing.length > 0;
      for (const [id, reason] of missing.slice(0, 5))
        attempt(
          () => context.selection!.omitted.push({ id, reason }),
          () => {
            context.selection!.omitted.pop();
          },
        );
      context.selection.truncated =
        missing.length > context.selection.omitted.length;
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
      .filter(
        (s) => s.representation === "source" || s.representation === "excerpt",
      )
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
        excerptSlices: context.symbols.filter(
          (s) => s.representation === "excerpt",
        ).length,
        toolCalls: 1,
        cacheHit: false,
        latencyMs: Math.round(performance.now() - start),
      },
    };
    if (this.observeSelection) {
      const candidateIds = new Set(all.map((c) => c.node.id));
      this.observeSelection({
        candidates: [
          ...all.map((candidate, index) => ({
            id: candidate.node.id,
            score: candidate.score,
            rank: index + 1,
            seed: seeds.some((seed) => seed.node.id === candidate.node.id),
            reasons: candidate.reasons,
            stage: selectedIds.has(candidate.node.id)
              ? "selected"
              : (omissions.get(candidate.node.id) ?? "no representation"),
            representations: groups
              .find((group) => group[0]?.value.id === candidate.node.id)
              ?.map((option) => ({
                kind: option.value.representation,
                cost: option.cost,
                utility: option.utility,
              })),
          })),
          ...[...omissions]
            .filter(([id]) => !candidateIds.has(id))
            .map(([id, stage]) => ({ id, stage })),
        ],
        truncated,
      });
    }
    if (this.cache.size >= 32)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, structuredClone(result));
    return this.reuse(result, previous, format);
  }
  private reuse(
    result: ContextResult,
    previous: ContextResult | undefined,
    format: "json" | "markdown",
  ): ContextResult {
    if (
      !previous ||
      previous.package.evidenceMode !== result.package.evidenceMode
    )
      return result;
    const known = new Map(
      previous.package.symbols.map((symbol) => [
        symbol.id,
        JSON.stringify(symbol),
      ]),
    );
    const reused = result.package.symbols.filter(
      (symbol) => known.get(symbol.id) === JSON.stringify(symbol),
    );
    if (!reused.length) return result;
    const delta = structuredClone(result);
    const ids = new Set(reused.map((symbol) => symbol.id));
    delta.package.symbols = delta.package.symbols.filter(
      (symbol) => !ids.has(symbol.id),
    );
    delta.package.reuseFrom = previous.package.contextId;
    delta.package.reusedSymbols = [...ids];
    for (let i = 0; i < 8; i++) {
      const tokens = this.counter.count(renderContext(delta.package, format));
      if (tokens === delta.package.estimatedTokens) break;
      delta.package.estimatedTokens = tokens;
    }
    delta.text = renderContext(delta.package, format);
    const tokens = this.counter.count(delta.text);
    if (
      tokens >= result.metrics.contextTokens ||
      tokens > result.package.tokenBudget
    )
      return result;
    delta.metrics = {
      ...delta.metrics,
      contextTokens: tokens,
      symbolsSupplied: delta.package.symbols.length,
      sourceSlices: delta.package.symbols.filter(
        (symbol) => symbol.representation === "source",
      ).length,
      excerptSlices: delta.package.symbols.filter(
        (symbol) => symbol.representation === "excerpt",
      ).length,
      reusedSymbols: ids.size,
      tokensAvoided: Math.max(0, delta.metrics.rawContextEstimate - tokens),
      reductionPercent: delta.metrics.rawContextEstimate
        ? Number(
            (
              ((delta.metrics.rawContextEstimate - tokens) /
                delta.metrics.rawContextEstimate) *
              100
            ).toFixed(2),
          )
        : 0,
    };
    return delta;
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
        throw new Error(`Stale index for ${file}; run pgraph index --changed`);
    }
  }
}
