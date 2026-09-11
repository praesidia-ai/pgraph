import { afterEach, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PGraph,
  workspaceImpact,
  composeWorkspace,
  bpeCounter,
} from "@praesidia/pgraph-core";
import { dispatchTool } from "@praesidia/pgraph-tools";
import { hash, configSchema } from "@praesidia/pgraph-shared";
import { dailyReport } from "../apps/vscode-extension/src/daily-report.js";

const graphs: PGraph[] = [];
function fixture(
  files: Record<string, string>,
  config: Record<string, unknown> = {},
) {
  const root = mkdtempSync(join(tmpdir(), "pgraph-connection-readiness-"));
  for (const [file, text] of Object.entries(files))
    writeFileSync(join(root, file), text);
  writeFileSync(
    join(root, ".pgraph.json"),
    JSON.stringify({
      topology: { services: [{ name: "service", path: ".", ...config }] },
    }),
  );
  const graph = PGraph.open(root);
  graphs.push(graph);
  graph.index();
  return {
    graph,
    root: graph.root,
    project: hash(graph.root).slice(0, 24),
    name: "service",
  };
}
afterEach(() => {
  for (const graph of graphs.splice(0)) {
    graph.close();
    rmSync(graph.root, { recursive: true, force: true });
  }
});

it("connects explicit channel mappings through const aliases, guarded defaults, typed spreads and scheduled sends", () => {
  const a = fixture(
    {
      "index.ts": `import {ServiceBusClient} from '@azure/service-bus';
const setting='BUS'; const connection=process.env[setting]!;
const output=process.env.OUT_QUEUE ?? 'fallback-queue';
const client=new ServiceBusClient(connection);const sender=client.createSender(output);
export async function send(){await sender.scheduleMessages({body:1},new Date());}`,
    },
    { resources: { BUS: "namespace/prod" }, channels: { OUT_QUEUE: "work" } },
  );
  const b = fixture(
    {
      "handler.ts": "export function consume(){return true;}",
      "index.ts": `import {app} from '@azure/functions';import {consume} from './handler.js';
const shared={handler:consume,isSessionsEnabled:true} as const;
const connection='INPUT_BUS';
app.serviceBusQueue('worker',({...shared,connection,queueName:'%IN_QUEUE%'} satisfies Record<string,unknown>) as any);`,
    },
    {
      resources: { INPUT_BUS: "namespace/prod" },
      channels: { IN_QUEUE: "work" },
    },
  );
  const endpoint = a.graph
    .topology()
    .endpoints.find(
      (e) => e.provenance.source === "azure-service-bus-schedule",
    )!;
  expect(endpoint.setting).toBe("BUS");
  expect(endpoint.addressSetting).toBe("OUT_QUEUE");
  expect(endpoint.address).toBeUndefined();
  expect(endpoint.addressFallback).toBe("fallback-queue");
  const result = workspaceImpact([a, b], {
    project: a.project,
    symbol: "send",
  });
  expect(
    result.symbols.some(
      (symbol) => symbol.project === b.project && symbol.name === "consume",
    ),
  ).toBe(true);
  expect(
    result.paths
      .flatMap((path) => path.steps)
      .some((step) => step.detail?.includes("azure-service-bus-schedule")),
  ).toBe(true);
  expect(a.graph.connections().counts.missing).toBe(0);
  expect(b.graph.connections().counts.missing).toBe(0);
});

it("never substitutes an unverified default, placeholder, or same setting name for deployment identity", () => {
  const a = fixture(
    {
      "index.ts": `import {ServiceBusClient} from '@azure/service-bus';const client=new ServiceBusClient(process.env.BUS);const queue=process.env.QUEUE??'work';const sender=client.createSender(queue);export function send(){return sender.sendMessages({body:1});}`,
    },
    { resources: { BUS: "namespace/prod" } },
  );
  const b = fixture(
    {
      "index.ts":
        "import {app} from '@azure/functions';app.serviceBusQueue('worker',{connection:'BUS',queueName:'%QUEUE%',handler:()=>{}});",
    },
    { resources: { BUS: "namespace/prod" } },
  );
  expect(
    composeWorkspace([a.graph.topology(), b.graph.topology()]).edges.every(
      (edge) => edge.evidence === "unresolved",
    ),
  ).toBe(true);
  const readiness = a.graph.connections();
  expect(
    readiness.requirements.find((row) => row.kind === "channel"),
  ).toMatchObject({
    setting: "QUEUE",
    status: "missing",
    configuration: "channels.QUEUE",
    fallback: "work",
  });
  expect(readiness.note).toContain("never assumed");
  expect(
    configSchema.safeParse({
      topology: { services: [{ name: "x", channels: { QUEUE: "" } }] },
    }).success,
  ).toBe(false);
  expect(
    configSchema.safeParse({
      topology: {
        services: [{ name: "x", channels: { QUEUE: "Endpoint=secret" } }],
      },
    }).success,
  ).toBe(false);
});

