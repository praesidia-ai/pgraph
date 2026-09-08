import { configSchema } from "@praesidia/pgraph-shared";
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  PGraph,
  topologySnapshot,
  composeWorkspace,
  relationships,
} from "@praesidia/pgraph-core";
const opened: { root: string; graph: PGraph }[] = [];
function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "pgraph-services-"));
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), source);
  }
  const graph = PGraph.open(root);
  opened.push({ root, graph });
  graph.index();
  return { root, graph };
}
const service = (name: string, extra = {}) =>
  JSON.stringify({ topology: { services: [{ name, path: ".", ...extra }] } });
afterEach(() => {
  for (const { root, graph } of opened.splice(0)) {
    graph.close();
    rmSync(root, { recursive: true, force: true });
  }
});
it("federates HTTP, Azure queues and events using explicit resource identities and retains both source hashes", () => {
  const a = fixture({
    ".pgraph.json": service("orders", {
      urls: { BILLING_URL: "https://billing.internal" },
      resources: { BUS: "company/orders", GRID: "company/events" },
    }),
    "index.ts": `import { ServiceBusClient } from '@azure/service-bus';
import { output } from '@azure/functions';
import { EventGridPublisherClient } from '@azure/eventgrid';
const bus = new ServiceBusClient(process.env.BUS);
const sender = bus.createSender('orders');
const grid = new EventGridPublisherClient(process.env.GRID, 'EventGrid', {});
export async function submit() { await fetch(\`\${process.env.BILLING_URL}/api/payments/42\`, {method:'POST'}); await grid.send([]); }
const out = output.storageQueue({queueName:'jobs',connection:'BUS'});`,
    "local.settings.json": JSON.stringify({ secret: "SHOULD_NOT_BE_INDEXED" }),
  });
  const b = fixture({
    ".pgraph.json": service("billing", {
      origins: ["https://billing.internal"],
      resources: { CONNECTION: "company/orders", EVENTS: "company/events" },
    }),
    "host.json": '{"version":"2.0"}',
    "index.ts": `import { app } from '@azure/functions';
app.http('payments', {methods:['POST'], route:'payments/{id}', handler: async () => ({status:200})});
app.serviceBusQueue('orders', {queueName:'orders',connection:'CONNECTION',handler:async()=>{}});
app.storageQueue('jobs', {queueName:'jobs',connection:'CONNECTION',handler:async()=>{}});`,
    "events/function.json": JSON.stringify({
      bindings: [
        { type: "eventGridTrigger", name: "event", connection: "EVENTS" },
      ],
    }),
  });
  const snapshots = [a, b].map(({ graph, root }) =>
    topologySnapshot(graph.store, root),
  );
  const map = composeWorkspace(snapshots);
  expect(map.edges.map((e) => e.type)).toEqual(
    expect.arrayContaining([
      "http",
      "service-bus",
      "storage-queue",
      "event-grid",
    ]),
  );
  expect(map.edges).toHaveLength(4);
  expect(
    map.edges.every(
      (e) =>
        e.sources.length === 2 && e.sources.every((s) => s.hash?.length === 64),
    ),
  ).toBe(true);
  expect(a.graph.store.file("local.settings.json")).toBeUndefined();
  const http = map.edges.find((e) => e.type === "http")!;
  expect(http.from).not.toBe(http.to);
  expect(http.evidence).toBe("inferred from declarations");
  expect(map.nodes.filter((n) => n.kind === "service")).toHaveLength(2);
  writeFileSync(join(b.root, "index.ts"), "export const removed = true;");
  b.graph.index();
  const changed = composeWorkspace([
    snapshots[0]!,
    topologySnapshot(b.graph.store, b.root),
  ]);
  expect(changed.edges.find((e) => e.type === "http")?.evidence).toBe(
    "unresolved",
  );
});
it("does not link matching routes without a host mapping or matching queue names across namespaces", () => {
  const a = fixture({
    ".pgraph.json": service("same", { resources: { BUS: "namespace-a" } }),
    "a.ts": `import { ServiceBusClient } from '@azure/service-bus'; const bus=new ServiceBusClient(process.env.BUS); bus.createSender('same'); fetch('https://unknown/api/x');`,
  });
  const b = fixture({
    ".pgraph.json": service("same", { resources: { BUS: "namespace-b" } }),
    "b.ts": `import { app } from '@azure/functions'; app.http('x',{handler:()=>{}}); app.serviceBusQueue('q',{queueName:'same',connection:'BUS',handler:()=>{}});`,
  });
  const map = composeWorkspace(
    [a, b].map(({ graph, root }) => topologySnapshot(graph.store, root)),
  );
  expect(
    map.nodes.filter((n) => n.kind === "service").map((n) => n.id)[0],
  ).not.toBe(map.nodes.filter((n) => n.kind === "service").map((n) => n.id)[1]);
  expect(map.edges).toHaveLength(2);
  expect(map.edges.every((e) => e.evidence === "unresolved")).toBe(true);
});
it("tracks root and nested Azure apps, v3 bindings, custom route prefixes and configuration invalidation", () => {
  const { root, graph } = fixture({
    "package.json": '{"name":"workspace"}',
    "host.json": '{"extensions":{"http":{"routePrefix":""}}}',
    "http/function.json":
      '{"bindings":[{"type":"httpTrigger","methods":["get"],"route":"status"}],"scriptFile":"../../outside.js"}',
    "nested/host.json": '{"extensions":{"http":{"routePrefix":"custom"}}}',
    "nested/function.ts":
      "import { app } from '@azure/functions'; app.http('hello',{methods:['GET'],handler:()=>{}});",
  });
  const first = topologySnapshot(graph.store, root);
  expect(first.services.map((s) => s.path)).toEqual([".", "nested"]);
  expect(first.endpoints.map((e) => e.address)).toEqual(
    expect.arrayContaining(["/status", "/custom/hello"]),
  );
  expect(graph.index().parsed).toBe(0);
  writeFileSync(
    join(root, "nested/host.json"),
    '{"extensions":{"http":{"routePrefix":"v2"}}}',
  );
  graph.index();
  const second = topologySnapshot(graph.store, root);
  expect(second.revision).toBeGreaterThan(first.revision);
  expect(second.endpoints.map((e) => e.address)).toContain("/v2/hello");
});
it("avoids shadowed APIs and strips URL credentials/query values from persisted evidence", () => {
  const { graph, root } = fixture({
    "index.ts": `import { app } from '@azure/functions';
function fake(app: any, fetch: any) { app.http('fake',{}); fetch('https://fake'); }
fetch('https://user:password@private/api');
fetch('https://real/path?key=VERY_SECRET#secret');
fetch(process.env.UNKNOWN);`,
  });
  const snapshot = topologySnapshot(graph.store, root);
  expect(snapshot.endpoints).toHaveLength(3);
  expect(JSON.stringify(snapshot)).not.toContain("VERY_SECRET");
  expect(JSON.stringify(snapshot)).not.toContain("password");
  expect(snapshot.endpoints.some((e) => e.setting === "UNKNOWN")).toBe(true);
  expect(snapshot.endpoints.some((e) => e.direction === "provide")).toBe(false);
});
it("bounds symbol traversal and reports omitted neighbors without dangling edges", () => {
  const { graph, root } = fixture({
    "index.ts":
      Array.from(
        { length: 35 },
        (_, i) => `export function f${i}() { return 1; }`,
      ).join("\n") +
      "\nexport function main(){" +
      Array.from({ length: 35 }, (_, i) => `f${i}();`).join("") +
      "}",
  });
  const map = relationships(graph.store, root, {
    symbol: graph.symbol("main").id,
    direction: "out",
    types: ["CALLS"],
    depth: 1,
    maxNodes: 8,
    maxEdges: 6,
  });
  expect(map.nodes.length).toBeLessThanOrEqual(8);
  expect(map.edges.length).toBe(6);
  expect(map.truncated).toBe(true);
  const ids = new Set(map.nodes.map((n) => n.id));
  expect(map.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
  expect(() => relationships(graph.store, root, { depth: 50 })).toThrow();
});
it("recognizes CommonJS Azure APIs while avoiding unknown HTTP methods and unmounted Express routers", () => {
  const { graph, root } = fixture({
    "index.js": `const { app } = require('@azure/functions');
const { ServiceBusClient: Bus } = require('@azure/service-bus');
const express = require('express');
const server = express(); const router = express.Router();
server.get('/works', ()=>{}); server.get('setting'); router.get('/unmounted',()=>{});
app.http('works',{methods:['GET'],handler:()=>{}});
const client = new Bus(process.env.CONNECTION); client.createSender('work');
fetch('https://target/works', options);
app.http('dynamic',options);`,
  });
  const points = topologySnapshot(graph.store, root).endpoints;
  expect(points.filter((p) => p.protocol === "service-bus")).toHaveLength(1);
  expect(
    points.filter((p) => p.provenance.source === "express-route"),
  ).toHaveLength(1);
  expect(points.find((p) => p.direction === "request")?.method).toBe("?");
  expect(
    points.find((p) => p.provenance.source === "azure-http" && p.method === "?")
      ?.address,
  ).toBeUndefined();
});

it("prefers a one-character nested app over the root app and rejects duplicate service paths", () => {
  const { graph } = fixture({
    "host.json": "{}",
    "a/host.json": '{"extensions":{"http":{"routePrefix":"nested"}}}',
    "a/index.ts":
      "import {app} from '@azure/functions'; app.http('test',{methods:['GET'],handler:()=>{}}); fetch('https://external');",
  });
  const snapshot = graph.topology();
  expect(
    snapshot.endpoints.find((e) => e.direction === "provide")?.address,
  ).toBe("/nested/test");
  const map = composeWorkspace([snapshot]);
  const from = map.nodes.find((n) => n.id === map.edges[0]?.from);
  expect(from?.scope).toBe("a");
  expect(() => composeWorkspace([snapshot, snapshot])).toThrow(
    "Duplicate repository",
  );
  expect(() =>
    configSchema.parse({
      topology: {
        services: [
          { name: "a", path: "." },
          { name: "b", path: "." },
        ],
      },
    }),
  ).toThrow("Service paths must be unique");
});
it("bounds a 24-root messaging workspace without losing root identity or emitting dangling edges", () => {
  const { graph } = fixture({
    "index.ts":
      "import {app} from '@azure/functions'; app.serviceBusQueue('q',{queueName:'orders',connection:'BUS',handler:()=>{}});",
  });
  const base = graph.topology();
  const snapshots = Array.from({ length: 24 }, (_, root) => ({
    ...base,
    rootId: `root-${root}`,
    services: [
      {
        name: "service",
        path: ".",
        origins: [],
        urls: {},
        resources: { BUS: "shared-namespace" },
      },
    ],
    endpoints: Array.from({ length: 40 }, (_, endpoint) => ({
      ...base.endpoints[0]!,
      id: `endpoint-${endpoint}`,
      direction: root < 12 ? ("publish" as const) : ("subscribe" as const),
    })),
  }));
  const map = composeWorkspace(snapshots);
  expect(Object.keys(map.revisions)).toHaveLength(24);
  expect(map.truncated).toBe(true);
  expect(map.nodes.length).toBeLessThanOrEqual(200);
  expect(map.edges).toHaveLength(800);
  const ids = new Set(map.nodes.map((node) => node.id));
  expect(
    map.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to)),
  ).toBe(true);
});
