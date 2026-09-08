import { DatabaseSync } from "node:sqlite";
import type { GraphStore } from "@praesidia/pgraph-store";
import type {
  EdgeType,
  FileRecord,
  GraphEdge,
  GraphNode,
  GraphStats,
  IndexResult,
  Neighbor,
  SearchOptions,
  SemanticFact,
} from "@praesidia/pgraph-ir";
import { bounded, words } from "@praesidia/pgraph-shared";

type Row = Record<string, unknown>;
const decode = <T>(row: Row | undefined): T | undefined =>
  row ? (JSON.parse(String(row.data)) as T) : undefined;
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

export class SqliteGraphStore implements GraphStore {
  private readonly db: DatabaseSync;
  constructor(path: string, options: { readOnly?: boolean } = {}) {
    this.db = new DatabaseSync(path, {
      timeout: 5000,
      enableForeignKeyConstraints: true,
      readOnly: options.readOnly ?? false,
    });
    this.db.exec(
      options.readOnly
        ? "PRAGMA trusted_schema=OFF;"
        : "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA trusted_schema=OFF;",
    );
    const version = Number(
      this.db.prepare("PRAGMA user_version").get()?.user_version,
    );
    if (version > 2) {
      this.db.close();
      throw new Error(`Unsupported graph schema ${version}; upgrade PGraph`);
    }
    if (version < 2 && options.readOnly) {
      this.db.close();
      throw new Error(
        "Graph schema needs initialization/migration; run pgraph index",
      );
    }
    if (version === 0)
      this.transaction(() => {
        this.db.exec(`
        CREATE TABLE files(path TEXT PRIMARY KEY, hash TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX files_hash ON files(hash);
        CREATE TABLE nodes(id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
          qualified_name TEXT NOT NULL, file TEXT REFERENCES files(path) ON DELETE CASCADE, data TEXT NOT NULL);
        CREATE INDEX nodes_name ON nodes(name COLLATE NOCASE);
        CREATE INDEX nodes_qualified ON nodes(qualified_name);
        CREATE INDEX nodes_file ON nodes(file);
        CREATE INDEX nodes_kind ON nodes(kind);
        CREATE VIRTUAL TABLE node_search USING fts5(id UNINDEXED, text, tokenize='unicode61');
        CREATE TABLE edges(source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
          target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, type TEXT NOT NULL,
          owner TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(source,target,type,owner));
        CREATE INDEX edges_target ON edges(target,type);
        CREATE INDEX edges_type ON edges(type);
        CREATE INDEX edges_owner ON edges(owner);
        CREATE TABLE metadata(key TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE index_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
        CREATE TABLE semantic_cache(id TEXT PRIMARY KEY, symbol_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, data TEXT NOT NULL);
        CREATE INDEX semantic_symbol ON semantic_cache(symbol_id);
        CREATE TABLE semantic_dependencies(fact_id TEXT REFERENCES semantic_cache(id) ON DELETE CASCADE, path TEXT, PRIMARY KEY(fact_id,path));
        CREATE INDEX semantic_path ON semantic_dependencies(path);
        PRAGMA user_version=1;
      `);
      });
    if (version < 2)
      this.transaction(() => {
        this.db
          .exec(`CREATE VIRTUAL TABLE node_search_v2 USING fts5(id UNINDEXED,text,tokenize='unicode61');
        INSERT INTO node_search_v2(rowid,id,text) SELECT n.rowid,s.id,s.text FROM node_search s JOIN nodes n ON n.id=s.id;
        DROP TABLE node_search;
        ALTER TABLE node_search_v2 RENAME TO node_search;
        PRAGMA user_version=2;`);
      });
  }
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  files(): FileRecord[] {
    return this.db
      .prepare("SELECT data FROM files ORDER BY path")
      .all()
      .map((r) => decode<FileRecord>(r)!);
  }
  file(path: string): FileRecord | undefined {
    return decode(
      this.db.prepare("SELECT data FROM files WHERE path=?").get(path),
    );
  }
  putFile(file: FileRecord): void {
    this.db
      .prepare(
        "INSERT INTO files VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash,data=excluded.data",
      )
      .run(file.path, file.hash, JSON.stringify(file));
  }
  removeFile(path: string): void {
    this.removeOwnedEdges(path);
    this.db
      .prepare(
        "DELETE FROM node_search WHERE rowid IN (SELECT rowid FROM nodes WHERE file=?)",
      )
      .run(path);
    this.db.prepare("DELETE FROM files WHERE path=?").run(path);
  }
  removeOwnedEdges(path: string): void {
    this.db.prepare("DELETE FROM edges WHERE owner=?").run(path);
  }
  pruneNodes(path: string, keepIds: string[]): void {
    const keep = new Set(keepIds);
    for (const row of this.db
      .prepare("SELECT id FROM nodes WHERE file=?")
      .all(path)) {
      if (!keep.has(String(row.id))) {
        this.db
          .prepare(
            "DELETE FROM node_search WHERE rowid=(SELECT rowid FROM nodes WHERE id=?)",
          )
          .run(String(row.id));
        this.db.prepare("DELETE FROM nodes WHERE id=?").run(String(row.id));
      }
    }
  }
  putNode(node: GraphNode): void {
    this.db
      .prepare(
        `INSERT INTO nodes VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      kind=excluded.kind,name=excluded.name,qualified_name=excluded.qualified_name,file=excluded.file,data=excluded.data`,
      )
      .run(
        node.id,
        node.kind,
        node.name,
        node.qualifiedName,
        node.location?.file ?? null,
        JSON.stringify(node),
      );
    const rowid = this.db
      .prepare("SELECT rowid FROM nodes WHERE id=?")
      .get(node.id)!.rowid as number;
    this.db.prepare("DELETE FROM node_search WHERE rowid=?").run(rowid);
    this.db
      .prepare("INSERT INTO node_search(rowid,id,text) VALUES(?,?,?)")
      .run(
        rowid,
        node.id,
        words(
          `${node.name} ${node.qualifiedName} ${node.location?.file ?? ""} ${node.signature ?? ""} ${String(node.metadata.framework ?? "")}`,
        ).join(" "),
      );
  }
  putEdge(edge: GraphEdge): void {
    if (edge.type === "CALLED_BY")
      throw new Error("CALLED_BY is a virtual reverse traversal; store CALLS");
    if (
      !Number.isFinite(edge.confidence) ||
      edge.confidence < 0 ||
      edge.confidence > 1
    )
      throw new Error("Invalid confidence");
    this.db
      .prepare(
        "INSERT INTO edges VALUES(?,?,?,?,?) ON CONFLICT(source,target,type,owner) DO UPDATE SET data=excluded.data",
      )
      .run(edge.from, edge.to, edge.type, edge.ownerFile, JSON.stringify(edge));
  }
  node(id: string): GraphNode | undefined {
    return decode(this.db.prepare("SELECT data FROM nodes WHERE id=?").get(id));
  }
  resolve(name: string, limit = 20): GraphNode[] {
    bounded(limit, 1, 500, "limit");
    return this.db
      .prepare(
        `SELECT data FROM nodes WHERE id=? OR qualified_name=? OR (name=? COLLATE NOCASE AND name=?)
      ORDER BY CASE WHEN id=? THEN 0 WHEN qualified_name=? THEN 1 ELSE 2 END,id LIMIT ?`,
      )
      .all(name, name, name, name, name, name, limit)
      .map((r) => decode<GraphNode>(r)!);
  }
  search(query: string, options: SearchOptions = {}): GraphNode[] {
    const limit = bounded(options.limit ?? 30, 1, 500, "limit");
    const offset = bounded(options.offset ?? 0, 0, 1_000_000, "offset");
    const clauses: string[] = [];
    const args: (string | number)[] = [];
    if (options.scope) {
      clauses.push("n.file LIKE ? ESCAPE '\\'");
      args.push(`${escapeLike(options.scope.replace(/\/$/, ""))}/%`);
    }
    if (options.kind) {
      clauses.push("n.kind=?");
      args.push(options.kind);
    }
    const terms = [...new Set(words(query))].slice(0, 30);
    if (terms.length) {
      const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
      const matches = this.db
        .prepare(
          `SELECT n.data FROM node_search JOIN nodes n ON n.rowid=node_search.rowid WHERE node_search MATCH ? ${extra} ORDER BY node_search.rank LIMIT ? OFFSET ?`,
        )
        .all(terms.map((t) => `"${t}"*`).join(" OR "), ...args, limit, offset)
        .map((row) => decode<GraphNode>(row)!);
      if (matches.length || offset > 0) return matches;
      clauses.push("n.name LIKE ? ESCAPE '\\'");
      args.push(`%${escapeLike(query.slice(0, 500))}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT n.data FROM nodes n ${where} ORDER BY n.qualified_name,n.id LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset)
      .map((r) => decode<GraphNode>(r)!);
  }
  nodesInFile(path: string): GraphNode[] {
    return this.db
      .prepare("SELECT data FROM nodes WHERE file=? ORDER BY id")
      .all(path)
      .map((r) => decode<GraphNode>(r)!);
  }
  dependentFiles(path: string): string[] {
    return this.db
      .prepare(
        "SELECT DISTINCT e.owner FROM edges e JOIN nodes n ON e.target=n.id WHERE n.file=? AND e.owner<>? ORDER BY e.owner",
      )
      .all(path, path)
      .map((row) => String(row.owner));
  }
  neighbors(
    id: string,
    direction: "out" | "in",
    types: EdgeType[] = [],
    limit = 100,
  ): Neighbor[] {
    bounded(limit, 1, 2000, "limit");
    const source = direction === "out" ? "source" : "target";
    const target = direction === "out" ? "target" : "source";
    const filter = types.length
      ? `AND e.type IN (${types.map(() => "?").join(",")})`
      : "";
    return this.db
      .prepare(
        `SELECT n.data AS node,e.data AS edge FROM edges e JOIN nodes n ON n.id=e.${target}
      WHERE e.${source}=? ${filter} ORDER BY e.type,n.id LIMIT ?`,
      )
      .all(id, ...types, limit)
      .map((r) => ({
        node: JSON.parse(String(r.node)) as GraphNode,
        edge: JSON.parse(String(r.edge)) as GraphEdge,
      }));
  }
  getMeta<T>(key: string): T | undefined {
    return decode(
      this.db.prepare("SELECT data FROM metadata WHERE key=?").get(key),
    );
  }
  setMeta(key: string, value: unknown): void {
    this.db
      .prepare(
        "INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
      )
      .run(key, JSON.stringify(value));
  }
  finishRun(result: IndexResult): void {
    this.db
      .prepare("INSERT INTO index_runs(data) VALUES(?)")
      .run(JSON.stringify(result));
    this.db
      .prepare(
        "DELETE FROM index_runs WHERE id NOT IN (SELECT id FROM index_runs ORDER BY id DESC LIMIT 100)",
      )
      .run();
    this.setMeta("revision", result.revision);
    this.setMeta("lastIndex", result);
  }
  stats(): GraphStats {
    const count = (table: string): number =>
      Number(
        this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count,
      );
    return {
      files: count("files"),
      nodes: count("nodes"),
      edges: count("edges"),
      revision: this.getMeta<number>("revision") ?? 0,
      lastIndex: this.getMeta<IndexResult>("lastIndex"),
    };
  }
  putSemantic(fact: SemanticFact): void {
    this.db
      .prepare(
        "INSERT INTO semantic_cache VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET symbol_id=excluded.symbol_id,data=excluded.data",
      )
      .run(fact.id, fact.symbolId, JSON.stringify(fact));
    this.db
      .prepare("DELETE FROM semantic_dependencies WHERE fact_id=?")
      .run(fact.id);
    for (const path of Object.keys(fact.hashes))
      this.db
        .prepare("INSERT INTO semantic_dependencies VALUES(?,?)")
        .run(fact.id, path);
  }
  semantic(symbolId?: string): SemanticFact[] {
    return (
      symbolId
        ? this.db
            .prepare("SELECT data FROM semantic_cache WHERE symbol_id=?")
            .all(symbolId)
        : this.db
            .prepare("SELECT data FROM semantic_cache ORDER BY id LIMIT 1000")
            .all()
    ).map((r) => decode<SemanticFact>(r)!);
  }
  invalidateSemantic(paths: string[]): void {
    for (const path of paths)
      this.db
        .prepare(
          "DELETE FROM semantic_cache WHERE id IN (SELECT fact_id FROM semantic_dependencies WHERE path=?)",
        )
        .run(path);
  }
  close(): void {
    this.db.close();
  }
}
