import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { bpeCounter } from "../../packages/graph-context/dist/index.js";
import { startWorker } from "./lib/worker.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const scratch = mkdtempSync(join(tmpdir(), "pgraph-review-limits-"));
const baseline = resolve("artifacts/pgraph-0.5.4.vsix");
const current = resolve("apps/vscode-extension/dist/worker.cjs");
const helpers = (value) =>
  Array.from(
    { length: 120 },
    (_, i) => `export function helper${i}(): number { return ${value}; }`,
  ).join("\n") + "\n";
const initial = {
  ".gitignore": ".pgraph/\n",
  "package.json": '{"name":"historical-review-limits","type":"module"}',
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
  "api.ts":
    helpers(1) +
    "export function removedApi(): number { return 1; }\nexport function contract(value: number): number { return value; }\n",
  "consumer.ts":
    "import {removedApi,contract} from './api.js'; export function consumer(){return contract(removedApi()) + contract(1);}\n",
};
const edited =
  helpers(2) +
  "export function contract(value: string): number { return value.length; }\n";
const expected = [
  "removedApi",
  "contract",
  ...Array.from({ length: 120 }, (_, i) => `helper${i}`),
];
const git = (root, args) =>
  execFileSync(
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
function compile(root) {
  let exitCode = 0,
    diagnostics = "";
  try {
    diagnostics = execFileSync(
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
    exitCode = error.status;
    diagnostics = String(error.stdout ?? error.message);
  }
  return {
    exitCode,
    diagnostics: diagnostics.replaceAll(root, "<fixture>"),
    codes: [
      ...new Set(
        [...diagnostics.matchAll(/TS(\d+):/g)].map((m) => Number(m[1])),
      ),
    ],
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
    editedSource: edited,
    fixtureHash: hash(JSON.stringify({ initial, edited })),
    expectedChanges: expected,
    tokenizer: bpeCounter.name,
    method:
      "Retained 0.5.4 and current workers analyze identical synthetic Git snapshots with 120 body edits, one removal and one signature change. Separate TypeScript noEmit checks the fixture. Record first page, a same-page cached repeat, then every offered continuation until exhaustion. Request/response traffic excludes indexing, discovery, IPC, compiler checks and the duplicate repeat. Baseline and current can return different evidence; no complete-task, runtime-test or paid-token saving is claimed. Timings are one local run, not latency percentiles.",
    runs: [],
  };
  for (const version of ["baseline", "current"]) {
    const root = join(scratch, "fixtures", version);
    mkdirSync(root, { recursive: true });
    for (const [path, source] of Object.entries(initial))
      writeFileSync(join(root, path), source);
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
    if (before.exitCode !== 0) throw Error("Baseline does not compile");
    writeFileSync(join(root, "api.ts"), edited);
    const after = compile(root);
    if (!after.codes.includes(2305) || !after.codes.includes(2345))
      throw Error(
        "Expected missing export and incompatible argument diagnostics",
      );
    active = startWorker(
      version === "baseline"
        ? join(scratch, "baseline/extension/dist/worker.cjs")
        : current,
      root,
    );
    const indexed = await active.call("index");
    const pages = [];
    let input = { action: "change_impact", maxTokens: 2000 },
      repeat;
    for (let i = 0; i < 130; i++) {
      const request = { name: "workflow", input };
      const start = performance.now();
      const text = await active.call("tool", request);
      const elapsedMs = Math.round(performance.now() - start);
      const response = JSON.parse(text);
      if (response.error) throw Error(response.error);
      const tokens = bpeCounter.count(text);
      if (tokens > 2000) throw Error("Output budget exceeded");
      pages.push({
        request,
        response,
        elapsedMs,
        requestTokens: bpeCounter.count(JSON.stringify(request)),
        responseTokens: tokens,
      });
      if (i === 0) {
        const start = performance.now();
        const again = await active.call("tool", request);
        repeat = {
          elapsedMs: Math.round(performance.now() - start),
          identicalResponse: hash(again) === hash(text),
        };
        if (!repeat.identicalResponse)
          throw Error("Same evidence changed on repeat");
      }
      if (response.page?.nextOffset === undefined) break;
      if (response.page.nextOffset <= Number(input.offset ?? 0))
        throw Error("Continuation did not advance");
      if (i && response.page.reviewId !== pages[0].response.page.reviewId)
        throw Error("Mixed review identities");
      input = {
        ...input,
        offset: response.page.nextOffset,
        reviewId: response.page.reviewId,
      };
    }
    const names = pages.flatMap((p) =>
      p.response.changes.map((c) => (c.before ?? c.after).symbol),
    );
    const missing = expected.filter((name) => !names.includes(name));
    const duplicateRows = names.length - new Set(names).size;
    if (version === "current" && (missing.length || duplicateRows))
      throw Error("Continuation lost or duplicated declarations");
    if (
      version === "current" &&
      pages[0].response.changes[0]?.change !== "removed"
    )
      throw Error("Removal was not prioritized");
    report.runs.push({
      version,
      before,
      after,
      indexMs: indexed.durationMs,
      pages,
      repeat,
      returnedUniqueChanges: new Set(names).size,
      missing,
      duplicateRows,
      trafficTokens: pages.reduce(
        (sum, p) => sum + p.requestTokens + p.responseTokens,
        0,
      ),
    });
    await active.close();
    active = undefined;
  }
  writeFileSync(
    process.argv[2] ?? join(tmpdir(), "pgraph-historical-review-limits.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      report.runs.map((run) => ({
        version: run.version,
        pages: run.pages.length,
        firstMs: run.pages[0].elapsedMs,
        repeat: run.repeat,
        firstChanges: run.pages[0].response.changes.map(
          (c) => (c.before ?? c.after).symbol,
        ),
        returnedUniqueChanges: run.returnedUniqueChanges,
        missing: run.missing.length,
        duplicateRows: run.duplicateRows,
        trafficTokens: run.trafficTokens,
      })),
    ),
  );
} finally {
  await active?.close();
  rmSync(scratch, { recursive: true, force: true });
}
