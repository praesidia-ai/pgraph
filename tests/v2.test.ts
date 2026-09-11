import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PGraph, bpeCounter } from "@praesidia/pgraph-core";
import { dispatchTool } from "@praesidia/pgraph-tools";
import { readChangedFiles } from "@praesidia/pgraph-git";

const fixtures: { root: string; graph: PGraph }[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pgraph-v2-"));
  writeFileSync(
    join(root, "package.json"),
    '{"name":"ledger-fixture","type":"module"}',
  );
  writeFileSync(join(root, ".gitignore"), ".pgraph/\n");
  writeFileSync(
    join(root, "ledger.ts"),
    `/** Reconcile overdue membership renewals before collecting a payment. */
export function settle(credits: number): number {
  if (credits < 0) throw new Error("Balance exceeds available credits");
  return credits * 2;
}
export function untouched() { return true; }
`,
  );
  writeFileSync(
    join(root, "checkout.ts"),
    `import { settle } from './ledger.js';
export function charge() { return settle(5); }
`,
  );
  writeFileSync(
    join(root, "ledger.spec.ts"),
    `import { settle } from './ledger.js';
declare function test(name: string, callback: () => void): void;
test('membership renewal accepts a positive balance', () => { settle(5); });
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
const git = (root: string, args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
function commit(root: string) {
  git(root, ["init"]);
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "fixture",
  ]);
}

it("retrieves domain documentation, inflected words and exception text with no model facts", () => {
  const { graph } = fixture();
  expect(
    graph.searchSymbols("overdue renewal").map((node) => node.name),
  ).toContain("settle");
  expect(
    graph.searchSymbols("collecting payments").map((node) => node.name),
  ).toContain("settle");
  expect(
    graph.searchSymbols("Balance exceeds").map((node) => node.name),
  ).toContain("settle");
  const result = graph.context({
    task: "Fix overdue membership renewals",
    maxTokens: 2000,
    options: { format: "markdown" },
  });
  expect(result.package.evidenceMode).toBe("local");
  const target = result.package.symbols.find(
    (node) => node.symbol === "settle",
  );
  expect(target?.representation).toBe("source");
  expect(target?.text).toContain("credits < 0");
  expect(result.package.tests).toContain(
    "membership renewal accepts a positive balance",
  );
  expect(bpeCounter.count(result.text)).toBeLessThanOrEqual(2000);
});

it("keeps cached model-derived concepts and constraints out of local results and cache hits", () => {
  const { graph } = fixture();
  const input = graph.semanticInput("settle");
  graph.memory.accept(
    JSON.stringify({
      summary: "Fabricated suggestion",
      concepts: ["xylophone"],
      constraints: ["INFERRED_ONLY_MARKER"],
      confidence: 0.8,
    }),
    input,
    "fixture-no-model-call",
  );
  expect(graph.feature("xylophone").symbols).toEqual([]);
  expect(
    graph.feature("xylophone", "assisted").symbols.map((node) => node.name),
  ).toContain("settle");
  const request = { task: "Explain settle", maxTokens: 2000 };
  const local = graph.context(request);
  const assisted = graph.context({
    ...request,
    options: { evidenceMode: "assisted" },
  });
  expect(assisted.text).toContain("INFERRED_ONLY_MARKER");
  expect(local.text).not.toContain("INFERRED_ONLY_MARKER");
  expect(graph.context(request).metrics.cacheHit).toBe(true);
  expect(graph.context(request).text).not.toContain("INFERRED_ONLY_MARKER");
  expect(
    dispatchTool(graph, "feature", {
      concept: "xylophone",
      evidenceMode: "local",
    }),
  ).not.toContain("settle");
});

it("anchors ambiguous names to the cursor and rejects stale, external or contradictory focus", () => {
  const { root, graph } = fixture();
  writeFileSync(
    join(root, "other.ts"),
    "export function settle() { return 'unrelated'; }",
  );
  graph.index();
  const focus = { file: "ledger.ts", line: 3 };
  const result = graph.context({
    task: "Explain this",
    maxTokens: 2000,
    options: { focus },
  });
  const selected = result.package.symbols.find(
    (node) => node.id === graph.focus(focus).id,
  );
  expect(selected?.reasons).toContain("editor focus");
  expect(selected?.at).toContain("ledger.ts");
  for (const format of ["json", "markdown"] as const) {
    const small = graph.context({
      task: "Explain overdue membership renewals",
      maxTokens: 500,
      options: { focus, format },
    });
    expect(small.package.symbols.some((node) => node.id === selected!.id)).toBe(
      true,
    );
    expect(bpeCounter.count(small.text)).toBeLessThanOrEqual(500);
  }
  expect(() =>
    graph.context({
      task: "Explain",
      maxTokens: 1000,
      options: { focus, scope: "src" },
    }),
  ).toThrow("outside");
  expect(() => graph.focus({ file: "../outside.ts", line: 1 })).toThrow(
    "not indexed",
  );
  expect(() => graph.focus({ file: "ledger.ts", line: 1000 })).toThrow(
    "No indexed symbol",
  );
  writeFileSync(
    join(root, "ledger.ts"),
    readFileSync(join(root, "ledger.ts"), "utf8") + "\n",
  );
  expect(() =>
    graph.context({
      task: "Explain this",
      maxTokens: 2000,
      options: { focus },
    }),
  ).toThrow("Stale");
});

it("reviews real staged, unstaged, deleted and untracked changes and reports uncertain areas", () => {
  const { root, graph } = fixture();
  commit(root);
  expect(graph.reviewChanges().totalFiles).toBe(0);
  writeFileSync(
    join(root, "ledger.ts"),
    readFileSync(join(root, "ledger.ts"), "utf8").replace(
      "credits * 2",
      "credits * 3",
    ),
  );
  git(root, ["add", "ledger.ts"]);
  unlinkSync(join(root, "checkout.ts"));
  writeFileSync(join(root, "deployment.yaml"), "runtime: unknown\n");
  writeFileSync(
    join(root, "fresh file.ts"),
    "export function fresh() { return 1; }",
  );
  expect(
    graph.reviewChanges().files.find((file) => file.file === "ledger.ts")
      ?.limitation,
  ).toContain("stale");
  graph.index();
  const review = graph.reviewChanges();
  expect(
    review.files.find((file) => file.file === "checkout.ts")?.limitation,
  ).toContain("baseline");
  expect(
    review.files.find((file) => file.file === "deployment.yaml")?.limitation,
  ).toContain("Not indexed");
  expect(
    review.files.find((file) => file.file === "fresh file.ts")?.status,
  ).toBe("?");
  expect(review.tests.map(({ node }) => node.name)).toContain(
    "membership renewal accepts a positive balance",
  );
  expect(review.checks).toContain(
    "Run wider checks for files or dependencies marked unknown/omitted",
  );
  expect(graph.reviewChanges(1).truncated).toBe(true);
  const text = dispatchTool(graph, "review_changes", { maxTokens: 500 });
  expect(bpeCounter.count(text)).toBeLessThanOrEqual(500);
  expect(JSON.parse(text)).toBeDefined();
});

it("includes consumers of changed exported constants", () => {
  const { root, graph } = fixture();
  writeFileSync(join(root, "limits.ts"), "export const limit = 10;");
  writeFileSync(
    join(root, "allowed.ts"),
    "import { limit } from './limits.js'; export function allowed(n: number) { return n < limit; }",
  );
  graph.index();
  commit(root);
  writeFileSync(join(root, "limits.ts"), "export const limit = 20;");
  graph.index();
  const review = graph.reviewChanges();
  expect(review.affected.map(({ node }) => node.name)).toContain("allowed");
  expect(
    review.files.find((file) => file.file === "limits.ts")?.limitation,
  ).toBeUndefined();
});

it("keeps change discovery within a nested repository root", () => {
  const { root } = fixture();
  mkdirSync(join(root, "service"));
  writeFileSync(
    join(root, "service", "handler.ts"),
    "export const handler = 1;",
  );
  commit(root);
  writeFileSync(join(root, "ledger.ts"), "changed outside nested root");
  writeFileSync(
    join(root, "service", "handler.ts"),
    "export const handler = 2;",
  );
  writeFileSync(join(root, "service", "new.ts"), "export const fresh = 1;");
  expect(
    readChangedFiles(join(root, "service")).files.map((file) => file.file),
  ).toEqual(["handler.ts", "new.ts"]);
});
