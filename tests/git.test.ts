import { it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readGitSignals } from "@praesidia/pgraph-git";
it("collects bounded co-change metadata without author identity", () => {
  const root = mkdtempSync(join(tmpdir(), "pgraph-git-"));
  try {
    expect(readGitSignals(root)).toBeUndefined();
    const git = (args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
    git(["init"]);
    writeFileSync(join(root, "a.ts"), "export const a = 1;");
    writeFileSync(join(root, "b.ts"), "export const b = 2;");
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    ]);
    const signals = readGitSignals(root, 2);
    expect(signals?.frequency["a.ts"]).toBe(1);
    expect(signals?.cochange["a.ts"]?.["b.ts"]).toBe(1);
    expect(JSON.stringify(signals)).not.toContain("fixture@example.test");
    expect(() => readGitSignals(root, 0)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
