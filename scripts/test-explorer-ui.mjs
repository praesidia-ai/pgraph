import { build } from "esbuild";
import { chromium } from "playwright";
import { PGraph, composeWorkspace } from "../packages/graph-core/dist/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";
const root = resolve(".");
mkdirSync(join(root, "artifacts"), { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "pgraph-ui-"));
const definitions = [
  [
    "orders",
    {
      urls: { BILLING_URL: "https://billing.internal" },
      resources: { BUS: "company-orders" },
    },
    `import {ServiceBusClient} from '@azure/service-bus'; const client=new ServiceBusClient(process.env.BUS); client.createSender('orders'); export async function submitOrder(){await validateOrder();return fetch(\`\${process.env.BILLING_URL}/api/payments\`,{method:'POST'});} export function validateOrder(){return true;} fetch(process.env.AUDIT_URL);`,
  ],
  [
    "billing",
    { origins: ["https://billing.internal"] },
    `import {app} from '@azure/functions'; export async function pay(){return {status:200};} app.http('payments',{methods:['POST'],handler:pay});`,
  ],
  [
    "fulfillment",
    { resources: { BUS: "company-orders" } },
    `import {app} from '@azure/functions'; app.serviceBusQueue('orders',{queueName:'orders',connection:'BUS',handler:async()=>{}});`,
  ],
];
const graphs = [];
let browser;
try {
  for (const [name, mapping, source] of definitions) {
    const dir = join(scratch, name);
    mkdirSync(dir);
    writeFileSync(
      join(dir, ".pgraph.json"),
      JSON.stringify({
        topology: { services: [{ name, path: ".", ...mapping }] },
      }),
    );
    writeFileSync(join(dir, "index.ts"), source);
    const g = PGraph.open(dir);
    g.index();
    graphs.push(g);
  }
  const data = composeWorkspace(graphs.map((g) => g.topology()));
  const neighborhood = graphs[0].relationships({
    symbol: graphs[0].symbol("submitOrder").id,
    depth: 1,
  });
  const built = await build({
    entryPoints: [root + "/apps/vscode-extension/src/explorer.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["vscode"],
  });
  const mod = { exports: {} };
  const require = createRequire(import.meta.url);
  vm.runInNewContext(built.outputFiles[0].text, {
    module: mod,
    exports: mod.exports,
    require: (name) =>
      name === "vscode"
        ? {
            Uri: {
              joinPath: (base, ...parts) => pathToFileURL(join(base, ...parts)),
            },
          }
        : require(name),
  });
  const html = mod.exports.explorerHTML(
    { asWebviewUri: (u) => u, cspSource: "file:" },
    root + "/apps/vscode-extension",
  );
  const pageFile = join(scratch, "index.html");
  writeFileSync(pageFile, html);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PGRAPH_BROWSER_PATH
      ? { executablePath: process.env.PGRAPH_BROWSER_PATH }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 950 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ data, neighborhood }) => {
      window.sent = [];
      window.acquireVsCodeApi = () => ({
        postMessage: (message) => {
          window.sent.push(message);
          if (["ready", "workspace", "refresh"].includes(message.type))
            setTimeout(
              () =>
                window.postMessage(
                  { type: "graph", graph: data, mode: "workspace" },
                  "*",
                ),
              0,
            );
          if (["focus", "search"].includes(message.type))
            setTimeout(
              () =>
                window.postMessage(
                  { type: "graph", graph: neighborhood, mode: "symbols" },
                  "*",
                ),
              0,
            );
        },
      });
    },
    { data, neighborhood },
  );
  await page.goto(pathToFileURL(pageFile).href);
  await page
    .getByRole("button", { name: "orders · service", exact: true })
    .waitFor();
  assert.ok(await page.locator("canvas").count());
  assert.match(await page.locator("#status").innerText(), /3 relationships/);
  await page.screenshot({
    path: root + "/artifacts/pgraph-v2-preview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "orders → billing · http", exact: true })
    .click();
  assert.match(await page.locator("#detail").innerText(), /SHA-256/);
  await page
    .getByRole("button", { name: "Open origin evidence", exact: true })
    .click();
  assert.ok(
    (await page.evaluate(() => window.sent)).some((m) => m.type === "open"),
  );
  await page
    .getByRole("button", { name: "orders · service", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Explore service", exact: true })
    .click();
  await page
    .getByRole("button", { name: "submitOrder · function", exact: true })
    .waitFor();
  await page.getByLabel("Search symbols").fill("submitOrder");
  await page.getByLabel("Depth", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  assert.ok(
    (await page.evaluate(() => window.sent)).some(
      (m) => m.type === "search" && m.query === "submitOrder" && m.depth === 2,
    ),
  );
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  const hostile = {
    ...data,
    truncated: true,
    nodes: [
      { ...data.nodes[0], label: '<img src=x onerror="window.hacked=true">' },
    ],
    edges: [],
  };
  await page.evaluate(
    (graph) =>
      window.postMessage({ type: "graph", graph, mode: "workspace" }, "*"),
    hostile,
  );
  await page
    .getByRole("button", {
      name: '<img src=x onerror="window.hacked=true"> · service',
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator("img").count(), 0);
  assert.equal(await page.evaluate(() => window.hacked), undefined);
  assert.match(await page.locator("#status").innerText(), /PARTIAL VIEW/);
  await page.setViewportSize({ width: 600, height: 900 });
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser UI passed: local CSP assets, canvas rendering, service drill-down, edge evidence, source messages, search/depth, fit, hostile-label rendering and truncation status.",
  );
} finally {
  if (browser) await browser.close();
  for (const g of graphs) g.close();
  rmSync(scratch, { recursive: true, force: true });
}
