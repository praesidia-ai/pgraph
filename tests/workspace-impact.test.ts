import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  PGraph,
  bpeCounter,
  workspaceImpact,
  type WorkspaceImpactResult,
} from "@praesidia/pgraph-core";
import { packWorkspaceImpact, dispatchTool } from "@praesidia/pgraph-tools";
import { hash } from "@praesidia/pgraph-shared";

const opened: { root: string; graph: PGraph; project: string; name: string }[] =
  [];
function fixture(
  name: string,
  config: Record<string, unknown>,
  files: Record<string, string>,
) {
  const root = mkdtempSync(join(tmpdir(), "pgraph-workspace-impact-"));
  for (const [path, text] of Object.entries({
    ".pgraph.json": JSON.stringify({
      topology: { services: [{ name, path: ".", ...config }] },
    }),
    ...files,
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const graph = PGraph.open(root);
  graph.index();
  const result = {
    root: graph.root,
    graph,
    project: hash(graph.root).slice(0, 24),
    name,
  };
  opened.push(result);
  return result;
}
afterEach(() => {
  for (const item of opened.splice(0)) {
    item.graph.close();
    rmSync(item.root, { recursive: true, force: true });
  }
});
function names(result: WorkspaceImpactResult) {
  return result.paths.map((path) =>
    [result.origin, ...path.steps.map((step) => step.to)].map(
      (key) => result.symbols.find((node) => node.key === key)!.name,
    ),
  );
}
it("connects HTTP callsites to imported handlers, downstream code and tests, and traces consumers in reverse", () => {
  const a = fixture(
    "orders",
    { urls: { BILLING_URL: "https://billing.internal" } },
    {
      "client.ts":
        "export async function submit(){return fetch(`${process.env.BILLING_URL}/api/payments`,{method:'POST'});}\nexport function checkout(){return submit();}\n",
    },
  );
  const b = fixture(
    "billing",
    { origins: ["https://billing.internal"] },
    {
      "index.ts":
        "import {app} from '@azure/functions'; import {pay} from './pay.js'; app.http('payments',{methods:['POST'],handler:pay});",
      "pay.ts":
        "export function calculate(){return 1;} export function pay(){return calculate();}",
      "pay.test.ts":
        "import {pay} from './pay.js'; declare function test(n:string,fn:()=>void):void; test('pay works',()=>{pay();});",
    },
  );
  const down = workspaceImpact([a, b], {
    project: a.project,
    symbol: "submit",
  });
  expect(names(down)).toContainEqual(["submit", "pay", "calculate"]);
  expect(
    down.tests.some(
      (test) =>
        down.symbols.find((node) => node.key === test.test)?.name ===
        "pay works",
    ),
  ).toBe(true);
  const bridge = down.paths
    .flatMap((path) => path.steps)
    .find((step) => step.type === "http")!;
  expect(bridge.sources.map((source) => source.file)).toEqual([
    "client.ts",
    "index.ts",
  ]);
  expect(bridge.sources.every((source) => source.hash.length === 64)).toBe(
    true,
  );
  expect(down.symbols.find((node) => node.name === "pay")?.file).toBe("pay.ts");
  const up = workspaceImpact([a, b], {
    project: b.project,
    symbol: "calculate",
  });
  expect(names(up)).toContainEqual(["calculate", "pay", "submit", "checkout"]);
  expect(
    up.paths.some((path) => path.direction === "upstream callers/publishers"),
  ).toBe(true);
});

it("follows actual Service Bus sends and Event Grid sends across two boundaries, not sender factories", () => {
  const a = fixture(
    "orders",
    { resources: { BUS: "company/orders" } },
    {
      "index.ts": `import {ServiceBusClient} from '@azure/service-bus';
export function serialize(){return 1;}
export async function publish(){await sender.sendMessages({body:serialize()});}
const bus=new ServiceBusClient(process.env.BUS); const sender=bus.createSender('orders');
export function onlyConfigure(){return bus.createSender('orders');}`,
    },
  );
  const b = fixture(
    "jobs",
    { resources: { BUS: "company/orders", GRID: "company/events" } },
    {
      "index.ts": `import {app} from '@azure/functions'; import {EventGridPublisherClient} from '@azure/eventgrid';
const grid=new EventGridPublisherClient(process.env.GRID,'EventGrid',{});
export async function processOrder(){await grid.send([]);}
app.serviceBusQueue('orders',{queueName:'orders',connection:'BUS',handler:async()=>{await processOrder();}});`,
    },
  );
  const c = fixture(
    "archive",
    { resources: { "event-grid": "company/events" } },
    {
      "index.ts":
        "import {app} from '@azure/functions'; export function persist(){return true;} export function archive(){return persist();} app.eventGrid('events',{handler:archive});",
    },
  );
  const result = workspaceImpact([a, b, c], {
    project: a.project,
    symbol: "serialize",
  });
  expect(
    result.paths.some(
      (path) =>
        path.bridges === 2 &&
        path.steps
          .filter((step) => ["service-bus", "event-grid"].includes(step.type))
          .map((step) => step.type)
          .join(",") === "service-bus,event-grid",
    ),
  ).toBe(true);
  expect(
    names(result).some(
      (path) =>
        path.includes("processOrder") &&
        path.includes("archive") &&
        path.includes("persist"),
    ),
  ).toBe(true);
  const points = a.graph.topology().endpoints;
  expect(
    points.find((point) => point.provenance.source === "azure-service-bus-send")
      ?.execution?.symbols,
  ).toEqual([a.graph.symbol("publish").id]);
  expect(
    workspaceImpact([a, b, c], { project: a.project, symbol: "onlyConfigure" })
      .paths,
  ).toHaveLength(0);
});

it("links registered extra-output writes while ignoring an unrelated lookalike object", () => {
  const a = fixture(
    "web",
    { resources: { STORAGE: "company/jobs" } },
    {
      "index.ts": `import {app,output} from '@azure/functions';
export function publish(request:any,context:any){context.extraOutputs.set(jobs,{body:1});}
export function unrelated(context:any){context.extraOutputs.set(jobs,{body:2});}
const jobs=output.storageQueue({queueName:'jobs',connection:'STORAGE'});
app.http('submit',{methods:['POST'],extraOutputs:[jobs],handler:publish});`,
    },
  );
  const b = fixture(
    "worker",
    { resources: { STORAGE: "company/jobs" } },
    {
      "index.ts":
        "import {app} from '@azure/functions'; export function save(){return true;} app.storageQueue('jobs',{queueName:'jobs',connection:'STORAGE',handler:async()=>{save();}});",
    },
  );
  const result = workspaceImpact([a, b], {
    project: a.project,
    symbol: "publish",
  });
  expect(names(result).some((path) => path.includes("save"))).toBe(true);
  expect(
    result.paths.some((path) =>
      path.steps.some((step) => step.type === "storage-queue"),
    ),
  ).toBe(true);
  expect(
    workspaceImpact([a, b], { project: a.project, symbol: "unrelated" }).paths,
  ).toHaveLength(0);
});

it("keeps ambiguous destinations separate and does not pivot through unrelated users of a helper", () => {
  const a = fixture(
    "client",
    { urls: { API: "https://shared.internal" } },
    {
      "index.ts":
        "export function helper(){return 1;} export function start(){return helper();} export function unrelated(){helper(); return fetch(`${process.env.API}/api/read`);}",
    },
  );
  const code =
    "import {app} from '@azure/functions'; export function handle(){return 1;} app.http('read',{methods:['GET'],handler:handle});";
  const b = fixture(
    "same",
    { origins: ["https://shared.internal"] },
    { "index.ts": code },
  );
  const c = fixture(
    "same",
    { origins: ["https://shared.internal"] },
    { "index.ts": code },
  );
  expect(
    workspaceImpact([a, b, c], { project: a.project, symbol: "start" }).paths,
  ).toHaveLength(0);
  const result = workspaceImpact([a, b, c], {
    project: a.project,
    symbol: "unrelated",
  });
  expect(
    new Set(
      result.symbols
        .filter((node) => node.name === "handle")
        .map((node) => node.project),
    ).size,
  ).toBe(2);
  expect(
    result.paths
      .flatMap((path) => path.steps)
      .filter((step) => step.type === "http")
      .every((step) => step.evidence === "ambiguous candidate"),
  ).toBe(true);
});

it("preserves useful projects when another index is stale or unavailable, and rejects an invalid origin", () => {
  const a = fixture(
    "client",
    { urls: { API: "https://target.internal" } },
    {
      "index.ts":
        "export function start(){return fetch(`${process.env.API}/api/read`);}",
    },
  );
  const code =
    "import {app} from '@azure/functions'; export function handle(){return 1;} app.http('read',{methods:['GET'],handler:handle});";
  const b = fixture(
    "stale",
    { origins: ["https://target.internal"] },
    { "index.ts": code },
  );
  const c = fixture(
    "fresh",
    { origins: ["https://target.internal"] },
    { "index.ts": code },
  );
  writeFileSync(join(b.root, "index.ts"), code + "\n// edited");
  const missing = {
    project: hash("missing-fixture").slice(0, 24),
    name: "missing",
    error: "Index unavailable",
  };
  const result = workspaceImpact([a, b, c, missing], {
    project: a.project,
    symbol: "start",
  });
  expect(result.projects.filter((project) => project.error)).toHaveLength(2);
  expect(
    result.symbols.some(
      (node) => node.project === c.project && node.name === "handle",
    ),
  ).toBe(true);
  expect(result.symbols.some((node) => node.project === b.project)).toBe(false);
  expect(result.truncated).toBe(true);
  expect(() =>
    workspaceImpact([a, b], { project: b.project, symbol: "handle" }),
  ).toThrow("stale");
  expect(() =>
    workspaceImpact([{ ...a, project: c.project }], {
      project: c.project,
      symbol: "start",
    }),
  ).toThrow("identity");
  c.graph.store.setMeta("retrievalVersion", 4);
  expect(
    workspaceImpact([a, c], {
      project: a.project,
      symbol: "start",
    }).projects.find((project) => project.project === c.project)?.error,
  ).toContain("current PGraph extraction");
});

it("supports HTTP communication within one repository and leaves unresolved handlers explicit", () => {
  const a = fixture(
    "mono",
    {
      urls: { SELF: "https://mono.internal" },
      origins: ["https://mono.internal"],
    },
    {
      "index.ts":
        "import {app} from '@azure/functions'; export function start(){return fetch(`${process.env.SELF}/api/read`);} export function handle(){return 1;} app.http('read',{methods:['GET'],handler:handle}); export function unknown(){return fetch(`${process.env.SELF}/api/dynamic`);} app.http('dynamic',{methods:['GET'],handler:wrap(handle)}); declare function wrap(h:unknown):any;",
    },
  );
  expect(
    names(workspaceImpact([a], { project: a.project, symbol: "start" })),
  ).toContainEqual(["start", "handle"]);
  const unknown = workspaceImpact([a], {
    project: a.project,
    symbol: "unknown",
  });
  expect(unknown.paths).toHaveLength(0);
  expect(
    unknown.unknown.some((item) =>
      item.reason.includes("no indexed execution"),
    ),
  ).toBe(true);
});

it("packs whole paths with no dangling source identities, preserves failures and reports omissions", () => {
  const a = fixture(
    "client",
    { urls: { API: "https://target.internal" } },
    {
      "index.ts":
        "export function start(){return fetch(`${process.env.API}/api/read`);}",
    },
  );
  expect(a.graph.focus({ file: "index.ts", line: 1 }).name).toBe("start");
  const code =
    "import {app} from '@azure/functions'; export function handle(){return 1;} app.http('read',{methods:['GET'],handler:handle});";
  const b = fixture(
    "receiver",
    { origins: ["https://target.internal"] },
    { "index.ts": code },
  );
  const input = workspaceImpact(
    [
      a,
      b,
      {
        project: hash("unavailable").slice(0, 24),
        name: "unavailable",
        error: "Index first",
      },
    ],
    { project: a.project, symbol: "start" },
  );
  for (const budget of [128, 500, 1000, 1500, 2000, 4000, 32000]) {
    const text = packWorkspaceImpact(input, budget),
      result = JSON.parse(text);
    expect(bpeCounter.count(text)).toBeLessThanOrEqual(budget);
    if (result.error) {
      expect(result.error).toContain("Increase maxTokens");
      continue;
    }
    expect(
      result.projects.find(
        (project: { name: string }) => project.name === "unavailable",
      ).error,
    ).toBe("Index first");
    const handles = new Set(
      result.symbols.map((symbol: { key: string }) => symbol.key),
    );
    for (const path of result.paths)
      for (const step of path.steps) {
        expect(handles.has(step.from)).toBe(true);
        expect(handles.has(step.to)).toBe(true);
      }
    expect(result.paths.length + result.omitted.paths).toBe(input.paths.length);
    if (budget === 32000) expect(result.paths).toEqual(input.paths);
  }
  expect(() =>
    dispatchTool(a.graph, "impact", { symbol: "start", workspace: true }),
  ).toThrow("workspace adapter");
  expect(() =>
    workspaceImpact([a, b], { project: a.project, symbol: "start", depth: 5 }),
  ).toThrow();
});

it("does not invent calls for opaque nested callbacks or locally shadowed environment settings", () => {
  const a = fixture(
    "client",
    { urls: { API: "https://target.internal" } },
    {
      "index.ts": `declare function opaque(callback:()=>unknown):void;
export function callbackOwner(){opaque(()=>fetch(\`\${process.env.API}/api/read\`));}
export function shadowed(process:any){return fetch(\`\${process.env.API}/api/read\`);}
export const namedArrow=()=>fetch(\`\${process.env.API}/api/read\`);`,
    },
  );
  const b = fixture(
    "receiver",
    { origins: ["https://target.internal"] },
    {
      "index.ts":
        "import express from 'express'; const app=express(); export function handle(){return 1;} app.get('/api/read',handle);",
    },
  );
  expect(
    workspaceImpact([a, b], { project: a.project, symbol: "callbackOwner" })
      .paths,
  ).toHaveLength(0);
  expect(
    workspaceImpact([a, b], { project: a.project, symbol: "shadowed" }).paths,
  ).toHaveLength(0);
  expect(
    names(
      workspaceImpact([a, b], { project: a.project, symbol: "namedArrow" }),
    ),
  ).toContainEqual(["namedArrow", "handle"]);
});
