import { it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  containsPath,
  discoverProjects,
} from "../apps/vscode-extension/src/projects.js";
const roots: string[] = [];
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "pgraph-projects-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it("discovers direct repositories in a container, including worktree markers, without indexing the parent", () => {
  const root = fixture();
  mkdirSync(join(root, "alpha", ".git"), { recursive: true });
  mkdirSync(join(root, "beta"));
  writeFileSync(join(root, "beta", ".git"), "gitdir: /fixture/worktree");
  mkdirSync(join(root, "node_modules", "ignored", ".git"), { recursive: true });
  mkdirSync(join(root, "plain"));
  const result = discoverProjects([{ name: "parent", path: root }]);
  expect(result.projects.map((p) => p.name)).toEqual([
    "parent/alpha",
    "parent/beta",
  ]);
  expect(
    result.projects.every((p) => p.container === root && p.path !== root),
  ).toBe(true);
  expect(result.warnings).toEqual([]);
});
it("preserves one Git monorepo and a plain source folder, and deduplicates repeated roots", () => {
  const root = fixture(),
    plain = fixture();
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "packages", "nested", ".git"), { recursive: true });
  const projects = discoverProjects([
    { name: "mono", path: root },
    { name: "plain", path: plain },
    { name: "duplicate", path: root },
  ]).projects;
  expect(projects.map((p) => p.path)).toEqual([root, plain]);
  expect(containsPath(root, join(root, "src", "file.ts"))).toBe(true);
  expect(containsPath(root, `${root}-sibling`)).toBe(false);
});
it("skips symlinked child repositories and reports discovery limits or missing folders", () => {
  const root = fixture(),
    outside = fixture();
  mkdirSync(join(outside, ".git"));
  symlinkSync(outside, join(root, "linked"), "dir");
  expect(
    discoverProjects([{ name: "parent", path: root }]).projects[0]?.path,
  ).toBe(root);
  for (let i = 0; i < 65; i++)
    mkdirSync(join(root, `repo-${String(i).padStart(2, "0")}`, ".git"), {
      recursive: true,
    });
  const result = discoverProjects([
    { name: "parent", path: root },
    { name: "gone", path: join(root, "missing") },
  ]);
  expect(result.projects).toHaveLength(64);
  expect(result.warnings.join(" ")).toContain("limit");
  expect(result.warnings.join(" ")).toContain("discovery failed");
});
