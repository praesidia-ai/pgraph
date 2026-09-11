import { afterEach, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGraph, bpeCounter } from "@praesidia/pgraph-core";
import { dispatchTool } from "@praesidia/pgraph-tools";

const fixtures: { root: string; graph: PGraph }[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pgraph-power-"));
  writeFileSync(
    join(root, "package.json"),
    '{"name":"power-fixture","type":"module"}',
  );
  writeFileSync(
    join(root, "ledger.ts"),
    `export interface Ledger { save(amount: number): number; }
export class SqlLedger implements Ledger {
  /** Save a positive balance after validating the amount. */
  save(amount: number) {
    if (amount < 0) throw new Error('Negative balance');
    const rounded = Math.round(amount * 100) / 100;
    return rounded * 2;
  }
}
export class OtherLedger implements Ledger { save(amount: number) { return amount; } }
export class Unrelated { save(amount: number) { return amount; } }
export function throughInterface(ledger: Ledger, amount: number) { return ledger.save(amount); }
export function directly(amount: number) { return new SqlLedger().save(amount); }
export function injected(amount: number) { return throughInterface(new SqlLedger(), amount); }
`,
  );
  writeFileSync(
    join(root, "ledger.test.ts"),
    `import { directly, injected } from './ledger.js';
declare function test(name: string, fn: () => void): void;
test('direct concrete call', () => { directly(3); });
test('injected concrete call', () => { injected(3); });
`,
  );
  const graph = PGraph.open(root);
  fixtures.push({ root, graph });
  graph.index();
  return { root, graph };
}
afterEach(() => {
  for (const { root, graph } of fixtures.splice(0)) {
    graph.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("links declared interface members and distinguishes direct test paths from possible dispatch", () => {
  const { graph } = fixture();
  expect(
    graph
      .implementations("Ledger.save")
      .map((node) => node.qualifiedName)
      .sort(),
  ).toEqual(["OtherLedger.save", "SqlLedger.save"]);
  const result = graph.testPaths("SqlLedger.save");
  expect(
    result.tests.find((test) => test.node.name === "direct concrete call")
      ?.potentialDispatch,
  ).toBe(false);
  const injected = result.tests.find(
    (test) => test.node.name === "injected concrete call",
  );
  expect(injected?.potentialDispatch).toBe(true);
  expect(injected?.path.some((edge) => edge.type === "IMPLEMENTS")).toBe(true);
  expect(result.warnings.join(" ")).toContain("unresolved");
  const impact = graph.impact("SqlLedger.save", { depth: 4 });
  expect(impact.tests.map((node) => node.name)).toContain(
    "injected concrete call",
  );
  expect(
    impact.likelyChangeSurface.find(
      (item) => item.node.name === "injected concrete call",
    )?.potentialDispatch,
  ).toBe(true);
  expect(graph.testPaths("SqlLedger.save", { depth: 1 }).truncated).toBe(true);
  expect(graph.testPaths("SqlLedger.save", { limit: 1 }).truncated).toBe(true);
});

it("removes member relationships after a declared contract is removed", () => {
  const { root, graph } = fixture();
  writeFileSync(
    join(root, "ledger.ts"),
    readFileSync(join(root, "ledger.ts"), "utf8").replace(
      "SqlLedger implements Ledger",
      "SqlLedger",
    ),
  );
  graph.index();
  expect(
    graph.implementations("Ledger.save").map((node) => node.qualifiedName),
  ).toEqual(["OtherLedger.save"]);
});

it("returns targeted, verified excerpts from large declarations and rejects stale source", () => {
  const { root, graph } = fixture();
  const content = `export class Handler {\n  reconcile(amount: number) {\n${Array.from({ length: 210 }, (_, i) => `    amount += ${i};`).join("\n")}\n    if (amount === 900) throw new Error('chargeback reconciliation');\n    return amount;\n  }\n}\n`;
  writeFileSync(join(root, "handler.ts"), content);
  graph.index();
  const excerpt = graph.excerpt("Handler.reconcile", {
    query: "chargeback reconciliation",
    maxLines: 12,
  });
  expect(excerpt.source).toContain("chargeback");
  expect(excerpt.source.split("\n").length).toBe(12);
  expect(excerpt.omittedBefore).toBeGreaterThan(100);
  expect(excerpt.complete).toBe(false);
  expect(excerpt.warning).toContain("Partial");
  expect(excerpt.source).toBe(
    content
      .split("\n")
      .slice(excerpt.startLine - 1, excerpt.endLine)
      .join("\n"),
  );
  const context = graph.context({
    task: "Change Handler.reconcile chargeback reconciliation",
    maxTokens: 2000,
    options: { format: "markdown" },
  });
  const target = context.package.symbols.find(
    (symbol) => symbol.symbol === "Handler.reconcile",
  );
  expect(target?.representation).toBe("excerpt");
  expect(target?.text).toContain("chargeback");
  const tool = dispatchTool(graph, "excerpt", {
    symbol: "Handler.reconcile",
    query: "chargeback",
    maxTokens: 400,
  });
  expect(bpeCounter.count(tool)).toBeLessThanOrEqual(400);
  expect(JSON.parse(tool).source).toContain("chargeback");
  expect(() => graph.excerpt("Handler.reconcile", { line: 1 })).toThrow();
  writeFileSync(join(root, "handler.ts"), content + "\n");
  expect(() => graph.excerpt("Handler.reconcile")).toThrow("Stale");
});

it("keeps the target implementation and an evidenced test in task context", () => {
  const { graph } = fixture();
  const result = graph.context({
    task: "Find tests for SqlLedger.save",
    maxTokens: 2000,
    options: { format: "markdown", explain: true },
  });
  expect(
    result.package.symbols.find((symbol) => symbol.symbol === "SqlLedger.save")
      ?.representation,
  ).toBe("source");
  expect(result.package.tests).toContain("direct concrete call");
  expect(result.package.selection?.candidates).toBeGreaterThan(0);
  expect(bpeCounter.count(result.text)).toBeLessThanOrEqual(2000);
  expect(
    JSON.parse(
      dispatchTool(graph, "tests", {
        symbol: "SqlLedger.save",
        maxTokens: 3000,
      }),
    ).tests.length,
  ).toBeGreaterThan(0);
});

it("uses small receipts to reuse unchanged context and refreshes modified source", () => {
  const { root, graph } = fixture();
  for (const format of ["json", "markdown"] as const) {
    const request = {
      task: "Change SqlLedger.save balance validation",
      maxTokens: 2000,
      options: { format },
    };
    const first = graph.context(request);
    const next = graph.context({
      ...request,
      options: {
        ...request.options,
        previousContextId: first.package.contextId,
      },
    });
    expect(next.package.reuseFrom).toBe(first.package.contextId);
    expect(next.package.symbols).toEqual([]);
    expect(next.package.reusedSymbols?.sort()).toEqual(
      first.package.symbols.map((symbol) => symbol.id).sort(),
    );
    expect(next.metrics.contextTokens).toBeLessThan(
      first.metrics.contextTokens,
    );
    expect(bpeCounter.count(next.text)).toBeLessThanOrEqual(2000);
    const fallback = graph.context({
      ...request,
      options: { ...request.options, previousContextId: "0".repeat(24) },
    });
    expect(fallback.package.reuseFrom).toBeUndefined();
    expect(fallback.package.symbols.length).toBeGreaterThan(0);
  }
  const request = {
    task: "Change SqlLedger.save balance validation",
    maxTokens: 2000,
    options: { format: "markdown" as const },
  };
  const first = graph.context(request);
  writeFileSync(
    join(root, "ledger.ts"),
    readFileSync(join(root, "ledger.ts"), "utf8").replace(
      "rounded * 2",
      "rounded * 3",
    ),
  );
  expect(() =>
    graph.context({
      ...request,
      options: {
        ...request.options,
        previousContextId: first.package.contextId,
      },
    }),
  ).toThrow("Stale");
  graph.index();
  const changed = graph.context({
    ...request,
    options: { ...request.options, previousContextId: first.package.contextId },
  });
  expect(
    changed.package.symbols.find((symbol) => symbol.symbol === "SqlLedger.save")
      ?.text,
  ).toContain("rounded * 3");
  expect(changed.package.contextId).not.toBe(first.package.contextId);
});

it("falls back to full evidence after a worker restart and isolates evidence modes", () => {
  const { root, graph } = fixture();
  const request = { task: "Explain SqlLedger.save", maxTokens: 2000 };
  const initial = graph.context(request);
  const fresh = PGraph.open(root, { readOnly: true });
  try {
    const restarted = fresh.context({
      ...request,
      options: { previousContextId: initial.package.contextId },
    });
    expect(restarted.package.reuseFrom).toBeUndefined();
    expect(restarted.package.symbols.length).toBeGreaterThan(0);
  } finally {
    fresh.close();
  }
  const assisted = graph.context({
    ...request,
    options: {
      evidenceMode: "assisted",
      previousContextId: initial.package.contextId,
    },
  });
  expect(assisted.package.reuseFrom).toBeUndefined();
  expect(() =>
    graph.context({ ...request, options: { previousContextId: "invalid" } }),
  ).toThrow("previousContextId");
});

it("invalidates extraction when a dependency lockfile changes", () => {
  const { root, graph } = fixture();
  writeFileSync(
    join(root, "package-lock.json"),
    '{"lockfileVersion":3,"packages":{}}',
  );
  graph.index();
  expect(graph.index().parsed).toBe(0);
  writeFileSync(
    join(root, "package-lock.json"),
    '{"lockfileVersion":3,"packages":{"":{"name":"power-fixture"}}}',
  );
  expect(graph.index().parsed).toBeGreaterThan(0);
});
