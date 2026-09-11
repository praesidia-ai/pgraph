import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { PGraph } from "@praesidia/pgraph-core";
import { dispatchTool } from "@praesidia/pgraph-tools";

const opened: PGraph[] = [];
afterEach(() => {
  for (const graph of opened.splice(0)) {
    graph.close();
    rmSync(graph.root, { recursive: true, force: true });
  }
});
const put = (root: string, path: string, data: string | object) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(
    join(root, path),
    typeof data === "string" ? data : JSON.stringify(data),
  );
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pgraph-project-reference-"));
  put(root, "package.json", { private: true, workspaces: ["packages/*"] });
  put(root, "packages/domain/package.json", {
    name: "@fixture/domain",
    type: "module",
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./money": { types: "./dist/money.d.ts", import: "./dist/money.js" },
    },
  });
  put(root, "packages/domain/tsconfig.json", {
    compilerOptions: {
      composite: true,
      rootDir: "src",
      outDir: "dist",
      module: "NodeNext",
    },
  });
  put(
    root,
    "packages/domain/src/index.ts",
    "export { chargeCard } from './money.js'; export class Invoice { pay(amount:number) { return amount * 100; } }\n",
  );
  put(
    root,
    "packages/domain/src/money.ts",
    "export function chargeCard(amount:number) { return amount*100; }\nexport function privateRefund() { return 0; }\n",
  );
  put(root, "packages/app/package.json", {
    name: "@fixture/app",
    type: "module",
  });
  put(root, "packages/app/tsconfig.json", {
    compilerOptions: {
      composite: true,
      rootDir: "src",
      outDir: "dist",
      module: "NodeNext",
    },
    references: [{ path: "../domain" }],
  });
  put(
    root,
    "packages/app/src/index.ts",
    "import {chargeCard, Invoice} from '@fixture/domain'; import { chargeCard as direct } from '@fixture/domain/money'; export function checkout() { return new Invoice().pay(chargeCard(42)) + direct(1); }\n",
  );
  put(
    root,
    "packages/app/src/payment.test.ts",
    "import {checkout} from './index.js'; declare function test(name:string,run:()=>void):void; test('payment works',()=>{ checkout(); });\n",
  );
  const graph = PGraph.open(root);
  opened.push(graph);
  return graph;
}
it("connects package exports, barrels, methods, consumers and candidate tests to source before building", () => {
  const graph = fixture();
  graph.index();
  expect(graph.callees("checkout").map((n) => n.qualifiedName)).toEqual(
    expect.arrayContaining(["chargeCard", "Invoice.pay"]),
  );
  expect(graph.callers("chargeCard").map((n) => n.qualifiedName)).toContain(
    "checkout",
  );
  expect(
    graph.testPaths("chargeCard").tests.map((t) => t.node.qualifiedName),
  ).toContain("payment works");
  expect(
    graph.store
      .neighbors(graph.symbol("checkout").id, "out", ["CALLS"])
      .some((n) => n.edge.metadata.resolution === "referenced project source"),
  ).toBe(true);
  const context = graph.context({
    task: "Change chargeCard payment",
    maxTokens: 2000,
  });
  expect(context.package.symbols.some((n) => n.symbol === "chargeCard")).toBe(
    true,
  );
  expect(graph.slice("chargeCard").source).toContain("amount*100");
});
it("uses current indexed source with an installed local workspace link and stale declarations", () => {
  const graph = fixture(),
    root = graph.root;
  put(
    root,
    "packages/domain/dist/index.d.ts",
    "export declare function obsoleteCharge(): void;\n",
  );
  mkdirSync(join(root, "node_modules/@fixture"), { recursive: true });
  symlinkSync(
    join(root, "packages/domain"),
    join(root, "node_modules/@fixture/domain"),
    "dir",
  );
  graph.index();
  expect(graph.callees("checkout").map((n) => n.name)).toContain("chargeCard");
  expect(
    graph.store
      .files()
      .some(
        (f) => f.path.includes("dist/") || f.path.includes("node_modules/"),
      ),
  ).toBe(false);
  put(
    root,
    "packages/domain/src/money.ts",
    "export function chargeCard(amount:number) { return amount; }\n",
  );
  const update = graph.index();
  expect(update.parsed).toBeGreaterThan(1);
  expect(graph.callers("chargeCard").map((n) => n.name)).toContain("checkout");
  expect(graph.slice("chargeCard").source).toContain("return amount;");
});
it("respects package exports and installed-package precedence, and removes relationships after reference changes", () => {
  const graph = fixture(),
    root = graph.root;
  put(
    root,
    "packages/app/src/blocked.ts",
    "import {privateRefund} from '@fixture/domain/private'; export function leak(){return privateRefund();}\n",
  );
  graph.index();
  expect(graph.callees("leak")).toEqual([]);
  put(root, "node_modules/@fixture/domain/package.json", {
    name: "@fixture/domain",
    types: "index.d.ts",
  });
  put(
    root,
    "node_modules/@fixture/domain/index.d.ts",
    "export declare function chargeCard(amount:number):number;\n",
  );
  graph.index({ rebuild: true });
  expect(graph.callees("checkout").map((n) => n.name)).not.toContain(
    "chargeCard",
  );
  rmSync(join(root, "node_modules"), { recursive: true, force: true });
  put(root, "packages/app/tsconfig.json", {
    compilerOptions: { module: "NodeNext" },
    references: [],
  });
  graph.index();
  expect(graph.callees("checkout")).toEqual([]);
});
it("leaves external and ambiguous project references unresolved", () => {
  const graph = fixture(),
    root = graph.root;
  put(root, "packages/copy/package.json", {
    name: "@fixture/domain",
    type: "module",
    types: "dist/index.d.ts",
  });
  put(root, "packages/copy/tsconfig.json", {
    compilerOptions: { composite: true, rootDir: "src", outDir: "dist" },
  });
  put(
    root,
    "packages/copy/src/index.ts",
    "export function chargeCard(){return 'wrong';}",
  );
  put(root, "packages/app/tsconfig.json", {
    compilerOptions: { module: "NodeNext" },
    references: [
      { path: "../domain" },
      { path: "../copy" },
      { path: "../../../outside" },
    ],
  });
  const index = graph.index();
  expect(graph.callees("checkout")).toEqual([]);
  expect(index.diagnostics.join(" ")).toContain("Ambiguous referenced package");
  expect(index.diagnostics.join(" ")).toContain(
    "outside the indexed repository",
  );
});
it("requires an extraction upgrade before tools trust an older graph", () => {
  const graph = fixture();
  graph.index();
  graph.store.setMeta("retrievalVersion", 3);
  expect(graph.health()).toMatchObject({
    current: false,
    extractionChanged: true,
    next: "Reindex Changed Files",
  });
  expect(
    JSON.parse(dispatchTool(graph, "workflow", { action: "health" }))
      .extractionChanged,
  ).toBe(true);
  expect(() =>
    dispatchTool(graph, "callers", { symbol: "chargeCard" }),
  ).toThrow("extraction needs an update");
  expect(graph.index().parsed).toBe(graph.store.files().length);
  expect(graph.health().current).toBe(true);
  expect(dispatchTool(graph, "callers", { symbol: "chargeCard" })).toContain(
    "checkout",
  );
});
it("resolves a referenced package's internal aliases using its own compiler configuration", () => {
  const graph = fixture(),
    root = graph.root;
  put(root, "packages/domain/tsconfig.json", {
    compilerOptions: {
      composite: true,
      rootDir: "src",
      outDir: "dist",
      module: "NodeNext",
      baseUrl: ".",
      // NodeNext ESM aliases need an explicit file extension, as tsc itself requires.
      paths: { "@domain/*": ["src/*.ts"] },
    },
  });
  put(
    root,
    "packages/domain/src/math.ts",
    "export function roundMoney(amount:number){ return Math.round(amount); }\n",
  );
  put(
    root,
    "packages/domain/src/money.ts",
    "import {roundMoney} from '@domain/math'; export function chargeCard(amount:number){ return roundMoney(amount); }\n",
  );
  graph.index();
  expect(graph.callees("checkout").map((n) => n.name)).toContain("chargeCard");
  expect(graph.callees("chargeCard").map((n) => n.name)).toContain(
    "roundMoney",
  );
  expect(graph.testPaths("roundMoney").tests.map((t) => t.node.name)).toContain(
    "payment works",
  );
  put(root, "packages/domain/tsconfig.json", {
    compilerOptions: {
      composite: true,
      rootDir: "src",
      outDir: "dist",
      module: "NodeNext",
      baseUrl: ".",
      paths: { "@domain/*": ["src/*"] },
    },
  });
  graph.index();
  expect(graph.callees("chargeCard")).toEqual([]);
});
