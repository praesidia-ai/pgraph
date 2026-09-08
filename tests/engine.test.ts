import { afterEach, describe, expect, it } from "vitest";
import {
  cpSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGraph, bpeCounter } from "@praesidia/pgraph-core";
import { SqliteGraphStore } from "@praesidia/pgraph-store-sqlite";
import { symbolId, compilerProvenance } from "@praesidia/pgraph-ir";
import { classifyTask, rank } from "@praesidia/pgraph-ranking";
import { optimizeBudget } from "@praesidia/pgraph-context";

const roots: string[] = [];
const graphs: PGraph[] = [];
function fixture(): { root: string; graph: PGraph } {
  const root = mkdtempSync(join(tmpdir(), "pgraph-test-"));
  roots.push(root);
  cpSync(resolve("examples/sample-typescript-app"), root, {
    recursive: true,
    filter: (p) => !p.includes(".pgraph"),
  });
  const graph = PGraph.open(root);
  graphs.push(graph);
  return { root, graph };
}
afterEach(() => {
  for (const graph of graphs.splice(0)) graph.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("IR and persistence", () => {
  it("normalizes deterministic IDs and rolls back failed writes", () => {
    expect(symbolId("typescript", "src\\a.ts", "A.login")).toBe(
      "typescript:src/a.ts:A.login",
    );
    const store = new SqliteGraphStore(":memory:");
    expect(() =>
      store.transaction(() => {
        store.putNode({
          id: "a",
          name: "a",
          qualifiedName: "a",
          kind: "function",
          language: "typescript",
          metadata: {},
          provenance: compilerProvenance,
        });
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(store.node("a")).toBeUndefined();
    store.close();
  });
  it("persists symbols and resolves cross-file calls, paths, tests and slices", () => {
    const { root, graph } = fixture();
    const result = graph.index();
    expect(result.nodes).toBeGreaterThan(30);
    expect(
      graph.callers("AuthService.login").map((n) => n.qualifiedName),
    ).toContain("AuthController.login");
    expect(
      graph.callees("AuthService.login").map((n) => n.qualifiedName),
    ).toEqual(
      expect.arrayContaining([
        "UserRepository.findByEmail",
        "PasswordService.verify",
        "TokenService.issue",
      ]),
    );
    expect(
      graph
        .path("AuthController.login", "TokenService.issue")
        .nodes.map((n) => n.qualifiedName),
    ).toEqual([
      "AuthController.login",
      "AuthService.login",
      "TokenService.issue",
    ]);
    expect(graph.testsFor("AuthService.login").map((n) => n.kind)).toContain(
      "test",
    );
    expect(
      graph
        .impact("AuthService.login")
        .directCallers.map((n) => n.qualifiedName),
    ).toContain("AuthController.login");
    expect(graph.slice("AuthService.login").source).toContain(
      "this.tokens.issue",
    );
    expect(graph.slice("AuthService.login").source).not.toContain("logout");
    expect(graph.skeleton("AuthService")).toContain(
      "login(email: string, password: string): string;",
    );
    expect(graph.skeleton("AuthService")).not.toContain("Invalid credentials");
    const reopened = PGraph.open(root);
    expect(reopened.symbol("AuthService.login").id).toBe(
      graph.symbol("AuthService.login").id,
    );
    reopened.close();
  });
});
describe("incrementality and boundaries", () => {
  it("skips unchanged files, updates reverse dependencies and rejects stale slices", () => {
    const { root, graph } = fixture();
    graph.index();
    expect(graph.index().parsed).toBe(0);
    const path = join(root, "src/auth.service.ts");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace("login(email", "signIn(email"),
    );
    expect(() => graph.slice("AuthService.login")).toThrow("Stale");
    const next = graph.index();
    expect(next.parsed).toBeLessThan(next.files);
    expect(next.parsed).toBeGreaterThan(1);
    expect(() => graph.symbol("AuthService.login")).toThrow("not found");
    expect(graph.symbol("AuthService.signIn")).toBeDefined();
    expect(
      graph.callees("AuthController.login").map((n) => n.qualifiedName),
    ).not.toContain("AuthService.login");
  });
  it("handles deleted and renamed files without dangling edges", () => {
    const { root, graph } = fixture();
    graph.index();
    unlinkSync(join(root, "src/account-lockout.service.spec.ts"));
    expect(graph.index().deleted).toBe(1);
    renameSync(
      join(root, "src/account-lockout.service.ts"),
      join(root, "src/lockout.ts"),
    );
    expect(graph.index().deleted).toBe(1);
    expect(graph.symbol("AccountLockoutService").location?.file).toBe(
      "src/lockout.ts",
    );
  });
  it("honors nested ignore rules, custom excludes, secrets and symlinks", () => {
    const { root, graph } = fixture();
    mkdirSync(join(root, "src/private"));
    writeFileSync(join(root, "src/.gitignore"), "private/\n");
    writeFileSync(
      join(root, "src/private/hidden.ts"),
      "export function hidden() {}",
    );
    writeFileSync(join(root, ".env.ts"), 'export const SECRET = "x";');
    symlinkSync("/etc/passwd", join(root, "src/escape.ts"));
    graph.index();
    expect(graph.searchSymbols("hidden")).toEqual([]);
    expect(graph.store.file(".env.ts")).toBeUndefined();
    expect(graph.store.file("src/escape.ts")).toBeUndefined();
    expect(() =>
      graph.fileSlice({ file: "../outside", startLine: 1, endLine: 1 }),
    ).toThrow();
  });
});
describe("ranking and budgeting", () => {
  it("solves representation choices rather than cutting characters", () => {
    expect(
      optimizeBudget(
        [
          [
            { cost: 3, utility: 4, value: "a" },
            { cost: 5, utility: 6, value: "A" },
          ],
          [{ cost: 2, utility: 4, value: "b" }],
        ],
        5,
      ),
    ).toEqual(["a", "b"]);
    expect(classifyTask("Why does login fail?")).toBe("debug");
    expect(
      rank(
        {
          id: "x",
          kind: "function",
          name: "login",
          qualifiedName: "login",
          language: "ts",
          metadata: {},
          provenance: compilerProvenance,
        },
        { terms: ["login"], strategy: "locate" },
      ),
    ).toBeGreaterThan(0);
  });
  it("enforces complete JSON and Markdown BPE budgets and caches by revision", () => {
    const { root, graph } = fixture();
    graph.index();
    for (const maxTokens of [500, 1500, 3000, 8000])
      for (const format of ["json", "markdown"] as const) {
        const context = graph.context({
          task: "Add account lockout to login",
          maxTokens,
          options: { format },
        });
        expect(bpeCounter.count(context.text)).toBeLessThanOrEqual(maxTokens);
        expect(context.package.symbols.length).toBeGreaterThan(0);
        if (maxTokens >= 1500)
          expect(context.package.symbols.map((s) => s.symbol)).toContain(
            "AuthService.login",
          );
        if (format === "json")
          expect(JSON.parse(context.text).tokenBudget).toBe(maxTokens);
      }
    const request = { task: "Find AuthService login", maxTokens: 1500 };
    graph.context(request);
    expect(graph.context(request).metrics.cacheHit).toBe(true);
    const path = join(root, "src/auth.service.ts");
    writeFileSync(path, readFileSync(path, "utf8") + "\n");
    expect(() => graph.context(request)).toThrow("Stale");
  });
});
