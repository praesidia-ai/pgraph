import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  unlinkSync,
  renameSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { PGraph, bpeCounter } from "@praesidia/pgraph-core";
import { dispatchTool } from "@praesidia/pgraph-tools";
import { readGitSnapshot } from "@praesidia/pgraph-git";
import { snapshotInput } from "@praesidia/pgraph-indexer";
import { hash } from "@praesidia/pgraph-shared";
import { dailyReport } from "../apps/vscode-extension/src/daily-report.js";

const fixtures: { root: string; graph: PGraph }[] = [];
const git = (root: string, args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const put = (root: string, path: string, source: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
};
function commit(root: string) {
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
    "snapshot",
  ]);
  return git(root, ["rev-parse", "HEAD"]).trim();
}
function fixture(files: Record<string, string>, nested = "") {
  const root = mkdtempSync(join(tmpdir(), "pgraph-history-test-"));
  put(root, ".gitignore", ".pgraph/\n");
  for (const [path, source] of Object.entries(files)) put(root, path, source);
  git(root, ["init"]);
  const base = commit(root);
  const graph = PGraph.open(join(root, nested));
  fixtures.push({ root, graph });
  graph.index();
  return { root, graph, base };
}
afterEach(() => {
  for (const { root, graph } of fixtures.splice(0)) {
    graph.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("recovers deleted API consumers and candidate tests with historical paths and source hashes", () => {
  const source =
    "export function price(quantity: number): number { return quantity * 2; }\n";
  const { root, graph, base } = fixture({
    "price.ts": source,
    "checkout.ts":
      "import {price} from './price.js'; export function checkout() { return price(2); }\n",
    "checkout.test.ts":
      "import {checkout} from './checkout.js'; declare function test(name: string, fn:()=>void):void; test('checkout works',()=>{checkout();});\n",
  });
  unlinkSync(join(root, "price.ts"));
  graph.index();
  expect(
    graph
      .changedDeclarations()
      .unknown.some((item) => item.file === "price.ts"),
  ).toBe(true);
  const result = graph.historicalChanges();
  expect(result.base).toBe(base);
  const removed = result.changes.find(
    (change) => change.before?.name === "price",
  );
  expect(removed?.change).toBe("removed");
  expect(removed?.beforeHash).toBe(hash(source));
  expect(removed?.after).toBeUndefined();
  const consumer = removed?.consumers.find(
    (entry) => entry.node.name === "checkout",
  );
  expect(consumer?.snapshot).toBe("before");
  expect(consumer?.afterState).toBe("same source");
  expect(consumer?.path.map((step) => step.symbol)).toEqual([
    "price",
    "checkout",
  ]);
  expect(consumer?.path[1]?.edge).toBe("CALLS");
  expect(removed?.consumers.some((entry) => entry.node.kind === "test")).toBe(
    true,
  );
  const text = dispatchTool(graph, "workflow", {
    action: "change_impact",
    maxTokens: 2500,
  });
  expect(bpeCounter.count(text)).toBeLessThanOrEqual(2500);
  expect(JSON.parse(text).changes[0].change).toBe("removed");
  expect(text).toContain("checkout");
  const report = dailyReport("change_impact", {
    ...JSON.parse(text),
    changes: [
      { before: { symbol: "price", signature: "Promise<string | null>" } },
    ],
  });
  expect(report).toContain("Promise&#60;string &#124; null&#62;");
});

it("distinguishes removals, public contract text changes and body edits without flagging untouched siblings", () => {
  const { root, graph } = fixture({
    "api.ts": `export function removed() { return 1; }
export function adjusted(input: number): number { return input; }
export function body(): number { return 1; }
export function untouched(): number { return 1; }
export class Options { flag: boolean = true; }
`,
  });
  put(
    root,
    "api.ts",
    `export function adjusted(input: string): string { return input; }
export function body(): number { return 2; }
export function untouched(): number { return 1; }
export class Options { }
`,
  );
  graph.index();
  const changes = graph.historicalChanges().changes;
  expect(changes.find((item) => item.before?.name === "removed")?.change).toBe(
    "removed",
  );
  expect(changes.find((item) => item.before?.name === "adjusted")?.change).toBe(
    "signature",
  );
  expect(changes.find((item) => item.before?.name === "body")?.change).toBe(
    "modified",
  );
  expect(changes.some((item) => item.before?.name === "untouched")).toBe(false);
  expect(
    changes.find((item) => item.before?.qualifiedName === "Options.flag")
      ?.change,
  ).toBe("removed");
});

it("labels exact move/name-only matches as candidates and leaves duplicate pairings unguessed", () => {
  const { root, graph } = fixture({
    "move.ts": "export function moveMe() { return 1; }\n",
    "rename.ts": "export function oldName() { return 2; }\n",
    "duplicates.ts":
      "export function oldA() { return 9; }\nexport function oldB() { return 9; }\n",
  });
  renameSync(join(root, "move.ts"), join(root, "moved.ts"));
  put(root, "rename.ts", "export function newName() { return 2; }\n");
  put(root, "duplicates.ts", "export function replacement() { return 9; }\n");
  graph.index();
  const changes = graph.historicalChanges().changes;
  expect(changes.find((item) => item.before?.name === "moveMe")?.change).toBe(
    "move-candidate",
  );
  expect(changes.find((item) => item.before?.name === "oldName")?.change).toBe(
    "rename-candidate",
  );
  expect(
    changes
      .filter((item) => ["oldA", "oldB"].includes(item.before?.name ?? ""))
      .map((item) => item.change),
  ).toEqual(["removed", "removed"]);
  expect(
    changes.find((item) => item.after?.name === "replacement")?.change,
  ).toBe("added");
});

it("uses the staged and committed after snapshots even when working source differs", () => {
  const initial = "export function version(): number { return 1; }\n";
  const staged = initial.replace("return 1", "return 2");
  const working = initial.replace("return 1", "return 3");
  const { root, graph, base } = fixture({ "version.ts": initial });
  put(root, "version.ts", staged);
  git(root, ["add", "version.ts"]);
  put(root, "version.ts", working);
  const selection = graph.historicalChanges({ mode: "staged" });
  expect(selection.after.kind).toBe("index");
  expect(selection.after.identity).toMatch(/^[a-f0-9]{64}$/);
  expect(selection.changes[0]?.afterHash).toBe(hash(staged));
  expect(readFileSync(join(root, "version.ts"), "utf8")).toBe(working);
  put(root, "version.ts", staged);
  const head = commit(root);
  put(root, "version.ts", working);
  const branch = graph.historicalChanges({ mode: "branch", base });
  expect(branch.head).toBe(head);
  expect(branch.changes[0]?.afterHash).toBe(hash(staged));
  expect(() => graph.historicalChanges()).toThrow("stale");
});

it("keeps nested Git-root snapshots inside their project and narrows output before the file limit", () => {
  const { root, graph } = fixture(
    {
      "outside.ts": "export function outside() { return 4; }\n",
      "nested path/a.ts": "export function alpha() { return 1; }\n",
      "nested path/z.ts": "export function zulu() { return 2; }\n",
    },
    "nested path",
  );
  unlinkSync(join(root, "nested path/a.ts"));
  unlinkSync(join(root, "nested path/z.ts"));
  graph.index();
  const result = graph.historicalChanges({ file: "z.ts", maxFiles: 1 });
  expect(result.totalFiles).toBe(1);
  expect(result.filesSelected).toBe(1);
  expect(result.changes.map((item) => item.before?.name)).toEqual(["zulu"]);
  expect(JSON.stringify(result)).not.toContain("outside.ts");
  expect(() => graph.historicalChanges({ file: "../outside.ts" })).toThrow(
    "relative",
  );
  const limited = graph.historicalChanges({ maxFiles: 1 });
  expect(limited.filesSelected).toBe(1);
  expect(limited.totalFiles).toBe(2);
  expect(limited.truncated).toBe(true);
});

it("reads original UTF-8 blobs, skips links, enforces bounds and never runs package scripts", () => {
  const source = "\ufeffexport function café() { return 'héllo'; }\n";
  const { root, graph, base } = fixture({
    "café.ts": source,
    "package.json": '{"scripts":{"prepare":"touch SHOULD_NOT_EXIST"}}',
  });
  const snapshot = readGitSnapshot(root, base, snapshotInput, {
    maxFiles: 10,
    maxFileBytes: 2000,
    maxTotalBytes: 4000,
  });
  expect(snapshot.files.find((file) => file.path === "café.ts")?.source).toBe(
    source,
  );
  expect(() =>
    readGitSnapshot(root, base, snapshotInput, {
      maxFiles: 1,
      maxFileBytes: 2000,
      maxTotalBytes: 4000,
    }),
  ).toThrow("limit");
  expect(() =>
    readGitSnapshot(root, base, snapshotInput, {
      maxFiles: 10,
      maxFileBytes: 20,
      maxTotalBytes: 4000,
    }),
  ).toThrow("oversized");
  symlinkSync("café.ts", join(root, "link.ts"));
  const linkBase = commit(root);
  const links = readGitSnapshot(root, linkBase, snapshotInput, {
    maxFiles: 10,
    maxFileBytes: 2000,
    maxTotalBytes: 4000,
  });
  expect(links.files.some((file) => file.path === "link.ts")).toBe(false);
  expect(links.warnings.join(" ")).toContain("link");
  unlinkSync(join(root, "café.ts"));
  graph.index();
  graph.historicalChanges();
  expect(existsSync(join(root, "SHOULD_NOT_EXIST"))).toBe(false);
});

it("includes newly introduced consumers of an existing changed declaration", () => {
  const { root, graph } = fixture({
    "api.ts":
      "export function service(value: number): number { return value; }\n",
  });
  put(
    root,
    "api.ts",
    "export function service(value: number, extra = 0): number { return value + extra; }\n",
  );
  put(
    root,
    "consumer.ts",
    "import {service} from './api.js'; export function newClient() { return service(4, 2); }\n",
  );
  graph.index();
  const changed = graph
    .historicalChanges()
    .changes.find((change) => change.before?.name === "service");
  expect(
    changed?.consumers.some(
      (consumer) =>
        consumer.node.name === "newClient" && consumer.snapshot === "after",
    ),
  ).toBe(true);
});

it("does not mistake parser recovery or an in-flight index change for a verified removal", () => {
  const { root, graph } = fixture({
    "api.ts":
      "export function stable(): number { return 1; }\nexport function second() { return true; }\n",
  });
  put(root, "api.ts", "export function stable( { return 1;\n");
  graph.index();
  const incomplete = graph.historicalChanges();
  expect(incomplete.changes).toHaveLength(0);
  expect(
    incomplete.unknown.some((item) => item.reason.includes("Syntax")),
  ).toBe(true);
  put(root, "api.ts", "export function stable(): number { return 2; }\n");
  graph.index();
  const original = graph.store.nodesInFile.bind(graph.store);
  let changed = false;
  graph.store.nodesInFile = (file) => {
    if (!changed && file === "api.ts") {
      changed = true;
      put(root, "api.ts", "export function stable(): number { return 3; }\n");
      graph.index();
    }
    return original(file);
  };
  expect(() => graph.historicalChanges()).toThrow(
    /changed during|Snapshot changed/,
  );
});

it("keeps a removed declaration and caveats under a small budget and refreshes repeated reviews", () => {
  const { root, graph } = fixture({
    "api.ts":
      "export function service(value: number): number { return value; }\n",
    "clients.ts":
      "import {service} from './api.js';\n" +
      Array.from(
        { length: 12 },
        (_, i) => `export function client${i}() { return service(${i}); }`,
      ).join("\n"),
  });
  unlinkSync(join(root, "api.ts"));
  graph.index();
  const first = graph.historicalChanges();
  first.changes.length = 0;
  expect(
    graph
      .historicalChanges()
      .changes.some((change) => change.before?.name === "service"),
  ).toBe(true);
  for (const maxTokens of [128, 1000, 1500, 4000]) {
    const text = dispatchTool(graph, "workflow", {
      action: "change_impact",
      maxTokens,
    });
    expect(bpeCounter.count(text)).toBeLessThanOrEqual(maxTokens);
    const result = JSON.parse(text);
    if (maxTokens >= 1500) {
      expect(result.changes[0].before.symbol).toBe("service");
      expect(result.warnings.join(" ")).toContain("not proof of breakage");
      expect(result.truncated).toBe(true);
    }
  }
  put(
    root,
    "api.ts",
    "export function service(value: number): number { return value; }\n",
  );
  graph.index();
  expect(graph.historicalChanges().changes).toHaveLength(0);
});

it("prioritizes removals and signatures before page limits and continues without skipping budget-omitted rows", () => {
  const helpers = (value: number) =>
    Array.from(
      { length: 120 },
      (_, i) => `export function helper${i}(): number { return ${value}; }`,
    ).join("\n") + "\n";
  const { root, graph } = fixture({
    "api.ts":
      helpers(1) +
      "export function removedApi(): number { return 1; }\nexport function contract(value: number): number { return value; }\n",
    "consumer.ts":
      "import {removedApi,contract} from './api.js'; export function consumer(){ return contract(removedApi()); }\n",
  });
  put(
    root,
    "api.ts",
    helpers(2) +
      "export function contract(value: string): number { return value.length; }\n",
  );
  graph.index();
  const first = graph.historicalChanges();
  expect(first.page).toMatchObject({
    offset: 0,
    returned: 100,
    total: 122,
    nextOffset: 100,
  });
  expect(first.counts).toEqual({ removed: 1, signature: 1, modified: 120 });
  expect(first.changes.slice(0, 2).map((item) => item.change)).toEqual([
    "removed",
    "signature",
  ]);
  expect(
    first.changes[0]?.consumers.some((item) => item.node.name === "consumer"),
  ).toBe(true);
  const last = graph.historicalChanges({
    offset: 100,
    reviewId: first.page.reviewId,
  });
  expect(last.page).toMatchObject({ offset: 100, returned: 22, total: 122 });
  expect(last.page.nextOffset).toBeUndefined();
  const all = [...first.changes, ...last.changes];
  expect(new Set(all.map((item) => (item.before ?? item.after)!.id)).size).toBe(
    122,
  );
  const input = { action: "change_impact", maxTokens: 2000 };
  const text = dispatchTool(graph, "workflow", input);
  const packed = JSON.parse(text);
  expect(bpeCounter.count(text)).toBeLessThanOrEqual(2000);
  expect(packed.changes[0].before.symbol).toBe("removedApi");
  expect(packed.page.nextOffset).toBe(packed.changes.length);
  const continued = JSON.parse(
    dispatchTool(graph, "workflow", {
      ...input,
      offset: packed.page.nextOffset,
      reviewId: packed.page.reviewId,
    }),
  );
  expect(continued.changes[0].before.id).toBe(
    all[packed.changes.length]!.before!.id,
  );
  expect(continued.page.reviewId).toBe(packed.page.reviewId);
  expect(dailyReport("change_impact", packed)).toContain(
    "Continue Historical Review",
  );
  const cli = (args: string[]) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          join(process.cwd(), "packages/graph-cli/dist/main.js"),
          "workflow",
          "change_impact",
          "--root",
          root,
          "--tokens",
          "2000",
          ...args,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
  const cliFirst = cli([]);
  const cliNext = cli([
    "--offset",
    String(cliFirst.page.nextOffset),
    "--review-id",
    cliFirst.page.reviewId,
  ]);
  expect(cliNext.page.offset).toBe(cliFirst.page.nextOffset);
  expect(cliNext.page.reviewId).toBe(cliFirst.page.reviewId);
  expect(cliNext.changes[0].before.id).toBe(
    all[cliFirst.page.nextOffset]!.before!.id,
  );
});

it("binds continuation to the same historical evidence and rejects stale or unbound offsets", () => {
  const { root, graph } = fixture({
    "api.ts":
      "export function first() { return 1; }\nexport function second() { return 2; }\n",
  });
  put(
    root,
    "api.ts",
    "export function first() { return 3; }\nexport function second() { return 4; }\n",
  );
  graph.index();
  const before = graph.historicalChanges();
  expect(() => graph.historicalChanges({ offset: 1 })).toThrow("reviewId");
  expect(() =>
    graph.historicalChanges({ offset: 3, reviewId: before.page.reviewId }),
  ).toThrow("exceeds");
  expect(() =>
    graph.historicalChanges({
      offset: 1,
      reviewId: before.page.reviewId,
      file: "api.ts",
    }),
  ).toThrow("inputs changed");
  const same = graph.historicalChanges({
    offset: 1,
    reviewId: before.page.reviewId,
  });
  expect(same.changes[0]?.before?.name).toBe("second");
  put(
    root,
    "api.ts",
    "export function first() { return 5; }\nexport function second() { return 4; }\n",
  );
  graph.index();
  expect(() =>
    graph.historicalChanges({ offset: 1, reviewId: before.page.reviewId }),
  ).toThrow("inputs changed");
  expect(graph.historicalChanges().page.reviewId).not.toBe(
    before.page.reviewId,
  );
});
