import type {
  EdgeType,
  GraphNode,
  Neighbor,
  SearchOptions,
} from "@praesidia/pgraph-ir";
import type { GraphStore } from "@praesidia/pgraph-store";
import { bounded, hash, readLocal } from "@praesidia/pgraph-shared";

export interface SourceSlice {
  symbol?: string;
  file: string;
  startLine: number;
  endLine: number;
  source: string;
  hash: string;
}
export interface ImpactResult {
  target: GraphNode;
  directCallers: GraphNode[];
  indirectCallers: GraphNode[];
  routes: GraphNode[];
  tests: GraphNode[];
  dependentModules: GraphNode[];
  publicAPIs: GraphNode[];
  databaseEffects: GraphNode[];
  events: GraphNode[];
  likelyChangeSurface: { node: GraphNode; distance: number; score: number }[];
  truncated: boolean;
}
const dependencyTypes: EdgeType[] = [
  "CALLS",
  "REFERENCES",
  "IMPORTS",
  "EXTENDS",
  "IMPLEMENTS",
  "DEPENDS_ON",
  "ACCEPTS",
  "RETURNS",
  "CONFIGURED_BY",
  "READS",
  "WRITES",
  "CREATES",
  "UPDATES",
  "DELETES",
  "EMITS",
  "CONSUMES",
];
export class GraphQuery {
  constructor(
    readonly store: GraphStore,
    readonly root: string,
    public maxFileBytes = 2_000_000,
  ) {}
  symbol(name: string): GraphNode {
    const nodes = this.store.resolve(name);
    if (!nodes.length) throw new Error(`Symbol not found: ${name}`);
    if (nodes.length > 1) {
      const files = new Set(nodes.map((n) => n.location?.file));
      const names = new Set(nodes.map((n) => n.qualifiedName));
      if (files.size > 1 || names.size > 1)
        throw new Error(
          `Ambiguous symbol '${name}'; use an ID: ${nodes.map((n) => n.id).join(", ")}`,
        );
      return nodes.sort(
        (a, b) =>
          b.location!.endOffset -
          b.location!.startOffset -
          (a.location!.endOffset - a.location!.startOffset),
      )[0]!;
    }
    return nodes[0]!;
  }
  searchSymbols(query: string, options: SearchOptions = {}): GraphNode[] {
    return this.store.search(query, options);
  }
  callers(name: string): GraphNode[] {
    return this.adjacent(name, "in", ["CALLS"]);
  }
  callees(name: string): GraphNode[] {
    return this.adjacent(name, "out", ["CALLS"]);
  }
  references(name: string): GraphNode[] {
    return this.adjacent(name, "in", ["REFERENCES", "ACCEPTS", "RETURNS"]);
  }
  implementations(name: string): GraphNode[] {
    return this.adjacent(name, "in", ["IMPLEMENTS"]);
  }
  testsFor(name: string): GraphNode[] {
    const target = this.symbol(name);
    const seeds = [
      target,
      ...this.store
        .neighbors(target.id, "out", ["CONTAINS"], 200)
        .map((n) => n.node),
    ];
    const tests = new Map<string, GraphNode>();
    for (const seed of seeds) {
      for (const n of this.store.neighbors(seed.id, "out", ["TESTED_BY"], 200))
        tests.set(n.node.id, n.node);
      for (const n of this.store.neighbors(
        seed.id,
        "in",
        ["CALLS", "REFERENCES"],
        200,
      ))
        if (n.node.kind === "test") tests.set(n.node.id, n.node);
    }
    return [...tests.values()];
  }
  dependencies(name: string): GraphNode[] {
    return this.aggregate(name, "out");
  }
  dependents(name: string): GraphNode[] {
    return this.aggregate(name, "in");
  }
  private aggregate(name: string, direction: "in" | "out"): GraphNode[] {
    const node = this.symbol(name);
    const seeds = [
      node,
      ...this.store
        .neighbors(node.id, "out", ["CONTAINS"], 200)
        .map((n) => n.node),
    ];
    const internal = new Set(seeds.map((n) => n.id));
    const found = new Map<string, GraphNode>();
    for (const seed of seeds)
      for (const n of this.store.neighbors(
        seed.id,
        direction,
        dependencyTypes,
        200,
      ))
        if (!internal.has(n.node.id)) found.set(n.node.id, n.node);
    return [...found.values()].slice(0, 200);
  }
  adjacent(
    name: string,
    direction: "in" | "out",
    types: EdgeType[],
  ): GraphNode[] {
    return [
      ...new Map(
        this.store
          .neighbors(this.symbol(name).id, direction, types, 200)
          .map((n) => [n.node.id, n.node]),
      ).values(),
    ];
  }
  path(
    from: string,
    to: string,
    options: { depth?: number; maxVisited?: number } = {},
  ): { nodes: GraphNode[]; truncated: boolean } {
    const start = this.symbol(from);
    const end = this.symbol(to);
    const depth = bounded(options.depth ?? 8, 1, 20, "depth");
    const max = bounded(options.maxVisited ?? 1000, 1, 5000, "maxVisited");
    const queue: { node: GraphNode; path: GraphNode[] }[] = [
      { node: start, path: [start] },
    ];
    const seen = new Set([start.id]);
    let truncated = false;
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]!;
      if (item.node.id === end.id) return { nodes: item.path, truncated };
      if (item.path.length > depth) {
        truncated = true;
        continue;
      }
      for (const next of this.store.neighbors(
        item.node.id,
        "out",
        ["CALLS", "IMPORTS", "DEPENDS_ON", "CREATES", "HANDLES"],
        200,
      )) {
        if (seen.has(next.node.id)) continue;
        if (seen.size >= max) {
          truncated = true;
          break;
        }
        seen.add(next.node.id);
        queue.push({ node: next.node, path: [...item.path, next.node] });
      }
    }
    return { nodes: [], truncated };
  }
  impact(
    name: string,
    options: { depth?: number; limit?: number } = {},
  ): ImpactResult {
    const target = this.symbol(name);
    const depth = bounded(options.depth ?? 3, 1, 10, "depth");
    const limit = bounded(options.limit ?? 100, 1, 500, "limit");
    const found = new Map<
      string,
      { node: GraphNode; distance: number; score: number }
    >([[target.id, { node: target, distance: 0, score: 1 }]]);
    const queue = [{ node: target, distance: 0 }];
    let truncated = false;
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]!;
      if (item.distance >= depth) continue;
      const incoming = this.store.neighbors(
        item.node.id,
        "in",
        dependencyTypes,
        200,
      );
      const tests = this.store.neighbors(
        item.node.id,
        "out",
        ["TESTED_BY"],
        100,
      );
      if (incoming.length === 200) truncated = true;
      for (const next of [...incoming, ...tests]) {
        if (found.has(next.node.id)) continue;
        if (found.size >= limit) {
          truncated = true;
          break;
        }
        const distance = item.distance + 1;
        found.set(next.node.id, {
          node: next.node,
          distance,
          score: Number((1 / (distance + 1)).toFixed(3)),
        });
        queue.push({ node: next.node, distance });
      }
    }
    const surface = [...found.values()].sort(
      (a, b) => a.distance - b.distance || a.node.id.localeCompare(b.node.id),
    );
    const nodes = surface.map((n) => n.node);
    const effects = this.dependencies(target.id);
    return {
      target,
      directCallers: this.callers(target.id),
      indirectCallers: surface.filter((n) => n.distance > 1).map((n) => n.node),
      routes: nodes.filter(
        (n) => n.kind === "route" || n.metadata.entryPoint === true,
      ),
      tests: nodes.filter((n) => n.kind === "test"),
      dependentModules: nodes.filter(
        (n) => n.kind === "module" || n.kind === "file" || n.kind === "package",
      ),
      publicAPIs: nodes.filter(
        (n) => n.metadata.exported === true || n.metadata.entryPoint === true,
      ),
      databaseEffects: effects.filter(
        (n) => n.kind === "database_model" || n.kind === "database_table",
      ),
      events: effects.filter((n) => n.kind === "event" || n.kind === "queue"),
      likelyChangeSurface: surface,
      truncated,
    };
  }
  fileSlice(options: {
    file: string;
    startLine: number;
    endLine: number;
    surrounding?: number;
  }): SourceSlice {
    const record = this.store.file(options.file);
    if (!record) throw new Error("File is not in the index");
    const source = readLocal(this.root, options.file, this.maxFileBytes);
    if (hash(source) !== record.hash)
      throw new Error(
        `Stale index for ${options.file}; run pgraph index --changed`,
      );
    const lines = source.split("\n");
    const start = bounded(options.startLine, 1, lines.length, "startLine");
    const end = bounded(options.endLine, start, lines.length, "endLine");
    const around = bounded(options.surrounding ?? 0, 0, 30, "surrounding");
    if (end - start > 1000)
      throw new Error("Slice exceeds 1001 lines; request smaller ranges");
    const first = Math.max(1, start - around);
    const last = Math.min(lines.length, end + around);
    return {
      file: options.file,
      startLine: first,
      endLine: last,
      source: lines.slice(first - 1, last).join("\n"),
      hash: record.hash,
    };
  }
  slice(name: string, options: { surrounding?: number } = {}): SourceSlice {
    const node = this.symbol(name);
    const loc = node.location;
    if (!loc || node.kind === "file" || node.kind === "package")
      throw new Error(
        "Choose a source symbol, or use fileSlice with explicit lines",
      );
    const range = this.fileSlice({
      file: loc.file,
      startLine: loc.startLine,
      endLine: loc.endLine,
      surrounding: options.surrounding,
    });
    if (!options.surrounding) {
      const content = readLocal(this.root, loc.file, this.maxFileBytes);
      if (hash(content) !== range.hash)
        throw new Error("Source changed during slice; retry after indexing");
      range.source = content.slice(loc.startOffset, loc.endOffset);
    }
    return { ...range, symbol: node.id };
  }
  skeleton(name: string): string {
    const node = this.symbol(name);
    const children = this.store
      .neighbors(node.id, "out", ["CONTAINS"], 500)
      .map((n) => n.node);
    const base = node.signature ?? `${node.kind} ${node.name}`;
    if (
      [
        "class",
        "interface",
        "controller",
        "service",
        "repository_class",
        "database_model",
        "namespace",
      ].includes(node.kind)
    )
      return `${base} {\n${children
        .filter((n) => n.signature)
        .sort(
          (a, b) =>
            (a.location?.startOffset ?? 0) - (b.location?.startOffset ?? 0),
        )
        .map((n) => `  ${n.signature}`)
        .join("\n")}\n}`;
    return base;
  }
  skeletonFile(file: string): string {
    const nodes = this.store.nodesInFile(file);
    const root = nodes.find((n) => n.kind === "file");
    if (!root) throw new Error("Source file not found");
    return this.store
      .neighbors(root.id, "out", ["CONTAINS"], 500)
      .map((n) => this.skeleton(n.node.id))
      .join("\n");
  }
  feature(concept: string): {
    concept: string;
    symbols: GraphNode[];
    evidence: "semantic-or-name-match";
  } {
    const found = new Map(
      this.store.search(concept, { limit: 40 }).map((n) => [n.id, n]),
    );
    for (const fact of this.store.semantic())
      if (
        fact.concepts.some((c) =>
          c.toLowerCase().includes(concept.toLowerCase()),
        )
      ) {
        const node = this.store.node(fact.symbolId);
        if (node) found.set(node.id, node);
      }
    return {
      concept,
      symbols: [...found.values()].slice(0, 100),
      evidence: "semantic-or-name-match",
    };
  }
  architecture(scope?: string): {
    packages: GraphNode[];
    entryPoints: GraphNode[];
    relationships: Neighbor[];
    truncated: boolean;
  } {
    const nodes = this.store.search("", { scope, limit: 500 });
    const entryPoints = nodes
      .filter((n) => n.metadata.entryPoint === true)
      .slice(0, 30);
    const packages = this.store.search("", {
      kind: "package",
      scope,
      limit: 100,
    });
    return {
      packages,
      entryPoints,
      relationships: [...packages, ...entryPoints]
        .flatMap((n) =>
          this.store.neighbors(
            n.id,
            "out",
            ["DEPENDS_ON", "CALLS", "IMPORTS"],
            10,
          ),
        )
        .slice(0, 100),
      truncated: nodes.length === 500,
    };
  }
}
