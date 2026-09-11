import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PGraph, bpeCounter } from "@praesidia/pgraph-core";
import {
  ContextEngine,
  type ContextSelectionTrace,
} from "@praesidia/pgraph-context";
import { rank } from "@praesidia/pgraph-ranking";

const fixtures: { root: string; graph: PGraph }[] = [];
function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "pgraph-selection-test-"));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  const graph = PGraph.open(root);
  fixtures.push({ root, graph });
  graph.index();
  return graph;
}
afterEach(() => {
  for (const { root, graph } of fixtures.splice(0)) {
    graph.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("finds a natural-language implementation despite local-variable search noise", () => {
  const graph = fixture({
    "inventory.ts": `export function releaseStock(quantity: number) { return quantity + 1; }
export class ReservationCleaner {
  /** Reclaim expired reservations and release their stock. */
  reclaim(expiresAt: number, now: number) {
    if (expiresAt >= now) return 0;
    return releaseStock(2);
  }
}`,
    "noise.ts": `export function fixtureData() {
${Array.from({ length: 150 }, (_, i) => `const reclaimExpiredReservation${i} = ${i};`).join("\n")}
return true;
}`,
  });
  const raw = graph.store.search("reclaim expired reservations", { limit: 20 });
  expect(raw.some((node) => node.kind === "constant")).toBe(true);
  const declarations = graph.store.search("reclaim expired reservations", {
    limit: 20,
    kinds: ["method", "function"],
  });
  expect(declarations.map((node) => node.qualifiedName)).toContain(
    "ReservationCleaner.reclaim",
  );
  const result = graph.context({
    task: "How does reclaiming expired reservations release stock?",
    maxTokens: 1400,
  });
  expect(result.package.symbols.map((symbol) => symbol.symbol)).toEqual(
    expect.arrayContaining(["ReservationCleaner.reclaim", "releaseStock"]),
  );
  expect(bpeCounter.count(result.text)).toBeLessThanOrEqual(1400);
});

it("keeps unrelated consumers of a shared helper out of a focused change", () => {
  const graph = fixture({
    "app.ts": `function normalize(value: number) { return Math.max(0, value); }
export class PaymentAuthorizer { authorize(amount: number) { return normalize(amount); } }
export class InvoiceMailer { send(batch: number) { return normalize(batch); } }
export class ShipmentPlanner { schedule(count: number) { return normalize(count); } }
`,
  });
  const result = graph.context({
    task: "Change PaymentAuthorizer.authorize",
    maxTokens: 1500,
  });
  const names = result.package.symbols.map((symbol) => symbol.symbol);
  expect(names).toContain("PaymentAuthorizer.authorize");
  expect(names).toContain("normalize");
  expect(names).not.toContain("InvoiceMailer.send");
  expect(names).not.toContain("ShipmentPlanner.schedule");
});

it("follows a call through a declared interface implementation without claiming runtime dispatch", () => {
  const graph = fixture({
    "app.ts": `export interface Storage { put(value: number): number; }
export class DiskStorage implements Storage { put(value: number) { return value * 2; } }
export function checkout(storage: Storage) { return storage.put(4); }
`,
  });
  let trace: ContextSelectionTrace | undefined;
  const engine = new ContextEngine(graph.store, graph, undefined, (value) => {
    trace = value;
  });
  engine.context({ task: "Change checkout", maxTokens: 1800 });
  const candidate = trace!.candidates.find(
    (item) => item.id === graph.symbol("DiskStorage.put").id,
  );
  expect(candidate?.rank).toBeDefined();
  expect(candidate?.reasons?.join(" ")).toContain("implementation");
});

it("diagnoses selection without enlarging responses, bypassing freshness, or changing scope", () => {
  const graph = fixture({
    "src/cache.ts":
      "export function evictExpired() { return 'expired cache entry'; }\n",
    "other/cache.ts":
      "export function evictExpired() { return 'expired external cache'; }\n",
  });
  let trace: ContextSelectionTrace | undefined;
  const observed = new ContextEngine(graph.store, graph, undefined, (value) => {
    trace = value;
  });
  const ordinary = new ContextEngine(graph.store, graph);
  const request = {
    task: "Find expired cache entries",
    maxTokens: 1200,
    options: { scope: "src" },
  };
  const normal = ordinary.context(request);
  expect(observed.context(request).text).toBe(normal.text);
  expect(observed.context(request).text).toBe(normal.text);
  expect(ordinary.context(request).metrics.cacheHit).toBe(true);
  expect(
    trace!.candidates
      .filter((item) => item.stage === "selected")
      .map((item) => item.id),
  ).toEqual(normal.package.symbols.map((symbol) => symbol.id));
  expect(
    normal.package.symbols.every((symbol) => symbol.at.startsWith("src/")),
  ).toBe(true);
  writeFileSync(
    join(graph.root, "src/cache.ts"),
    "export function evictExpired() { return false; }\n",
  );
  expect(() => observed.context(request)).toThrow("Stale");
  expect(() => ordinary.context(request)).toThrow("Stale");
});

it("ranks English inflections consistently without matching arbitrary identifier substrings", () => {
  const graph = fixture({
    "cache.ts":
      "export function save() { return true; }\nexport function budget() { return 1; }\n",
  });
  const save = graph.symbol("save");
  const scores = ["save", "saves", "saving"].map((term) =>
    rank(save, { terms: [term], strategy: "locate" }),
  );
  expect(new Set(scores).size).toBe(1);
  expect(
    rank(graph.symbol("budget"), { terms: ["get"], strategy: "locate" }),
  ).toBeLessThan(rank(save, { terms: ["saving"], strategy: "locate" }));
  expect(graph.store.resolve("saving")).toHaveLength(0);
});
