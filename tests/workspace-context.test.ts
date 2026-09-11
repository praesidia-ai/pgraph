import { afterEach, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGraph, bpeCounter } from "@praesidia/pgraph-core";
import { hash } from "@praesidia/pgraph-shared";
import {
  workspaceCandidate,
  packWorkspaceContext,
  dispatchTool,
  type WorkspaceProject,
} from "@praesidia/pgraph-tools";

const graphs: PGraph[] = [];
afterEach(() => {
  for (const graph of graphs.splice(0)) {
    graph.close();
    rmSync(graph.root, { recursive: true, force: true });
  }
});
function fixture(value: string) {
  const root = mkdtempSync(join(tmpdir(), "pgraph-context-workspace-"));
  writeFileSync(join(root, "package.json"), '{"name":"same-project-name"}');
  writeFileSync(
    join(root, "index.ts"),
    `export function deliverOrder() { return '${value}'; }\n`,
  );
  const graph = PGraph.open(root);
  graphs.push(graph);
  graph.index();
  return graph;
}
function candidate(graph: PGraph): WorkspaceProject {
  const data = workspaceCandidate(graph, {
    task: "deliverOrder",
    maxTokens: 2000,
  });
  return { project: data.project, name: "same-name", data };
}
it("retains same-name project and symbol identities, verified source hashes and root-bound follow-ups", () => {
  const a = fixture("send-order"),
    b = fixture("receive-order");
  const inputs = [candidate(a), candidate(b)];
  const result = JSON.parse(packWorkspaceContext(inputs, 4000));
  expect(result.scope).toBe("workspace");
  expect(result.projects).toHaveLength(2);
  expect(result.projects[0].project).not.toBe(result.projects[1].project);
  for (const [i, project] of result.projects.entries()) {
    expect(project.revision).toBeGreaterThan(0);
    expect(project.observedAt).toMatch(/^\d{4}-/);
    const symbol = project.symbols.find(
      (s: { symbol: string }) => s.symbol === "deliverOrder",
    );
    expect(symbol.sourceHash).toBe([a, b][i]!.store.file("index.ts")!.hash);
    expect(symbol.representation).toBe("source");
    const follow = dispatchTool([a, b][i]!, "slice", {
      symbol: symbol.id,
      project: project.project,
    });
    expect(follow).toContain(i ? "receive-order" : "send-order");
  }
  expect(() =>
    dispatchTool(a, "slice", {
      project: inputs[1]!.project,
      symbol: "deliverOrder",
    }),
  ).toThrow("configured repository");
});
it("counts the whole serialized workspace response and preserves partial failures and omissions", () => {
  const a = fixture("orders"),
    b = fixture("billing");
  const inputs = [
    candidate(a),
    candidate(b),
    {
      project: hash("unindexed").slice(0, 24),
      name: "missing-index",
      error: "Index this project first",
    },
  ];
  for (const format of ["json", "markdown"] as const)
    for (const budget of [128, 500, 1000, 2000, 32000]) {
      const text = packWorkspaceContext(inputs, budget, format, [
        "Only direct child repositories discovered",
      ]);
      expect(bpeCounter.count(text)).toBeLessThanOrEqual(budget);
      if (budget >= 2000) {
        expect(text).toContain("missing-index");
        expect(text).toContain("Index this project first");
        expect(text).toContain("sourceHash");
      }
    }
  const tiny = JSON.parse(packWorkspaceContext(inputs, 128));
  expect(tiny.error).toContain("Choose Scope");
  const result = JSON.parse(packWorkspaceContext(inputs, 1000));
  expect(result.partial).toBe(true);
  expect(
    result.projects.every((p: { omittedSymbols: number }) =>
      Number.isInteger(p.omittedSymbols),
    ),
  ).toBe(true);
});
it("rejects stale source, independent receipts, missing indexes and duplicate or mismatched roots", () => {
  const graph = fixture("orders");
  const item = candidate(graph);
  expect(() =>
    workspaceCandidate(graph, {
      task: "deliverOrder",
      focus: { file: "index.ts", line: 1 },
    }),
  ).toThrow("one explicit project");
  expect(() =>
    workspaceCandidate(graph, {
      task: "deliverOrder",
      previousContextId: "a".repeat(24),
    }),
  ).toThrow("one explicit project");
  expect(() => packWorkspaceContext([item, item], 2000)).toThrow("identities");
  expect(() =>
    packWorkspaceContext([{ ...item, project: "b".repeat(24) }], 2000),
  ).toThrow("identities");
  writeFileSync(
    join(graph.root, "index.ts"),
    "export function deliverOrder() { return 'changed'; }\n",
  );
  expect(() => candidate(graph)).toThrow("Stale");
  const root = mkdtempSync(join(tmpdir(), "pgraph-context-unindexed-"));
  const empty = PGraph.open(root);
  graphs.push(empty);
  expect(() => candidate(empty)).toThrow("Index this project");
});
