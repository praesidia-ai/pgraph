// Compare retained/current workers on identical Git fixtures, with an independent typecheck.
import { fork, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { bpeCounter } from "../../packages/graph-context/dist/index.js";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const scratch = mkdtempSync(join(tmpdir(), "pgraph-history-probe-"));
const baseline = resolve("artifacts/pgraph-0.5.3.vsix");
const current = resolve("apps/vscode-extension/dist/worker.cjs");
const initial = {
  ".gitignore": ".pgraph/\n",
  "package.json": '{"name":"history-probe","type":"module"}',
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      module: "NodeNext",
      target: "ES2022",
      noEmit: true,
      strict: true,
      types: [],
    },
    include: ["*.ts"],
  }),
  "price.ts":
    "export function price(quantity: number): number { return quantity * 2; }\n",
  "checkout.ts":
    "import {price} from './price.js'; export function checkout() { return price(2); }\n",
  "checkout.test.ts":
    "import {checkout} from './checkout.js'; declare function test(name:string,run:()=>void):void; test('checkout works',()=>{checkout();});\n",
};
function put(root, path, source) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}
function git(root, args) {
  return execFileSync(
    "git",
    [
      "-C",
      root,
      "-c",
      `core.hooksPath=${join(scratch, "absent-hooks")}`,
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
      },
    },
  );
}
function compile(root) {
  let code = 0,
    text;
  try {
    text = execFileSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "--project",
        root,
        "--pretty",
        "false",
      ],
      { encoding: "utf8", timeout: 30000, maxBuffer: 100000 },
    );
  } catch (error) {
    code = error.status;
    text = String(error.stdout ?? error.message);
  }
  return {
    exitCode: code,
    diagnostics: text.replaceAll(root, "<fixture>"),
    codes: [
      ...new Set(
        [...text.matchAll(/TS(\d+):/g)].map((match) => Number(match[1])),
      ),
    ],
  };
}
function start(worker, root) {
  const child = fork(worker, [root], {
    execArgv: [],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const pending = new Map();
  let serial = 0,
    stderr = "";
  child.stderr.on("data", (value) => {
    stderr = (stderr + value).slice(-3000);
  });
  const fail = (error) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
  };
  child.on("error", fail);
  child.on("exit", (code) => fail(Error(`Worker exited ${code}: ${stderr}`)));
  child.on("message", (message) => {
    if (message.progress) return;
    const p = pending.get(message.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(message.id);
    if (message.error) p.reject(Error(message.error));
    else p.resolve(message.result);
  });
  return {
    call(op, args = {}) {
      return new Promise((resolve, reject) => {
        const id = ++serial;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("Worker timeout"));
          child.kill();
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
    currentWorkerSha256: hash(readFileSync(current)),
    currentVersion: JSON.parse(
      readFileSync("apps/vscode-extension/package.json"),
    ).version,
    compiler: JSON.parse(readFileSync("node_modules/typescript/package.json"))
      .version,
    fixtures: initial,
    fixtureHash: hash(JSON.stringify(initial)),
    tokenizer: bpeCounter.name,
    method:
      "Retained 0.5.3 and current workers index identical post-edit sources with identical committed baselines. Old current-declaration/file-review tools are compared with the new historical action. A separate TypeScript noEmit process checks each fixture before/after editing. Tests are only parsed; no application tests/scripts or model tasks run. Traffic counts JSON {name,input} plus returned text, excluding indexing, tool discovery, IPC framing, compiler execution and the explicitly recorded repeat timing check. More historical evidence may require more output; this is not paid-token savings or completed-agent-task evidence.",
    runs: [],
  };
  for (const scenario of ["deleted-api", "changed-parameter", "comment-only"])
    for (const version of ["baseline", "current"]) {
      const root = join(scratch, scenario, version);
      for (const [path, source] of Object.entries(initial))
        put(root, path, source);
      git(root, ["init"]);
      git(root, ["add", "."]);
      git(root, [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-m",
        "baseline",
      ]);
      const before = compile(root);
      if (before.exitCode !== 0)
        throw Error("Baseline compiler fixture failed");
      const edited =
        scenario === "deleted-api"
          ? null
          : scenario === "changed-parameter"
            ? "export function price(quantity: string): number { return quantity.length; }\n"
            : initial["price.ts"] + "// documentation only\n";
      if (edited === null) unlinkSync(join(root, "price.ts"));
      else put(root, "price.ts", edited);
      const after = compile(root);
      if (scenario === "deleted-api" && !after.codes.includes(2307))
        throw Error("Expected missing API diagnostic");
      if (scenario === "changed-parameter" && !after.codes.includes(2345))
        throw Error("Expected incompatible argument diagnostic");
      if (scenario === "comment-only" && after.exitCode !== 0)
        throw Error("Comment-only control failed");
      active = start(
        version === "baseline"
          ? join(scratch, "baseline/extension/dist/worker.cjs")
          : current,
        root,
      );
      const indexed = await active.call("index");
      const requests =
        version === "baseline"
          ? [
              {
                name: "workflow",
                input: { action: "changes", maxTokens: 2000 },
              },
              { name: "review_changes", input: { maxTokens: 2000 } },
            ]
          : [
              {
                name: "workflow",
                input: { action: "change_impact", maxTokens: 2000 },
              },
            ];
      const queries = [];
      for (const request of requests) {
        const startTime = performance.now();
        const response = await active.call("tool", request);
        queries.push({
          request,
          response: JSON.parse(response),
          elapsedMs: Math.round(performance.now() - startTime),
          requestTokens: bpeCounter.count(JSON.stringify(request)),
          responseTokens: bpeCounter.count(response),
          responseHash: hash(response),
        });
      }
      let repeat;
      if (version === "current") {
        const startTime = performance.now();
        const response = await active.call("tool", requests[0]);
        repeat = {
          elapsedMs: Math.round(performance.now() - startTime),
          identicalResponse: hash(response) === queries[0].responseHash,
        };
        if (!repeat.identicalResponse)
          throw Error("Repeated evidence changed without a changed input");
        const changes = queries[0].response.changes;
        if (!Array.isArray(changes))
          throw Error("Historical evidence did not fit its default budget");
        const price = changes.find(
          (change) => change.before?.symbol === "price",
        );
        if (
          scenario === "deleted-api" &&
          (price?.change !== "removed" ||
            !price.consumers.some((entry) => entry.node.symbol === "checkout"))
        )
          throw Error("Missing historical deleted-API consumer");
        if (
          scenario === "changed-parameter" &&
          (price?.change !== "signature" ||
            !price.consumers.some((entry) => entry.node.symbol === "checkout"))
        )
          throw Error("Missing changed-contract consumer");
        if (scenario === "comment-only" && changes.length)
          throw Error("Comment-only control incorrectly changed a declaration");
      }
      report.runs.push({
        scenario,
        version,
        editedSource: edited,
        before,
        after,
        indexMs: indexed.durationMs,
        queries,
        repeat,
        trafficTokens: queries.reduce(
          (sum, query) => sum + query.requestTokens + query.responseTokens,
          0,
        ),
      });
      await active.close();
      active = undefined;
    }
  writeFileSync(
    process.argv[2] ?? join(tmpdir(), "pgraph-historical-impact.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      report.runs.map((run) => ({
        scenario: run.scenario,
        version: run.version,
        compilerCodes: run.after.codes,
        trafficTokens: run.trafficTokens,
        firstMs: run.queries[0].elapsedMs,
        repeat: run.repeat,
      })),
    ),
  );
} finally {
  await active?.close();
  rmSync(scratch, { recursive: true, force: true });
}
