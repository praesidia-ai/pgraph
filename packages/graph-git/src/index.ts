import { execFileSync } from "node:child_process";
import { bounded, hash } from "@praesidia/pgraph-shared";

export interface GitSignals {
  head: string;
  frequency: Record<string, number>;
  cochange: Record<string, Record<string, number>>;
  lastCommit: Record<string, string>;
}
export interface GitChange {
  file: string;
  status: string;
}
export interface DiffOptions {
  mode?: "working" | "staged" | "branch";
  base?: string;
  maxFiles?: number;
  file?: string;
}
function gitReader(root: string, maxBuffer: number) {
  return (args: string[]): string => {
    try {
      return execFileSync(
        "git",
        [
          "--literal-pathspecs",
          "-c",
          "core.fsmonitor=false",
          "-C",
          root,
          ...args,
        ],
        {
          encoding: "utf8",
          timeout: 5000,
          maxBuffer,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            GIT_NO_LAZY_FETCH: "1",
            GIT_TERMINAL_PROMPT: "0",
          },
        },
      );
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        stderr?: string | Buffer;
      };
      const detail = String(failure.stderr ?? "");
      if (failure.code === "ENOENT")
        throw new Error(
          "Git is unavailable. Install Git or make it available to the editor; source indexing and search do not require Git.",
        );
      if (/not a git repository/i.test(detail))
        throw new Error(
          "This folder is not a Git repository. For a parent folder containing repositories, choose PGraph: Choose Scope and select Workspace or a child project. Source indexing and search still work without Git.",
        );
      if (/dubious ownership/i.test(detail))
        throw new Error(
          "Git rejected this repository's ownership. Check the folder's ownership and your Git configuration before reviewing changes.",
        );
      throw new Error(
        `Git could not read ${args[0] ?? "repository metadata"}. Check the repository and selected reference in Git; the command may have exceeded its time or output limit.`,
      );
    }
  };
}
function requireHead(run: (args: string[]) => string): string {
  if (run(["rev-parse", "--is-inside-work-tree"]).trim() !== "true")
    throw new Error(
      "Change review requires a Git working tree, not a bare repository.",
    );
  try {
    return run(["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  } catch {
    throw new Error(
      "Git HEAD cannot be resolved. This repository may not have an initial commit. Check Git status and create the initial commit when ready; source indexing and search remain available.",
    );
  }
}
export function readChangeHunks(
  root: string,
  options: DiffOptions = {},
  sourceFiles?: ReadonlySet<string>,
) {
  const mode = options.mode ?? "working";
  if (!["working", "staged", "branch"].includes(mode))
    throw new Error("Invalid diff mode");
  const maxFiles = bounded(options.maxFiles ?? 30, 1, 100, "maxFiles");
  if (
    options.file &&
    (!options.file ||
      options.file.includes("\0") ||
      options.file.startsWith("/") ||
      options.file.includes("\\") ||
      options.file.split("/").some((part) => part === ".." || part === "."))
  )
    throw new Error("file must be a repository-relative path");
  const run = gitReader(root, 4_000_000);
  const head = requireHead(run);
  if (
    options.base &&
    (!/^[A-Za-z0-9_./~^@{}-]{1,200}$/.test(options.base) ||
      options.base.startsWith("-"))
  )
    throw new Error("Invalid base reference");
  if (mode === "branch" && !options.base)
    throw new Error("Branch comparison requires an explicit base reference");
  let base = options.base
    ? run([
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${options.base}^{commit}`,
      ]).trim()
    : head;
  if (mode === "branch") base = run(["merge-base", base, head]).trim();
  const prefix = run(["rev-parse", "--show-prefix"]).trim();
  const range =
    mode === "branch"
      ? [base, head]
      : mode === "staged"
        ? ["--cached", base]
        : [base];
  const flags = [
    "--relative",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
  ];
  const tokens = run([
    "diff",
    ...flags,
    "--name-status",
    "-z",
    ...range,
    "--",
    ".",
  ]).split("\0");
  const changed = new Map<string, string>();
  for (let i = 0; i + 1 < tokens.length; i += 2)
    if (tokens[i + 1]) changed.set(tokens[i + 1]!, tokens[i]!);
  if (mode === "working")
    for (const file of run([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
    ]).split("\0"))
      if (file) changed.set(file, "?");
  const files: {
    file: string;
    status: string;
    hunks: {
      oldStart: number;
      oldCount: number;
      newStart: number;
      newCount: number;
    }[];
    snapshotSource?: string;
    unknown?: string;
  }[] = [];
  const started = Date.now();
  for (const [file, status] of [...changed]
    .filter(([file]) => !options.file || file === options.file)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, maxFiles)) {
    const entry: (typeof files)[number] = { file, status, hunks: [] };
    files.push(entry);
    if (sourceFiles && !sourceFiles.has(file)) {
      entry.unknown =
        "Not indexed; source/configuration impact remains unknown";
      continue;
    }
    if (Date.now() - started > 10000) {
      entry.unknown = "Diff time limit reached";
      continue;
    }
    if (status === "?") continue;
    try {
      const diff = run(["diff", ...flags, "--unified=0", ...range, "--", file]);
      for (const match of diff.matchAll(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm,
      ))
        entry.hunks.push({
          oldStart: Number(match[1]),
          oldCount: Number(match[2] ?? 1),
          newStart: Number(match[3]),
          newCount: Number(match[4] ?? 1),
        });
      if (mode !== "working" && status !== "D")
        entry.snapshotSource = run([
          "show",
          mode === "staged" ? `:${prefix}${file}` : `${head}:${prefix}${file}`,
        ]);
      if (!entry.hunks.length)
        entry.unknown =
          "No textual hunks; binary, mode-only or unsupported change";
    } catch {
      entry.unknown = "Diff or snapshot exceeds limits or cannot be read";
    }
  }
  return {
    head,
    base,
    mode,
    files,
    totalFiles: options.file ? Number(changed.has(options.file)) : changed.size,
    truncated:
      (!options.file && changed.size > maxFiles) ||
      files.some((f) => f.unknown?.includes("limit")),
  };
}

export interface GitSnapshotFile {
  path: string;
  oid: string;
  source: string;
}
export function gitSnapshotIdentity(root: string, revision: string): string {
  if (revision !== "index" && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision))
    throw new Error("Snapshot requires a resolved commit or index");
  return hash(
    gitReader(
      root,
      8_000_000,
    )(
      revision === "index"
        ? ["ls-files", "--stage", "-z", "--", "."]
        : ["ls-tree", "-r", "-z", "--full-name", revision, "--", "."],
    ),
  );
}
/** Immutable Git blobs, without checkout, filters, hooks, or repository execution. */
export function readGitSnapshot(
  root: string,
  revision: string,
  accept: (path: string) => boolean,
  limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number },
) {
  if (revision !== "index" && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision))
    throw new Error("Snapshot requires a resolved commit or index");
  bounded(limits.maxFiles, 1, 5000, "snapshot.maxFiles");
  bounded(limits.maxFileBytes, 1, 10_000_000, "snapshot.maxFileBytes");
  bounded(limits.maxTotalBytes, 1, 100_000_000, "snapshot.maxTotalBytes");
  const run = gitReader(root, 8_000_000);
  const prefix = run(["rev-parse", "--show-prefix"]).trim();
  const listing =
    revision === "index"
      ? run(["ls-files", "--stage", "-z", "--", "."])
      : run(["ls-tree", "-r", "-z", "--full-name", revision, "--", "."]);
  const entries: { path: string; oid: string }[] = [];
  const warnings: string[] = [];
  for (const entry of listing.split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    if (tab < 0) throw new Error("Invalid Git snapshot listing");
    const fields = entry.slice(0, tab).split(" ");
    const rawPath = entry.slice(tab + 1);
    // ls-files is relative to -C; ls-tree --full-name is relative to the Git root.
    if (revision !== "index" && !rawPath.startsWith(prefix))
      throw new Error("Snapshot path is outside the selected project");
    const path = revision === "index" ? rawPath : rawPath.slice(prefix.length);
    if (
      !path ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.includes(":") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Unsupported Git snapshot path");
    if (
      process.platform === "win32" &&
      path
        .split("/")
        .some((part) =>
          /[. ]$|[<>"|?*]|^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(
            part,
          ),
        )
    )
      throw new Error(
        "Git snapshot path cannot be represented safely on Windows",
      );
    if (!accept(path)) continue;
    const mode = fields[0];
    if (revision === "index" && fields[2] !== "0")
      throw new Error("Staged snapshot has unresolved merge conflicts");
    if (mode !== "100644" && mode !== "100755") {
      if (warnings.length < 20)
        warnings.push(`${path}: link or submodule excluded`);
      continue;
    }
    const oid = fields[revision === "index" ? 1 : 2]!;
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid))
      throw new Error("Invalid Git object identity");
    entries.push({ path, oid });
    if (entries.length > limits.maxFiles)
      throw new Error(
        `Historical snapshot exceeds its ${limits.maxFiles}-file limit`,
      );
  }
  const oids = [...new Set(entries.map((entry) => entry.oid))];
  const identity = hash(listing);
  if (!oids.length)
    return {
      revision,
      identity,
      files: [] as GitSnapshotFile[],
      warnings,
      bytes: 0,
    };
  const batch = (argument: string, maxBuffer: number): Buffer => {
    try {
      return execFileSync(
        "git",
        [
          "--literal-pathspecs",
          "-c",
          "core.fsmonitor=false",
          "-C",
          root,
          "cat-file",
          argument,
        ],
        {
          input: oids.join("\n") + "\n",
          timeout: 15000,
          maxBuffer,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            GIT_NO_LAZY_FETCH: "1",
            GIT_TERMINAL_PROMPT: "0",
          },
        },
      );
    } catch {
      throw new Error(
        "Git snapshot blobs are unavailable or exceed read limits",
      );
    }
  };
  const info = batch("--batch-check", oids.length * 150 + 100)
    .toString("utf8")
    .trim()
    .split("\n");
  if (info.length !== oids.length)
    throw new Error("Incomplete Git snapshot object metadata");
  const sizes = new Map<string, number>();
  for (const [i, line] of info.entries()) {
    const [oid, type, length] = line.split(" ");
    const size = Number(length);
    if (
      oid !== oids[i] ||
      type !== "blob" ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > limits.maxFileBytes
    )
      throw new Error(
        "Historical snapshot contains a missing or oversized source/configuration blob",
      );
    sizes.set(oid!, size);
  }
  const total = entries.reduce((sum, entry) => sum + sizes.get(entry.oid)!, 0);
  if (total > limits.maxTotalBytes)
    throw new Error("Historical snapshot exceeds its byte limit");
  const buffer = batch("--batch", total + oids.length * 150 + 100);
  const blobs = new Map<string, string>();
  let offset = 0;
  for (const oid of oids) {
    const end = buffer.indexOf(10, offset);
    const header = buffer.subarray(offset, end).toString("utf8");
    const size = sizes.get(oid)!;
    if (
      end < offset ||
      header !== `${oid} blob ${size}` ||
      buffer[end + size + 1] !== 10
    )
      throw new Error("Incomplete Git snapshot blob");
    const source = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(buffer.subarray(end + 1, end + size + 1));
    if (source.includes("\0"))
      throw new Error("Historical source/configuration is not supported text");
    blobs.set(oid, source);
    offset = end + size + 2;
  }
  if (offset !== buffer.length)
    throw new Error("Unexpected Git snapshot bytes");
  return {
    revision,
    identity,
    bytes: total,
    warnings,
    files: entries.map((entry) => ({
      ...entry,
      source: blobs.get(entry.oid)!,
    })),
  };
}
/** Combined staged/unstaged changes against HEAD, plus untracked non-ignored files. */
export function readChangedFiles(
  root: string,
  maxFiles = 30,
): {
  head: string;
  files: GitChange[];
  totalFiles: number;
  truncated: boolean;
} {
  bounded(maxFiles, 1, 100, "maxFiles");
  const run = gitReader(root, 2_000_000);
  const head = requireHead(run);
  const entries = run([
    "diff",
    "--relative",
    "--name-status",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    head,
    "--",
    ".",
  ]).split("\0");
  const files = new Map<string, GitChange>();
  for (let i = 0; i + 1 < entries.length; i += 2) {
    const file = entries[i + 1]!;
    if (file) files.set(file, { file, status: entries[i]! });
  }
  for (const file of run([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ".",
  ]).split("\0"))
    if (file) files.set(file, { file, status: "?" });
  const sorted = [...files.values()].sort((a, b) =>
    a.file.localeCompare(b.file),
  );
  return {
    head,
    totalFiles: sorted.length,
    files: sorted.slice(0, maxFiles),
    truncated: sorted.length > maxFiles,
  };
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
