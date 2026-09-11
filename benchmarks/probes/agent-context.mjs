// Controlled local protocol diagnostic, not a completed coding-task evaluation.
// Build first. Retain the 0.2.0 VSIX for the baseline.
// node benchmarks/probes/agent-context.mjs [report.json] [baseline.vsix]
import { fork, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bpeCounter } from "../../packages/graph-core/dist/index.js";

const digest = (data) => createHash("sha256").update(data).digest("hex");
const baseline = resolve(process.argv[3] ?? "artifacts/pgraph-0.2.0.vsix");
const scratch = mkdtempSync(join(tmpdir(), "pgraph-agent-probe-"));
const files = {
  "package.json": '{"name":"agent-context-fixture","type":"module"}',
  "ledger.ts": `export interface Ledger { save(amount: number): number; }
export class SqlLedger implements Ledger {
  /** Persist a positive balance after validating the amount. */
  save(amount: number) {
    if (amount < 0) throw new Error('Negative balance');
    const rounded = Math.round(amount * 100) / 100;
    return rounded * 2;
  }
}
export class OtherLedger implements Ledger { save(amount: number) { return amount; } }
export function throughInterface(ledger: Ledger, amount: number) { return ledger.save(amount); }
export function directly(amount: number) { return new SqlLedger().save(amount); }
export function injected(amount: number) { return throughInterface(new SqlLedger(), amount); }
`,
  "ledger.test.ts": `import { directly, injected } from './ledger.js';
declare function test(name: string, fn: () => void): void;
test('direct concrete call', () => { directly(3); });
test('injected concrete call', () => { injected(3); });
`,
  "handler.ts": `export class Handler {
  reconcile(amount: number) {
${Array.from({ length: 210 }, (_, i) => `    amount += ${i};`).join("\n")}
    if (amount === 900) throw new Error('chargeback reconciliation');
    return amount;
  }
}
`,
};
function start(worker, root) {
  const child = fork(worker, [root], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    execArgv: [],
  });
  const pending = new Map();
  let serial = 0,
    stderr = "";
  child.stderr.on("data", (data) => {
    stderr = (stderr + data).slice(-3000);
  });
  const fail = (error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  child.on("error", fail);
  child.on("exit", (code) =>
    fail(new Error(`Worker exited ${code}: ${stderr}`)),
  );
  child.on("message", (message) => {
    if (message.progress) return;
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error));
    else item.resolve(message.result);
  });
  return {
    call(op, args = {}) {
      return new Promise((resolve, reject) => {
        const id = ++serial;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Worker timed out"));
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
const schema = (manifest) =>
  manifest.contributes.languageModelTools.map((tool) => ({
    name: tool.name,
    description: tool.modelDescription,
    inputSchema: tool.inputSchema,
  }));
const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  tokenizer: bpeCounter.name,
  methodology:
    "Two built extension workers index separate roots with identical generated source. Three identical named context requests per task, same 2000-token output budget; the new worker receives a retained receipt on requests 2 and 3. Counts exact returned text plus JSON {name,input} requests. A separate total includes one JSON serialization of ALL declared VS Code tool schemas per three-call session. Actual host schema exposure/encoding, reasoning, tool decisions, retries and unrelated conversation tokens are unavailable. The scripted repeat pattern favors reuse and is not representative paired agent work. Source markers and receipt reconstruction are checked; no model calls or application tests are executed. Excerpts are partial line windows, not complete implementations. No runtime receiver identity is inferred.",
  fixtureHash: digest(JSON.stringify(files)),
  baselineArtifactHash: digest(readFileSync(baseline)),
  runs: [],
};
let active;
try {
  const extracted = join(scratch, "baseline");
  execFileSync("unzip", ["-q", baseline, "-d", extracted]);
  const versions = [
    { label: "baseline", dir: join(extracted, "extension"), reuse: false },
    { label: "preview", dir: resolve("apps/vscode-extension"), reuse: true },
  ];
  for (const version of versions) {
    const root = join(scratch, `${version.label}-fixture`);
    mkdirSync(root);
    for (const [file, content] of Object.entries(files))
      writeFileSync(join(root, file), content);
    const worker = join(version.dir, "dist/worker.cjs");
    const manifest = JSON.parse(
      readFileSync(join(version.dir, "package.json"), "utf8"),
    );
    active = start(worker, root);
    await active.call("index");
    const run = {
      version: manifest.version,
      workerHash: digest(readFileSync(worker)),
      declaredToolSchemaTokens: bpeCounter.count(
        JSON.stringify(schema(manifest)),
      ),
      sessions: [],
    };
    for (const task of [
      "Change SqlLedger.save balance validation",
      "Change Handler.reconcile chargeback reconciliation",
    ]) {
      const session = { task, calls: [] };
      let receipt, canonical;
      for (let turn = 0; turn < 3; turn++) {
        const input = {
          task,
          maxTokens: 2000,
          format: "json",
          ...(version.reuse && receipt ? { previousContextId: receipt } : {}),
        };
        const request = { name: "context", input };
        const output = await active.call("tool", request);
        const context = JSON.parse(output);
        if (!Array.isArray(context.symbols))
          throw new Error(`Invalid context: ${output}`);
        if (context.reuseFrom) {
          if (!canonical || context.reuseFrom !== receipt)
            throw new Error("Invalid receipt chain");
          const retained = new Map(
            canonical.map((symbol) => [symbol.id, symbol]),
          );
          canonical = [
            ...context.symbols,
            ...context.reusedSymbols.map((id) => {
              if (!retained.has(id)) throw new Error("Missing retained symbol");
              return retained.get(id);
            }),
          ];
        } else canonical = context.symbols;
        receipt = context.contextId;
        const text = canonical.map((symbol) => symbol.text).join("\n");
        session.calls.push({
          inputTokens: bpeCounter.count(JSON.stringify(request)),
          outputTokens: bpeCounter.count(output),
          reused: context.reusedSymbols?.length ?? 0,
          symbols: canonical.map(({ symbol, representation }) => ({
            symbol,
            representation,
          })),
          hasTargetSourceMarker: text.includes(
            task.includes("Handler")
              ? "throw new Error('chargeback reconciliation')"
              : "return rounded * 2",
          ),
          metrics: await active.call("metrics"),
        });
      }
      session.trafficTokens = session.calls.reduce(
        (n, call) => n + call.inputTokens + call.outputTokens,
        0,
      );
      session.withSchemaTokens =
        session.trafficTokens + run.declaredToolSchemaTokens;
      run.sessions.push(session);
    }
    run.testPathResponse = JSON.parse(
      await active.call("tool", {
        name: "tests",
        input: { symbol: "SqlLedger.save", maxTokens: 3000 },
      }),
    );
    result.runs.push(run);
    await active.close();
    active = undefined;
  }
  result.comparisons = result.runs[0].sessions.map((base, i) => {
    const next = result.runs[1].sessions[i];
    return {
      task: base.task,
      trafficTokens: {
        baseline: base.trafficTokens,
        preview: next.trafficTokens,
      },
      trafficReductionPercent: Number(
        (100 * (1 - next.trafficTokens / base.trafficTokens)).toFixed(2),
      ),
      withAllSchemasOnce: {
        baseline: base.withSchemaTokens,
        preview: next.withSchemaTokens,
      },
      withSchemaReductionPercent: Number(
        (100 * (1 - next.withSchemaTokens / base.withSchemaTokens)).toFixed(2),
      ),
      targetSourceAllTurns: {
        baseline: base.calls.every((call) => call.hasTargetSourceMarker),
        preview: next.calls.every((call) => call.hasTargetSourceMarker),
      },
    };
  });
} finally {
  await active?.close();
  rmSync(scratch, { recursive: true, force: true });
}
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      schemas: result.runs.map(({ version, declaredToolSchemaTokens }) => ({
        version,
        declaredToolSchemaTokens,
      })),
      comparisons: result.comparisons,
    },
    null,
    2,
  ),
);
