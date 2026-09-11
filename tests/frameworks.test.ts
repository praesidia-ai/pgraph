import { afterEach, it, expect } from "vitest";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGraph, type IndexProgress } from "@praesidia/pgraph-core";
const roots: string[] = [];
const graphs: PGraph[] = [];
function fixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), "pgraph-framework-"));
  roots.push(root);
  cpSync(resolve("examples", name), root, {
    recursive: true,
    filter: (p) => !p.includes(".pgraph"),
  });
  const graph = PGraph.open(root);
  graphs.push(graph);
  return { root, graph };
}
afterEach(() => {
  for (const g of graphs.splice(0)) g.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it("recognizes Next App Router entry points, JSX components and hooks", () => {
  const { graph } = fixture("sample-nextjs-app");
  graph.index();
  expect(graph.symbol("POST").metadata.entryPoint).toBe(true);
  expect(graph.symbol("Home").metadata.framework).toBe("nextjs-app");
  expect(graph.symbol("useAccount").metadata.tags).toContain("hook");
  expect(graph.callees("POST").map((n) => n.name)).toContain("authenticate");
});
it("models Nest controllers, providers and route-to-handler relationships without loading Nest", () => {
  const { graph } = fixture("sample-nestjs-app");
  graph.index();
  expect(graph.symbol("AuthController").kind).toBe("controller");
  expect(graph.symbol("AuthService").kind).toBe("service");
  expect(
    graph.callers("AuthService.login").map((n) => n.qualifiedName),
  ).toContain("AuthController.login");
  expect(graph.impact("AuthService.login").routes.length).toBeGreaterThan(0);
});
it("resolves multiple tsconfigs, inherited path aliases and workspace dependencies", () => {
  const { root, graph } = fixture("sample-monorepo");
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({ extends: "./tsconfig.base.json" }),
  );
  writeFileSync(
    join(root, "health.ts"),
    'import { createPayment } from "@example/domain"; export function workspaceHealth() { return createPayment(1); }',
  );
  const progress: IndexProgress[] = [];
  graph.index({ onProgress: (update) => progress.push(update) });
  expect(progress[0]?.phase).toBe("discover");
  expect(progress.at(-1)?.phase).toBe("complete");
  expect(
    progress.some((update) => update.message.includes(": tsconfig.json (")),
  ).toBe(true);
  expect(graph.callees("workspaceHealth").map((node) => node.name)).toContain(
    "createPayment",
  );
  expect(
    progress.some((update) =>
      update.message.includes("packages/api/tsconfig.json"),
    ),
  ).toBe(true);
  expect(
    progress.some((update) =>
      update.message.includes("packages/domain/tsconfig.json"),
    ),
  ).toBe(true);
  expect(graph.callees("checkout").map((n) => n.name)).toContain(
    "createPayment",
  );
  expect(graph.implementations("PaymentProvider").map((n) => n.name)).toContain(
    "StripeProvider",
  );
  expect(graph.dependencies("@example/api").map((n) => n.name)).toContain(
    "@example/domain",
  );
  writeFileSync(
    join(root, "tsconfig.base.json"),
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: { "@example/domain": ["missing.ts"] },
      },
    }),
  );
  graph.index();
  expect(graph.callees("checkout")).toEqual([]);
});
it("models Express callbacks, database usage, events and configuration", () => {
  const { root, graph } = fixture("sample-typescript-app");
  writeFileSync(
    join(root, "src/routes.ts"),
    `declare const app: any, prisma: any, bus: any;\nexport function handler() { prisma.user.update({where:{id:'1'}}); bus.emit('account.locked'); return process.env.LOGIN_LIMIT; }\napp.post('/login', handler);\napp.get('/status', () => handler());\n`,
  );
  graph.index();
  expect(
    graph.callers("handler").filter((n) => n.kind === "route"),
  ).toHaveLength(2);
  expect(graph.dependencies("handler").map((n) => n.kind)).toEqual(
    expect.arrayContaining(["event", "configuration", "database_model"]),
  );
});
it("stores semantic provenance, rejects malformed/stale results and invalidates dependencies", () => {
  const { root, graph } = fixture("sample-typescript-app");
  graph.index();
  const input = graph.semanticInput("AuthService.login");
  const raw = JSON.stringify({
    summary: "Authenticates credentials and issues sessions.",
    concepts: ["authentication"],
    constraints: [],
    confidence: 0.8,
  });
  const fact = graph.memory.accept(raw, input, "test-provider");
  expect(fact.evidence).toBe("semantic");
  expect(
    graph
      .feature("authentication", "assisted")
      .symbols.map((n) => n.qualifiedName),
  ).toContain("AuthService.login");
  expect(() =>
    graph.memory.accept('{"summary":"bad"}', input, "test-provider"),
  ).toThrow();
  writeFileSync(
    join(root, "src/token.service.ts"),
    "export class TokenService { issue(id: string) { return id; } }",
  );
  graph.index();
  expect(graph.memory.facts()).toHaveLength(0);
  expect(() => graph.memory.accept(raw, input, "test-provider")).toThrow(
    "Stale",
  );
});
