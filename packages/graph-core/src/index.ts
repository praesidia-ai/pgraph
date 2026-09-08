import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { IndexOptions } from "@praesidia/pgraph-ir";
import type { GraphStore } from "@praesidia/pgraph-store";
import { SqliteGraphStore } from "@praesidia/pgraph-store-sqlite";
import { GraphIndexer } from "@praesidia/pgraph-indexer";
import { GraphQuery } from "@praesidia/pgraph-query";
import {
  ContextEngine,
  type ContextRequest,
  type ContextResult,
  type ContextMetrics,
  type TokenCounter,
} from "@praesidia/pgraph-context";
import {
  SemanticMemory,
  type SemanticInput,
  type SemanticProvider,
} from "@praesidia/pgraph-semantic";
import {
  loadConfig,
  safePath,
  hash,
  readLocal,
  type Config,
} from "@praesidia/pgraph-shared";
export * from "@praesidia/pgraph-ir";
export {
  type ContextPackage,
  type ContextRequest,
  type ContextResult,
  bpeCounter,
  renderContext,
} from "@praesidia/pgraph-context";
export { semanticPrompt, type SemanticInput } from "@praesidia/pgraph-semantic";

export class PGraph extends GraphQuery {
  lastContextMetrics: ContextMetrics | undefined;
  readonly config: Config;
  readonly memory: SemanticMemory;
  private readonly indexer: GraphIndexer;
  private readonly contexts: ContextEngine;
  private constructor(
    root: string,
    store: GraphStore,
    config: Config,
    counter?: TokenCounter,
  ) {
    super(store, root, config.limits.maxFileBytes);
    this.config = config;
    this.indexer = new GraphIndexer(root, store, config);
    this.contexts = new ContextEngine(store, this, counter);
    this.memory = new SemanticMemory(store);
  }
  static open(
    root: string,
    options: {
      store?: GraphStore;
      counter?: TokenCounter;
      requireIndex?: boolean;
      readOnly?: boolean;
    } = {},
  ): PGraph {
    const full = realpathSync(root);
    const config = loadConfig(full);
    const dir = safePath(full, ".pgraph", false);
    if (
      options.requireIndex &&
      !existsSync(safePath(full, ".pgraph/graph.db", false))
    )
      throw new Error("No graph index. Run pgraph index first.");
    if (!options.readOnly) mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const name of ["graph.db", "graph.db-wal", "graph.db-shm"])
      safePath(full, `.pgraph/${name}`, false);
    const graph = new PGraph(
      full,
      options.store ??
        new SqliteGraphStore(safePath(full, ".pgraph/graph.db", false), {
          readOnly: options.readOnly,
        }),
      config,
      options.counter,
    );
    return graph;
  }
  static clean(root: string): void {
    const full = realpathSync(root);
    // Only known index artifacts; preserve user configuration and unrelated content.
    for (const name of ["graph.db", "graph.db-wal", "graph.db-shm"]) {
      const path = safePath(full, `.pgraph/${name}`, false);
      rmSync(path, { force: true });
    }
  }
  init(): { root: string; database: string } {
    const path = safePath(this.root, ".pgraph/config.json", false);
    if (!existsSync(path))
      writeFileSync(
        path,
        JSON.stringify(
          {
            version: 1,
            createdBy: "pgraph",
            configSource: ".pgraph.json",
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
    return { root: this.root, database: ".pgraph/graph.db" };
  }
  index(options: IndexOptions = {}) {
    Object.assign(this.config, loadConfig(this.root));
    this.maxFileBytes = this.config.limits.maxFileBytes;
    return this.indexer.index(options);
  }
  status() {
    return this.store.stats();
  }
  context(request: ContextRequest): ContextResult {
    const result = this.contexts.context({
      ...request,
      options: {
        ...request.options,
        weights: {
          ...this.config.context.weights,
          ...request.options?.weights,
        },
      },
    });
    this.lastContextMetrics = result.metrics;
    return result;
  }
  semanticInput(symbol: string): SemanticInput {
    const target = this.symbol(symbol);
    if (!target.location)
      throw new Error("Semantic symbol needs a source location");
    const hashes: Record<string, string> = {
      [target.location.file]: this.store.file(target.location.file)!.hash,
    };
    const neighbors = this.store.neighbors(
      target.id,
      "out",
      ["CALLS", "DEPENDS_ON", "IMPLEMENTS", "EXTENDS"],
      15,
    );
    for (const neighbor of neighbors)
      if (neighbor.node.location)
        hashes[neighbor.node.location.file] = this.store.file(
          neighbor.node.location.file,
        )!.hash;
    const input = {
      symbolId: target.id,
      signature: this.skeleton(target.id).slice(0, 6000),
      relationships: neighbors.map(
        (n) => `${target.qualifiedName} ${n.edge.type} ${n.node.qualifiedName}`,
      ),
      hashes,
    };
    this.validateSemanticInput(input);
    return input;
  }
  validateSemanticInput(input: SemanticInput): void {
    for (const [file, digest] of Object.entries(input.hashes))
      if (hash(readLocal(this.root, file, this.maxFileBytes)) !== digest)
        throw new Error("Stale semantic source; reindex first");
  }
  async enrich(
    symbol: string,
    provider: SemanticProvider,
    signal?: AbortSignal,
  ) {
    if (!this.config.semantic.enabled)
      throw new Error(
        "Enable semantic enrichment in repository configuration before invoking a provider",
      );
    signal?.throwIfAborted();
    const input = this.semanticInput(symbol);
    const raw = await provider.enrich(input, signal);
    signal?.throwIfAborted();
    this.validateSemanticInput(input);
    return this.memory.accept(raw, input, provider.name);
  }
  close(): void {
    this.store.close();
  }
}
export {
  relationships,
  topologySnapshot,
  composeWorkspace,
} from "@praesidia/pgraph-query";
