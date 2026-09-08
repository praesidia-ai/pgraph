import { execFileSync } from "node:child_process";
import { bounded } from "@praesidia/pgraph-shared";

export interface GitSignals {
  head: string;
  frequency: Record<string, number>;
  cochange: Record<string, Record<string, number>>;
  lastCommit: Record<string, string>;
}
/** Read-only Git metadata; no author identity, shell, hooks or repository code. */
export function readGitSignals(
  root: string,
  maxCommits = 100,
): GitSignals | undefined {
  bounded(maxCommits, 1, 1000, "maxCommits");
  try {
    const run = (args: string[]): string =>
      execFileSync("git", ["-c", "core.fsmonitor=false", "-C", root, ...args], {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 8_000_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
    const head = run(["rev-parse", "HEAD"]).trim();
    const log = run([
      "log",
      `-${maxCommits}`,
      "--format=CGCOMMIT:%H",
      "--name-only",
      "--no-renames",
      "--no-ext-diff",
    ]);
    const signals: GitSignals = {
      head,
      frequency: {},
      cochange: {},
      lastCommit: {},
    };
    for (const block of log.split("CGCOMMIT:").slice(1)) {
      const [commit, ...paths] = block.trim().split("\n");
      const files = [...new Set(paths.filter((p) => p && !p.startsWith('"')))];
      for (const file of files) {
        signals.frequency[file] = (signals.frequency[file] ?? 0) + 1;
        signals.lastCommit[file] ??= commit!;
      }
      // Bulk/generated commits are not useful co-change evidence.
      if (files.length > 30) continue;
      for (const a of files)
        for (const b of files)
          if (a !== b) {
            signals.cochange[a] ??= {};
            signals.cochange[a]![b] = (signals.cochange[a]![b] ?? 0) + 1;
          }
    }
    return signals;
  } catch {
    return undefined;
  }
}
