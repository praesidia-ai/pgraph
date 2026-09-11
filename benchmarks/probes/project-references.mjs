// Paired synthetic graph evidence, not completed agent tasks or paid-token savings.
import { fork, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { bpeCounter } from "../../packages/graph-core/dist/index.js";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const baseline = resolve("artifacts/pgraph-0.5.1.vsix");
const scratch = mkdtempSync(join(tmpdir(), "pgraph-project-probe-"));
const put = (root, path, value) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(
    join(root, path),
    typeof value === "string" ? value : JSON.stringify(value),
  );
};
const files = {
  "package.json": { private: true, workspaces: ["packages/*"] },
  "packages/domain/package.json": {
    name: "@fixture/domain",
    type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  },
  "packages/domain/tsconfig.json": {
    compilerOptions: {
      composite: true,
      rootDir: "src",
      outDir: "dist",
      module: "NodeNext",
    },
  },
  "packages/domain/src/index.ts":
    "export function chargeCard(amount:number) { return amount * 100; }\n",
  "packages/app/package.json": { name: "@fixture/app", type: "module" },
  "packages/app/tsconfig.json": {
    compilerOptions: {
      composite: true,
      rootDir: "src",
      outDir: "dist",
      module: "NodeNext",
    },
    references: [{ path: "../domain" }],
  },
  "packages/app/src/index.ts":
    "import {chargeCard} from '@fixture/domain'; export function checkout(){return chargeCard(42);}\n",
  "packages/app/src/payment.test.ts":
    "import {checkout} from './index.js'; declare function test(name:string,run:()=>void):void; test('payment works',()=>{checkout();});\n",
};
const requests = [
  { name: "callees", input: { symbol: "checkout", maxTokens: 1500 } },
  { name: "callers", input: { symbol: "chargeCard", maxTokens: 1500 } },
  { name: "tests", input: { symbol: "chargeCard", maxTokens: 1500 } },
];
function start(worker, root) {
  const child = fork(worker, [root], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    execArgv: [],
  });
  let serial = 0,
    stderr = "";
  const pending = new Map();
  child.stderr.on("data", (data) => {
    stderr = (stderr + data).slice(-2000);
  });
  const fail = (error) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
  };
  child.on("error", fail);
  child.on("exit", (code) =>
    fail(new Error(`Worker exited ${code}: ${stderr}`)),
  );
  child.on("message", (message) => {
    if (message.progress) return;
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    clearTimeout(p.timer);
    if (message.error) p.reject(new Error(message.error));
    else p.resolve(message.result);
  });
  return {
    call(op, args = {}) {
      return new Promise((resolve, reject) => {
        const id = ++serial;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Worker timeout"));
        }, 60000);
        pending.set(id, { resolve, reject, timer });
        child.send({ id, op, args });
      });
    },
    async close() {
      if (child.exitCode !== null) return;
      await new Promise((done) => {
        const timer = setTimeout(() => child.kill(), 3000);
        child.once("exit", () => {
          clearTimeout(timer);
          done();
        });
        if (child.connected) child.disconnect();
        else child.kill();
      });
    },
  };
}
let active;
try {
  execFileSync("unzip", ["-q", baseline, "-d", join(scratch, "baseline")]);
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    baselineArtifactSha256: hash(readFileSync(baseline)),
    previewWorkerSha256: hash(
      readFileSync("apps/vscode-extension/dist/worker.cjs"),
    ),
    fixtureHash: hash(JSON.stringify(files)),
    fixtures: files,
    tokenizer: bpeCounter.name,
    method:
      "Actual old/new extension workers index identical generated source in isolated roots. Exact callers, callees and static test-path responses are compared for cold source, installed local workspace links with stale declarations, and a separate installed package. Counts cover JSON {name,input} query requests and returned text, excluding indexing and IPC framing. No model, billing or application test execution is involved.",
    runs: [],
  };
  for (const scenario of [
    "unbuilt",
    "local-link-stale-types",
    "installed-external",
  ])
    for (const version of ["baseline", "preview"]) {
      const root = join(scratch, scenario, version);
      for (const [path, source] of Object.entries(files))
        put(root, path, source);
      if (scenario === "local-link-stale-types") {
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
      }
      if (scenario === "installed-external") {
        put(root, "node_modules/@fixture/domain/package.json", {
          name: "@fixture/domain",
          types: "index.d.ts",
        });
        put(
          root,
          "node_modules/@fixture/domain/index.d.ts",
          "export declare function chargeCard(amount:number):number;\n",
        );
      }
      const worker =
        version === "baseline"
          ? join(scratch, "baseline/extension/dist/worker.cjs")
          : resolve("apps/vscode-extension/dist/worker.cjs");
      active = start(worker, root);
      const index = await active.call("index");
      const calls = [];
      for (const request of requests) {
        const response = await active.call("tool", request);
        calls.push({
          request,
          response: JSON.parse(response),
          requestTokens: bpeCounter.count(JSON.stringify(request)),
          responseTokens: bpeCounter.count(response),
        });
      }
      report.runs.push({
        scenario,
        version,
        files: index.files,
        indexMs: index.durationMs,
        calls,
      });
      await active.close();
      active = undefined;
    }
  const summary = report.runs.map((run) => ({
    scenario: run.scenario,
    version: run.version,
    calleeFound: run.calls[0].response.some(
      (node) => node.symbol === "chargeCard",
    ),
    callerFound: run.calls[1].response.some(
      (node) => node.symbol === "checkout",
    ),
    testFound: run.calls[2].response.tests.some(
      (item) => item.node.symbol === "payment works",
    ),
    trafficTokens: run.calls.reduce(
      (sum, call) => sum + call.requestTokens + call.responseTokens,
      0,
    ),
  }));
  report.summary = summary;
  writeFileSync(
    process.argv[2] ?? "benchmarks/reports/v052-project-references.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await active?.close();
  rmSync(scratch, { recursive: true, force: true });
}
