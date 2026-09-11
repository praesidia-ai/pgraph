import { azureConfiguration } from "./bindings.js";
import { dirname, basename } from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";
import type { GraphStore } from "@praesidia/pgraph-store";
import type {
  GraphNode,
  IndexResult,
  IndexOptions,
  LanguageAdapter,
  ParsedFile,
} from "@praesidia/pgraph-ir";
import { TypeScriptAdapter } from "@praesidia/pgraph-typescript";
import { EXTRACTION_VERSION } from "@praesidia/pgraph-ir";
import { readGitSignals } from "@praesidia/pgraph-git";
import {
  hash,
  readLocal,
  safePath,
  type Config,
} from "@praesidia/pgraph-shared";
import { discover } from "./discovery.js";
export { discover, snapshotInput } from "./discovery.js";

export class GraphIndexer {
  constructor(
    private readonly root: string,
    private readonly store: GraphStore,
    private readonly config: Config,
    private readonly adapter: LanguageAdapter = new TypeScriptAdapter(),
  ) {}
  index(options: IndexOptions = {}): IndexResult {
    const start = performance.now();
    const baseRevision = this.store.getMeta<number>("revision") ?? 0;
    options.onProgress?.({
      phase: "discover",
      message: "Discovering and hashing repository files",
    });
    const discovery = discover(this.root, this.config);
    const records = [...discovery.sources, ...discovery.manifests];
    const current = new Map(records.map((f) => [f.path, f]));
    const old = this.store.files();
    const changed = new Set(
      records
        .filter((f) => this.store.file(f.path)?.hash !== f.hash)
        .map((f) => f.path),
    );
    const deleted = old.filter((f) => !current.has(f.path)).map((f) => f.path);
    const configChanged =
      this.store.getMeta<string>("configHash") !== discovery.configHash ||
      this.store.getMeta<number>("retrievalVersion") !== EXTRACTION_VERSION ||
      this.store.getMeta<number>("communicationVersion") !== 1;
    const added = records.some((f) => !this.store.file(f.path));
    const affected = new Set([...changed, ...deleted]);
    // Compute reverse transitive dependency closure against the old graph before mutation.
    const queue = [...affected];
    for (let i = 0; i < queue.length; i++) {
      for (const path of this.store.dependentFiles(queue[i]!)) {
        if (path && !affected.has(path)) {
          affected.add(path);
          queue.push(path);
        }
      }
    }
    if (options.rebuild || configChanged || added)
      for (const f of records) affected.add(f.path);
    const extract = new Set(
      discovery.sources.filter((f) => affected.has(f.path)).map((f) => f.path),
    );
    options.onProgress?.({
      phase: "analyze",
      message: `Analyzing ${extract.size} affected files out of ${discovery.sources.length} source files`,
    });
    const parsed = this.adapter.parse(
      this.root,
      discovery.sources,
      extract,
      options.onProgress,
    );
    for (const manifest of discovery.manifests.filter((f) =>
      affected.has(f.path),
    )) {
      if (basename(manifest.path) !== "package.json") {
        parsed.push(
          azureConfiguration(
            manifest,
            readLocal(
              this.root,
              manifest.path,
              this.config.limits.maxFileBytes,
            ),
          ),
        );
        continue;
      }
      const data: unknown = JSON.parse(readLocal(this.root, manifest.path));
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error(`Invalid manifest: ${manifest.path}`);
      const d = data as Record<string, unknown>;
      const name = typeof d.name === "string" ? d.name : dirname(manifest.path);
      const node: GraphNode = {
        id: `package:${manifest.path}`,
        kind: "package",
        name,
        qualifiedName: name,
        language: "json",
        location: {
          file: manifest.path,
          startLine: 1,
          endLine: manifest.lines,
          startOffset: 0,
          endOffset: readLocal(this.root, manifest.path).length,
        },
        signature: `package ${name}`,
        metadata: {
          directory: dirname(manifest.path),
          dependencies:
            typeof d.dependencies === "object" && d.dependencies
              ? Object.keys(d.dependencies)
              : [],
        },
        provenance: {
          source: "package-manifest",
          confidence: 1,
          evidence: "deterministic",
          sourceHash: manifest.hash,
        },
      };
      parsed.push({
        file: manifest,
        nodes: [node],
        edges: [],
        diagnostics: [],
      });
    }
    // Ensure the extraction still corresponds to discovery's snapshot before publishing.
    for (const p of parsed)
      if (
        hash(
          readLocal(this.root, p.file.path, this.config.limits.maxFileBytes),
        ) !== p.file.hash
      )
        throw new Error(`File changed during indexing: ${p.file.path}; retry`);
    options.onProgress?.({
      phase: "persist",
      message: `Saving ${parsed.length} extracted files to the repository graph`,
    });
    const committed = this.store.transaction(() => {
      // A second writer must not silently overwrite a newer graph snapshot.
      const oldRevision = this.store.getMeta<number>("revision") ?? 0;
      if (oldRevision !== baseRevision)
        throw new Error("Concurrent index update; retry indexing");
      for (const p of parsed) this.store.putFile(p.file);
      for (const p of parsed) {
        this.store.removeOwnedEdges(p.file.path);
        for (const node of p.nodes) this.store.putNode(node);
      }
      for (const p of parsed)
        this.store.pruneNodes(
          p.file.path,
          p.nodes.map((n) => n.id),
        );
      for (const path of deleted) this.store.removeFile(path);
      this.store.invalidateSemantic([...affected]);
      const repo: GraphNode = {
        id: "repository:root",
        kind: "repository",
        name: basename(this.root),
        qualifiedName: basename(this.root),
        language: "",
        metadata: {},
        provenance: {
          source: "discovery",
          confidence: 1,
          evidence: "deterministic",
        },
      };
      this.store.putNode(repo);
      const packages = this.store.search("", { kind: "package", limit: 500 });
      const packageByName = new Map(packages.map((p) => [p.name, p]));
      for (const p of parsed) {
        this.persistEdges(p);
        const fileNode = p.nodes[0]!;
        const parent =
          packages
            .filter(
              (n) =>
                typeof n.metadata.directory === "string" &&
                (n.metadata.directory === "." ||
                  p.file.path.startsWith(`${n.metadata.directory}/`)) &&
                n.id !== fileNode.id,
            )
            .sort(
              (a, b) =>
                String(b.metadata.directory).length -
                String(a.metadata.directory).length,
            )[0] ?? repo;
        this.store.putEdge({
          from: parent.id,
          to: fileNode.id,
          type: "CONTAINS",
          ownerFile: p.file.path,
          source: "discovery",
          confidence: 1,
          evidence: "deterministic",
          metadata: {},
        });
        if (fileNode.kind === "package")
          for (const name of fileNode.metadata.dependencies as string[]) {
            const dep = packageByName.get(name);
            if (dep)
              this.store.putEdge({
                from: fileNode.id,
                to: dep.id,
                type: "DEPENDS_ON",
                ownerFile: p.file.path,
                source: "package-manifest",
                confidence: 1,
                evidence: "deterministic",
                metadata: {},
              });
          }
      }
      if (this.config.git.enabled) {
        const signals = readGitSignals(this.root, this.config.git.maxCommits);
        if (signals) this.store.setMeta("git", signals);
      }
      this.store.setMeta("configHash", discovery.configHash);
      this.store.setMeta("topologyServices", this.config.topology.services);
      this.store.setMeta("communicationVersion", 1);
      this.store.setMeta("retrievalVersion", EXTRACTION_VERSION);
      const stats = this.store.stats();
      const result: IndexResult = {
        files: records.length,
        parsed: parsed.length,
        skipped: records.length - parsed.length,
        deleted: deleted.length,
        nodes: stats.nodes,
        edges: stats.edges,
        durationMs: Math.round(performance.now() - start),
        revision:
          oldRevision +
          (parsed.length || deleted.length || configChanged ? 1 : 0),
        diagnostics: [
          ...discovery.diagnostics,
          ...parsed.flatMap((p) => p.diagnostics),
        ].slice(0, 100),
      };
      this.store.finishRun(result);
      if (this.config.diagnostics) {
        const dir = safePath(this.root, ".pgraph/logs", false);
        mkdirSync(dir, { recursive: true });
        const log = safePath(this.root, ".pgraph/logs/index.jsonl", false);
        appendFileSync(
          log,
          JSON.stringify({
            ...result,
            diagnostics: result.diagnostics.length,
          }) + "\n",
        );
      }
      return result;
    });
    options.onProgress?.({
      phase: "complete",
      message: `Index committed: ${committed.files} files, ${committed.nodes} nodes, ${committed.edges} relationships`,
    });
    return committed;
  }
  private persistEdges(parsed: ParsedFile): void {
    for (const edge of parsed.edges)
      if (this.store.node(edge.from) && this.store.node(edge.to))
        this.store.putEdge(edge);
  }
}
