import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PGraph, bpeCounter } from "@praesidia/pgraph-core";
import { dispatchTool } from "@praesidia/pgraph-tools";

const fixtures: { root: string; graph: PGraph }[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pgraph-daily-"));
  const write = (file: string, text: string) =>
    writeFileSync(join(root, file), text);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "core.fsmonitor=false", "-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  mkdirSync(join(root, "src"));
  write(
    "package.json",
    JSON.stringify({
      name: "daily-fixture",
      type: "module",
      scripts: {
        test: "node -e 'process.exit(0)'",
        lint: "node -e 'process.exit(1)'",
        deploy: "echo not a check",
      },
    }),
  );
  write(".gitignore", ".pgraph/\n");
  const original = `export function compute(amount: number): number {
  if (amount < 0) throw new Error('Negative balance');
  return amount * 2;
}
export function untouched(value: number): number {
  return value + 1;
}
export function untested(value: number): number {
  return value - 1;
}
`;
  write("src/core.ts", original);
  write(
    "src/core.test.ts",
    `import { compute } from './core.js';
declare function test(name:string,fn:()=>void):void;
test('valid amount',()=>{compute(3);});
`,
  );
  write(
    "src/front.ts",
    `import { compute } from './core.js'; export function front() { return compute(2); }\n`,
  );
  git("init");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "fixture",
  );
  const graph = PGraph.open(root);
  graph.index();
  fixtures.push({ root, graph });
  return { root, graph, write, git, original };
}
afterEach(() => {
  for (const { root, graph } of fixtures.splice(0)) {
    graph.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("detects changed, added, removed and configuration inputs before trusting an index", () => {
  const { graph, write, root } = fixture();
  const first = graph.health();
  expect(first.current).toBe(true);
  write("src/new.ts", "export const newlyAdded = 1;\n");
  rmSync(join(root, "src/front.ts"));
  write("package-lock.json", '{"lockfileVersion":3}');
  const current = graph.health();
  expect(current.current).toBe(false);
  expect(current.configChanged).toBe(true);
  expect(current.changed).toContainEqual({ file: "src/new.ts", reason: "new" });
  expect(current.changed).toContainEqual({
    file: "src/front.ts",
    reason: "deleted or excluded",
  });
  expect(current.fingerprint).not.toBe(first.fingerprint);
  graph.index();
  expect(graph.health().current).toBe(true);
});

it("finds literal error text with locations, scopes, pagination and stale-file exclusion", () => {
  const { graph, write, original } = fixture();
  const found = graph.searchText("Negative balance");
  expect(found.matches[0]?.symbol).toBe(graph.symbol("compute").id);
  expect(found.matches[0]?.line).toBe(2);
  expect(
    graph.searchText("negative balance", { caseSensitive: true }).matches,
  ).toEqual([]);
  expect(
    graph.searchText("return", { scope: "src/core.ts", limit: 1 }).nextOffset,
  ).toBe(1);
  expect(
    graph.searchText("return", { scope: "src/core.ts", limit: 1, offset: 1 })
      .matches[0]?.line,
  ).toBe(6);
  write("src/core.ts", original + "\n");
  const stale = graph.searchText("Negative balance");
  expect(stale.matches).toEqual([]);
  expect(stale.warnings[0]).toContain("stale");
  expect(() => graph.searchText("\n")).toThrow();
});

it("maps real-style relative, absolute and file-URL stack frames and leaves external frames unknown", () => {
  const { graph, root } = fixture();
  const trace = `Error: Negative balance\n    at compute (${join(root, "src/core.ts")}:2:9)\n    at front (src/front.ts:1:70)\n    at compute (${pathToFileURL(join(root, "src/core.ts")).href}:2:9)\n    at other (/outside/hidden.ts:2:1)`;
  const result = graph.traceError(trace);
  expect(result.frames).toHaveLength(4);
  expect(result.frames[0]?.symbol).toBe(graph.symbol("compute").id);
  expect(result.frames[2]?.source).toContain("Negative balance");
  expect(result.frames[3]?.error).toBeTruthy();
});

it("shows file consumers and finds cyclic dependency components", () => {
  const { graph, write } = fixture();
  expect(graph.fileOverview("src/core.ts").dependents).toContain(
    "src/front.ts",
  );
  write(
    "src/a.ts",
    "import { b } from './b.js'; export function a():number { return b(); }\n",
  );
  write(
    "src/b.ts",
    "import { a } from './a.js'; export function b():number { return a(); }\n",
  );
  graph.index();
  expect(graph.dependencyCycles().components).toContainEqual([
    "src/a.ts",
    "src/b.ts",
  ]);
  expect(() => graph.fileOverview("../outside.ts")).toThrow();
});

it("maps a changed hunk to its declaration and does not pull in unrelated siblings", () => {
  const { graph, write, original } = fixture();
  write("src/core.ts", original.replace("amount * 2", "amount * 3"));
  graph.index();
  const result = graph.changedDeclarations();
  expect(result.declarations.map((d) => d.node.name)).toEqual(["compute"]);
  expect(result.declarations[0]?.hunks).toEqual([1]);
  const gaps = graph.testGaps();
  expect(gaps.rows[0]?.assessment).toBe("candidate tests found");
  expect(gaps.rows[0]?.tests[0]?.name).toBe("valid amount");
});

it("reports removed files and zero-line deletion uncertainty", () => {
  const { graph, write, root, original } = fixture();
  write("src/core.ts", original.replace("  return value - 1;\n", ""));
  rmSync(join(root, "src/front.ts"));
  graph.index();
  const result = graph.changedDeclarations();
  expect(
    result.unknown.some((u) => u.reason.includes("removed or top-level")),
  ).toBe(true);
  expect(
    result.unknown.some(
      (u) => u.file === "src/front.ts" && u.reason.includes("Deleted"),
    ),
  ).toBe(true);
});

it("distinguishes staged and branch snapshots and rejects mismatched working-source mapping", () => {
  const { graph, write, git, original } = fixture();
  const base = git("rev-parse", "HEAD").trim();
  write("src/core.ts", original.replace("amount * 2", "amount * 3"));
  git("add", "src/core.ts");
  graph.index();
  expect(
    graph
      .changedDeclarations({ mode: "staged" })
      .declarations.map((d) => d.node.name),
  ).toEqual(["compute"]);
  write("src/core.ts", original.replace("amount * 2", "amount * 4"));
  graph.index();
  expect(
    graph.changedDeclarations({ mode: "staged" }).unknown[0]?.reason,
  ).toContain("differs");
  git("add", "src/core.ts");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "change",
  );
  expect(
    graph
      .changedDeclarations({ mode: "branch", base })
      .declarations.map((d) => d.node.name),
  ).toEqual(["compute"]);
  expect(() => graph.changedDeclarations({ mode: "branch" })).toThrow(
    "explicit base",
  );
  expect(() => graph.changedDeclarations({ base: "--output=bad" })).toThrow(
    "Invalid",
  );
});

it("keeps nested Git-root mappings inside the selected repository", () => {
  const { graph, root, git, write } = fixture();
  mkdirSync(join(root, "nested"));
  write("nested/child.ts", "export function child() { return 1; }\n");
  git("add", "nested/child.ts");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "nested",
  );
  const nested = PGraph.open(join(root, "nested"));
  try {
    write("nested/child.ts", "export function child() { return 2; }\n");
    git("add", "nested/child.ts");
    nested.index();
    expect(
      nested.changedDeclarations({ mode: "staged" }).declarations[0]?.node.name,
    ).toBe("child");
  } finally {
    nested.close();
  }
  expect(graph.root).toBe(realpathSync(root));
});

it("separates missing static test paths from proved coverage", () => {
  const { graph, write, original } = fixture();
  write("src/core.ts", original.replace("value - 1", "value - 2"));
  graph.index();
  const gaps = graph.testGaps();
  expect(gaps.rows[0]?.node.name).toBe("untested");
  expect(gaps.rows[0]?.assessment).toBe("no static test path found");
  expect(gaps.warnings[0]).toContain("not execution coverage");
});

it("discovers package checks without executing scripts and detects stale manifests", () => {
  const { graph, write, root } = fixture();
  const checks = graph.checks();
  expect(checks.checks.map((c) => c.script).sort()).toEqual(["lint", "test"]);
  write(
    "package.json",
    readFileSync(join(root, "package.json"), "utf8") + "\n",
  );
  expect(graph.checks().checks).toEqual([]);
  expect(() => graph.verification.begin("package.json#test")).toThrow();
});

it("records selected check outcomes and invalidates them after code, config and newly discovered file changes", () => {
  const { graph, write, original } = fixture();
  const run = graph.verification.begin("package.json#test");
  expect(run.args.slice(-2)).toEqual(["run", "test"]);
  expect(() => graph.verification.finish("invalid", 0)).toThrow();
  expect(graph.verification.finish(run.id, 0).result).toBe("passed");
  expect(graph.verification.results().runs[0]?.freshness).toBe(
    "tracked inputs current",
  );
  const pending = graph.verification.begin("package.json#lint");
  write("src/core.ts", original + "\n");
  const result = graph.verification.finish(pending.id, 1);
  expect(result.result).toBe("failed");
  expect(result.inputsChangedDuringRun).toBe(true);
  expect(
    graph.verification.results().runs.every((r) => r.freshness === "stale"),
  ).toBe(true);
  graph.index();
  const third = graph.verification.begin("package.json#test");
  graph.verification.finish(third.id, null);
  expect(graph.verification.results().runs[0]?.result).toBe("cancelled");
  write("src/new.ts", "export const newFile=1;");
  expect(graph.verification.results().runs[0]?.freshness).toBe("stale");
});

it("preserves completed verification records across restart and refuses unknown pending runs", () => {
  const { graph, root } = fixture();
  const run = graph.verification.begin("package.json#test");
  graph.verification.finish(run.id, 0);
  const pending = graph.verification.begin("package.json#test");
  const fresh = PGraph.open(root, { readOnly: true });
  try {
    expect(fresh.verification.results().runs[0]?.result).toBe("passed");
    expect(() => fresh.verification.finish(pending.id, 0)).toThrow("Unknown");
  } finally {
    fresh.close();
  }
});

it("exposes daily queries through one bounded agent tool and rejects execution requests", () => {
  const { graph } = fixture();
  for (const action of [
    "health",
    "text",
    "trace",
    "file",
    "cycles",
    "changes",
    "test_gaps",
    "checks",
    "verification",
  ]) {
    const input = {
      action,
      ...(action === "text"
        ? { query: "Negative balance" }
        : action === "trace"
          ? { query: "at compute (src/core.ts:2:9)" }
          : action === "file"
            ? { file: "src/core.ts" }
            : {}),
      maxTokens: 500,
    };
    const output = dispatchTool(graph, "workflow", input);
    expect(bpeCounter.count(output)).toBeLessThanOrEqual(500);
    expect(() => JSON.parse(output)).not.toThrow();
  }
  expect(() => dispatchTool(graph, "workflow", { action: "run" })).toThrow();
  expect(() =>
    dispatchTool(graph, "workflow", { action: "health", root: "/other" }),
  ).toThrow();
});
