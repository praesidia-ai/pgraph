import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { discover } from "@praesidia/pgraph-indexer";
import { EXTRACTION_VERSION } from "@praesidia/pgraph-ir";
import { hash, loadConfig, readLocal } from "@praesidia/pgraph-shared";
import type { PGraph } from "./index.js";

export function repositoryHealth(graph: PGraph) {
  const current = discover(graph.root, loadConfig(graph.root));
  const files = [...current.sources, ...current.manifests].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  const stored = new Map(
    graph.store.files().map((file) => [file.path, file.hash]),
  );
  const changed = files
    .filter((file) => stored.get(file.path) !== file.hash)
    .map((file) => ({
      file: file.path,
      reason: stored.has(file.path) ? "modified" : "new",
    }));
  const paths = new Set(files.map((file) => file.path));
  for (const file of stored.keys())
    if (!paths.has(file)) changed.push({ file, reason: "deleted or excluded" });
  const configChanged =
    graph.store.getMeta("configHash") !== current.configHash;
  const extractionChanged =
    graph.store.getMeta("retrievalVersion") !== EXTRACTION_VERSION;
  return {
    revision: graph.status().revision,
    current:
      !!graph.status().revision &&
      !changed.length &&
      !configChanged &&
      !extractionChanged,
    fingerprint: hash(
      current.configHash +
        files.map((file) => `${file.path}:${file.hash}`).join("\n"),
    ),
    filesChecked: files.length,
    changed: changed.slice(0, 100),
    configChanged,
    extractionChanged,
    diagnostics: current.diagnostics.slice(0, 20),
    truncated: changed.length > 100 || current.diagnostics.length > 20,
    scope:
      "Supported non-excluded source, package manifests and indexed configuration; external dependencies, environment and other assets are outside this fingerprint.",
    next: !graph.status().revision
      ? "Index Repository"
      : changed.length || configChanged || extractionChanged
        ? "Reindex Changed Files"
        : "Open a task or review changes",
  };
}

export interface RepositoryCheck {
  id: string;
  file: string;
  cwd: string;
  script: string;
  body: string;
  manager: "npm" | "pnpm" | "yarn" | "bun";
  kind: string;
  manifestHash: string;
}
export function repositoryChecks(graph: PGraph) {
  const checks: RepositoryCheck[] = [],
    warnings: string[] = [];
  const manifests = graph.store
    .files()
    .filter((file) => /(^|\/)package\.json$/.test(file.path));
  let defaultManager: RepositoryCheck["manager"] = "npm";
  try {
    const root = JSON.parse(
      readLocal(graph.root, "package.json", graph.maxFileBytes),
    );
    const m = /^(npm|pnpm|yarn|bun)@/.exec(String(root.packageManager));
    if (m) defaultManager = m[1] as RepositoryCheck["manager"];
    else if (existsSync(join(graph.root, "pnpm-lock.yaml")))
      defaultManager = "pnpm";
    else if (existsSync(join(graph.root, "yarn.lock"))) defaultManager = "yarn";
    else if (existsSync(join(graph.root, "bun.lock"))) defaultManager = "bun";
  } catch {
    /* A root manifest is optional. */
  }
  for (const file of manifests.slice(0, 100)) {
    try {
      const source = readLocal(graph.root, file.path, graph.maxFileBytes);
      if (hash(source) !== file.hash) {
        warnings.push(`${file.path}: stale; reindex before running checks`);
        continue;
      }
      const pkg = JSON.parse(source);
      const selected = /^(npm|pnpm|yarn|bun)@/.exec(String(pkg.packageManager));
      const manager = selected
        ? (selected[1] as RepositoryCheck["manager"])
        : defaultManager;
      for (const [script, body] of Object.entries(pkg.scripts ?? {})) {
        if (
          !/^(?:test|check|typecheck|lint|build)(?::[\w.-]+)?$/.test(script) ||
          typeof body !== "string" ||
          body.length > 2000
        )
          continue;
        checks.push({
          id: `${file.path}#${script}`,
          file: file.path,
          cwd: dirname(file.path).replaceAll("\\", "/"),
          script,
          body,
          manager,
          kind: script.split(":")[0]!,
          manifestHash: file.hash,
        });
      }
    } catch {
      warnings.push(`${file.path}: cannot read supported package scripts`);
    }
  }
  return {
    checks: checks.slice(0, 100),
    warnings,
    truncated: checks.length > 100 || manifests.length > 100,
    note: "Discovered repository scripts, not a minimal or complete verification plan. Selecting Run executes that script and package-manager lifecycle hooks; no script runs during discovery.",
  };
}

export interface VerificationRecord {
  id: string;
  check: RepositoryCheck;
  fingerprint: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  result: "passed" | "failed" | "cancelled";
  inputsChangedDuringRun: boolean;
}
export class VerificationSession {
  private pending = new Map<
    string,
    { check: RepositoryCheck; fingerprint: string; startedAt: string }
  >();
  constructor(private readonly graph: PGraph) {}
  begin(checkId: string) {
    const check = repositoryChecks(this.graph).checks.find(
      (c) => c.id === checkId,
    );
    if (!check) throw new Error("Choose a current discovered check");
    const health = repositoryHealth(this.graph);
    if (!health.current)
      throw new Error("Reindex before running a recorded check");
    if (this.pending.size >= 8)
      throw new Error("Finish or cancel an active check first");
    const id = randomUUID();
    this.pending.set(id, {
      check,
      fingerprint: health.fingerprint,
      startedAt: new Date().toISOString(),
    });
    const npmCli = join(
      dirname(dirname(process.execPath)),
      "lib/node_modules/npm/bin/npm-cli.js",
    );
    const useCli = check.manager === "npm" && existsSync(npmCli);
    return {
      id,
      check,
      executable: useCli ? process.execPath : check.manager,
      args: [...(useCli ? [npmCli] : []), "run", check.script],
      cwd: join(this.graph.root, check.cwd),
    };
  }
  finish(id: string, exitCode: number | null) {
    const pending = this.pending.get(id);
    if (!pending)
      throw new Error(
        "Unknown check run; a restarted worker cannot attest its result",
      );
    if (
      exitCode !== null &&
      (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 2147483647)
    )
      throw new Error("Invalid exit code");
    this.pending.delete(id);
    let inputsChangedDuringRun = true;
    try {
      inputsChangedDuringRun =
        repositoryHealth(this.graph).fingerprint !== pending.fingerprint;
    } catch {
      /* Unknown freshness is never a current pass. */
    }
    const record: VerificationRecord = {
      id,
      ...pending,
      finishedAt: new Date().toISOString(),
      exitCode,
      result:
        exitCode === null ? "cancelled" : exitCode === 0 ? "passed" : "failed",
      inputsChangedDuringRun,
    };
    const prior =
      this.graph.store.getMeta<VerificationRecord[]>("verificationRuns") ?? [];
    this.graph.store.setMeta(
      "verificationRuns",
      [record, ...prior].slice(0, 20),
    );
    return record;
  }
  results() {
    const health = repositoryHealth(this.graph);
    const records =
      this.graph.store.getMeta<VerificationRecord[]>("verificationRuns") ?? [];
    return {
      runs: records.map((record) => ({
        ...record,
        freshness:
          record.inputsChangedDuringRun ||
          record.fingerprint !== health.fingerprint
            ? "stale"
            : "tracked inputs current",
      })),
      scope: health.scope,
      warnings: [
        "Exit status records only the selected process result. It does not prove test coverage, CI completeness or correctness; runtime environment and unsupported inputs are not attested.",
      ],
    };
  }
}