it("preserves spread order and leaves calls, unknown spreads, reassigned bindings and getters unresolved", () => {
  const a = fixture({
    "index.ts": `import {app} from '@azure/functions';
export function first(){return 1;}export function final(){return 2;}
const base={connection:'BUS',queueName:'work',handler:first} as const;
app.serviceBusQueue('known',{...base,handler:final});
declare function dynamic():Record<string,unknown>;
app.serviceBusQueue('unknown',{...base,...dynamic()});
let mutable={...base};mutable={...base,handler:final};app.serviceBusQueue('mutable',mutable);
const getter={...base,get handler(){return final;}};app.serviceBusQueue('getter',getter);
const overwritten={...base};overwritten.handler=final;app.serviceBusQueue('overwritten',overwritten);
const escaped={...base};mutate(escaped as any);app.serviceBusQueue('escaped',escaped);declare function mutate(value:unknown):void;`,
  });
  const points = a.graph.topology().endpoints;
  expect(points[0]!.execution?.symbols).toEqual([a.graph.symbol("final").id]);
  for (const point of points.slice(1))
    expect(point.execution?.symbols).toHaveLength(0);
  expect(a.graph.connections().counts.dynamic).toBeGreaterThan(0);
});

it("reports exact missing mapping fields with source identity and preserves limits in editor/agent output", () => {
  const a = fixture({
    "index.ts": `import {app} from '@azure/functions';import {ServiceBusClient} from '@azure/service-bus';
const connection=process.env.BUS;const client=new ServiceBusClient(connection);const sender=client.createSender(process.env.OUT_QUEUE);
export function send(){fetch(\`\${process.env.API}/api/read\`);return sender.sendMessages({body:1});}
app.http('read',{handler:send});`,
  });
  const report = a.graph.connections();
  expect(report.requirements.map((row) => row.configuration)).toEqual(
    expect.arrayContaining([
      "resources.BUS",
      "channels.OUT_QUEUE",
      "urls.API",
      "origins",
    ]),
  );
  expect(
    report.requirements.every((row) => row.examples[0]?.hash?.length === 64),
  ).toBe(true);
  const text = dailyReport("connections", report);
  expect(text).toContain("Connection mapping readiness");
  expect(text).toContain("channels.OUT");
  for (const maxTokens of [128, 500, 1000, 4000]) {
    const response = dispatchTool(a.graph, "workflow", {
      action: "connections",
      maxTokens,
    });
    expect(bpeCounter.count(response)).toBeLessThanOrEqual(maxTokens);
    const value = JSON.parse(response);
    if (!value.error) {
      expect(value.counts).toEqual(report.counts);
      expect(value.note).toContain("never assumed");
    }
  }
  writeFileSync(join(a.root, "index.ts"), "export const changed=1;");
  expect(() => a.graph.connections()).toThrow("current source");
});

it("does not assign another file's anonymous callback to the registration file", () => {
  const a = fixture({
    "options.ts":
      "export const options={connection:'BUS',queueName:'work',handler:()=>42} as const;",
    "index.ts":
      "import {app} from '@azure/functions';import {options} from './options.js';app.serviceBusQueue('worker',options);",
  });
  const point = a.graph.topology().endpoints[0]!;
  expect(point.execution?.symbols).toHaveLength(0);
  expect(point.execution?.unresolved).toContain("Handler");
  expect(a.graph.connections().counts.dynamic).toBeGreaterThan(0);
});
