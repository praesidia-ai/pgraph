import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteGraphStore } from "@praesidia/pgraph-store-sqlite";
import { compilerProvenance, type GraphNode } from "@praesidia/pgraph-ir";
const node = (id: string): GraphNode => ({
  id,
  kind: "function",
  name: id,
  qualifiedName: id,
  language: "ts",
  metadata: {},
  provenance: compilerProvenance,
});
it("migrates legacy FTS row IDs and maintains replacement search entries", () => {
  const root = mkdtempSync(join(tmpdir(), "pgraph-migration-"));
  const path = join(root, "graph.db");
  try {
    let store = new SqliteGraphStore(path);
    store.putNode(node("before"));
    store.close();
    const old = new DatabaseSync(path);
    old.exec(
      "DROP TABLE node_search; CREATE VIRTUAL TABLE node_search USING fts5(id UNINDEXED,text,tokenize='unicode61'); INSERT INTO node_search(rowid,id,text) VALUES(77,'before','before'); PRAGMA user_version=1;",
    );
    old.close();
    expect(() => new SqliteGraphStore(path, { readOnly: true })).toThrow(
      "migration",
    );
    store = new SqliteGraphStore(path);
    expect(store.search("before")).toHaveLength(1);
    store.putNode({ ...node("before"), name: "after", qualifiedName: "after" });
    expect(store.search("before")).toHaveLength(0);
    expect(store.search("after")).toHaveLength(1);
    store.close();
    const readOnly = new SqliteGraphStore(path, { readOnly: true });
    expect(() => readOnly.setMeta("bad", true)).toThrow();
    expect(readOnly.search("after")).toHaveLength(1);
    readOnly.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("does not cap file invalidation at the interactive adjacency limit", () => {
  const store = new SqliteGraphStore(":memory:");
  try {
    store.transaction(() => {
      store.putFile({
        path: "target.ts",
        hash: "h",
        language: "typescript",
        bytes: 1,
        lines: 1,
        indexedAt: "now",
      });
      store.putNode({
        ...node("target"),
        location: {
          file: "target.ts",
          startLine: 1,
          endLine: 1,
          startOffset: 0,
          endOffset: 1,
        },
      });
      for (let i = 0; i < 2105; i++) {
        store.putNode(node(`caller${i}`));
        store.putEdge({
          from: `caller${i}`,
          to: "target",
          type: "CALLS",
          ownerFile: `caller${i}.ts`,
          metadata: {},
          ...compilerProvenance,
        });
      }
    });
    expect(store.neighbors("target", "in", [], 2000)).toHaveLength(2000);
    expect(store.dependentFiles("target.ts")).toHaveLength(2105);
  } finally {
    store.close();
  }
});
it("preserves case-sensitive language identity while using the name index", () => {
  const store = new SqliteGraphStore(":memory:");
  try {
    store.putNode(node("Login"));
    store.putNode(node("login"));
    expect(store.resolve("Login").map((n) => n.id)).toEqual(["Login"]);
    expect(store.resolve("login").map((n) => n.id)).toEqual(["login"]);
  } finally {
    store.close();
  }
});
