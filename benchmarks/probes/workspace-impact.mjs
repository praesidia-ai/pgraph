import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { bpeCounter } from "../../packages/graph-context/dist/index.js";
import { startWorker } from "./lib/worker.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const scratch = realpathSync(
  mkdtempSync(join(tmpdir(), "pgraph-workspace-paths-")),
);
const baseline = resolve("artifacts/pgraph-0.5.5.vsix");
const current = resolve("apps/vscode-extension/dist/worker.cjs");
const files = [
  {
    name: "checkout",
    config: { urls: { BILLING: "https://billing.internal" } },
    source:
      "export function submit(){return fetch(`${process.env.BILLING}/api/pay`,{method:'POST'});}\n",
  },
  {
    name: "billing",
    config: {
      origins: ["https://billing.internal"],
      resources: { BUS: "company/jobs" },
    },
    source:
      "import {app} from '@azure/functions'; import {ServiceBusClient} from '@azure/service-bus';\nconst bus=new ServiceBusClient(process.env.BUS); const sender=bus.createSender('paid');\nexport function pay(){return sender.sendMessages({body:1});}\napp.http('pay',{methods:['POST'],handler:pay});\n",
  },
  {
    name: "archive",
    config: { resources: { BUS: "company/jobs" } },
    source:
      "import {app} from '@azure/functions';\nexport function persist(){return 1;} export function archive(){return persist();}\napp.serviceBusQueue('paid',{queueName:'paid',connection:'BUS',handler:archive});\n",
    test: "import {archive} from './index.js'; declare function test(n:string,f:()=>void):void; test('archive saves',()=>{archive();});\n",
  },
];
let active;
try {
  execFileSync("unzip", ["-q", baseline, "-d", join(scratch, "baseline")]);
  const report = {
    generatedAt: new Date().toISOString(),
    platform: `${process.platform}/${process.arch}`,
    node: process.version,
    baselineVersion: "0.5.5",
    currentVersion: JSON.parse(readFileSync("package.json", "utf8")).version,
    baselineArtifactSha256: hash(readFileSync(baseline)),
    currentWorkerSha256: hash(readFileSync(current)),
    fixtureSha256: hash(JSON.stringify(files)),
    runs: [],
    limitations: [
      "Authored three-service synthetic fixture, not held-out company tasks or runtime delivery.",
      "The two outputs serve different purposes. No task-success, token-savings or latency-improvement claim.",
      "Per-project source/config freshness is checked; a workspace snapshot is not atomic.",
    ],
  };
  for (const [label, worker] of [
    ["baseline", join(scratch, "baseline/extension/dist/worker.cjs")],
    ["current", current],
  ]) {
    const projects = [],
      snapshots = [];
    for (const file of files) {
      const root = join(scratch, `${label}-${file.name}`);
      mkdirSync(root);
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ name: file.name }),
      );
      writeFileSync(
        join(root, ".pgraph.json"),
        JSON.stringify({
          topology: {
            services: [{ name: file.name, path: ".", ...file.config }],
          },
        }),
      );
      writeFileSync(join(root, "index.ts"), file.source);
      if (file.test) writeFileSync(join(root, "index.test.ts"), file.test);
      active = startWorker(worker, root);
      await active.call("index");
      snapshots.push(await active.call("topology"));
      await active.close();
      active = undefined;
      projects.push({
        root,
        project: hash(root).slice(0, 24),
        name: file.name,
      });
    }
    active = startWorker(worker, projects[0].root);
    const began = performance.now();
    if (label === "baseline") {
      const map = await active.call("workspaceGraph", { snapshots });
      const local = JSON.parse(
        await active.call("tool", {
          name: "impact",
          input: { symbol: "submit", maxTokens: 8000 },
        }),
      );
      assert.equal(map.edges.length, 2);
      assert.ok(
        snapshots.flatMap((s) => s.endpoints).every((e) => !e.execution),
      );
      report.runs.push({
        label,
        serviceEdges: map.edges.length,
        handlerExecutionIdentities: 0,
        localImpact: local,
        queryMilliseconds: Math.round(performance.now() - began),
        interpretation:
          "Service map identifies HTTP and Service Bus declarations. Local impact does not compose executable handler paths across roots.",
      });
    } else {
      const input = {
        workspace: true,
        project: projects[0].project,
        symbol: "submit",
        maxTokens: 8000,
      };
      const text = await active.call("workspaceImpact", { projects, input });
      const result = JSON.parse(text),
        byId = new Map(result.symbols.map((s) => [s.key, s]));
      const paths = result.paths.map((path) => ({
        bridges: path.bridges,
        names: [result.origin, ...path.steps.map((s) => s.to)].map(
          (id) => byId.get(id).name,
        ),
        protocols: path.steps
          .filter((s) => ["http", "service-bus"].includes(s.type))
          .map((s) => s.type),
      }));
      assert.ok(
        paths.some((p) => p.bridges === 2 && p.names.includes("persist")),
      );
      assert.ok(
        result.tests.some((t) => byId.get(t.test).name === "archive saves"),
      );
      assert.ok(
        result.paths
          .flatMap((p) => p.steps)
          .flatMap((s) => s.sources)
          .every((s) => s.hash.length === 64),
      );
      assert.ok(bpeCounter.count(text) <= 8000);
      const queryMilliseconds = Math.round(performance.now() - began);
      const budgets = [];
      for (const maxTokens of [128, 1000, 2000, 4000]) {
        const bounded = await active.call("workspaceImpact", {
            projects,
            input: { ...input, maxTokens },
          }),
          value = JSON.parse(bounded);
        assert.ok(bpeCounter.count(bounded) <= maxTokens);
        budgets.push({
          maxTokens,
          actualTokens: bpeCounter.count(bounded),
          paths: value.paths?.length ?? 0,
          omitted: value.omitted,
          error: value.error,
        });
      }
      writeFileSync(
        join(projects[2].root, "index.ts"),
        files[2].source + "// edited\n",
      );
      const missingRoot = join(scratch, "unindexed");
      mkdirSync(missingRoot);
      const partial = JSON.parse(
        await active.call("workspaceImpact", {
          projects: [
            ...projects,
            {
              root: missingRoot,
              project: hash(missingRoot).slice(0, 24),
              name: "unindexed",
            },
          ],
          input,
        }),
      );
      assert.equal(partial.projects.filter((p) => p.error).length, 2);
      assert.ok(partial.symbols.some((s) => s.name === "pay"));
      assert.ok(!partial.symbols.some((s) => s.name === "archive"));
      assert.ok(!existsSync(join(missingRoot, ".pgraph")));
      report.runs.push({
        label,
        queryMilliseconds,
        responseTokens: bpeCounter.count(text),
        paths,
        sourceIdentities: result.symbols.length,
        candidateTests: result.tests.length,
        budgets,
        partialFailureCheck: {
          failedProjects: partial.projects
            .filter((p) => p.error)
            .map((p) => ({ name: p.name, error: p.error })),
          healthyHandlerRetained: true,
          unindexedRootNotWritten: true,
        },
      });
    }
    await active.close();
    active = undefined;
  }
  const output = resolve(
    process.argv[2] ?? join(tmpdir(), "pgraph-workspace-impact.json"),
  );
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(output + "\n");
} finally {
  await active?.close();
  rmSync(scratch, { recursive: true, force: true });
}
