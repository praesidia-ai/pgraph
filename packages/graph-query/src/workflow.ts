import { isAbsolute, relative } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bounded, hash, readLocal } from "@praesidia/pgraph-shared";
import type { GraphQuery } from "./index.js";

function freshSource(graph: GraphQuery, file: string): string {
  const record = graph.store.file(file);
  if (!record) throw new Error("Choose an indexed repository file");
  const source = readLocal(graph.root, file, graph.maxFileBytes);
  if (hash(source) !== record.hash)
    throw new Error(`Stale index for ${file}; reindex first`);
  return source;
}

export function searchText(
  graph: GraphQuery,
  query: string,
  options: {
    scope?: string;
    limit?: number;
    offset?: number;
    caseSensitive?: boolean;
  } = {},
) {
  if (!query.trim() || query.length > 500 || /[\r\n]/.test(query))
    throw new Error("Search for 1–500 characters on one line");
  const limit = bounded(options.limit ?? 20, 1, 100, "limit");
  const offset = bounded(options.offset ?? 0, 0, 100000, "offset");
  const matches: {
    file: string;
    line: number;
    text: string;
    hash: string;
    symbol?: string;
  }[] = [];
  const warnings: string[] = [];
  const needle = options.caseSensitive ? query : query.toLowerCase();
  let scanned = 0,
    bytes = 0,
    found = 0,
    truncated = false;
  for (const record of graph.store
    .files()
    .sort((a, b) => a.path.localeCompare(b.path))) {
    if (
      options.scope &&
      options.scope !== "." &&
      record.path !== options.scope &&
      !record.path.startsWith(options.scope.replace(/\/$/, "") + "/")
    )
      continue;
    if (++scanned > 2000 || (bytes += record.bytes) > 20_000_000) {
      truncated = true;
      break;
    }
    let source: string;
    try {
      source = freshSource(graph, record.path);
    } catch {
      warnings.push(`${record.path}: stale or unreadable; reindex`);
      continue;
    }
    const nodes = graph.store
      .nodesInFile(record.path)
      .filter((n) => !["file", "package"].includes(n.kind))
      .sort(
        (a, b) =>
          a.location!.endOffset -
          a.location!.startOffset -
          (b.location!.endOffset - b.location!.startOffset),
      );
    for (const [i, line] of source.split("\n").entries()) {
      const at = (options.caseSensitive ? line : line.toLowerCase()).indexOf(
        needle,
      );
      if (at < 0) continue;
      if (found++ < offset) continue;
      if (matches.length >= limit) {
        truncated = true;
        break;
      }
      const start = Math.max(0, at - 100);
      matches.push({
        file: record.path,
        line: i + 1,
        text: line.slice(start, start + Math.max(300, query.length + 100)),
        hash: record.hash,
        symbol: nodes.find(
          (n) => n.location!.startLine <= i + 1 && n.location!.endLine >= i + 1,
        )?.id,
      });
    }
    if (truncated) break;
  }
  return {
    query,
    matches,
    scanned: Math.min(scanned, 2000),
    nextOffset:
      truncated && matches.length === limit
        ? offset + matches.length
        : undefined,
    truncated,
    warnings: warnings.slice(0, 20),
    warningsTruncated: warnings.length > 20,
  };
}

export function traceError(graph: GraphQuery, trace: string) {
  if (!trace.trim() || trace.length > 12000)
    throw new Error("Provide a stack trace up to 12000 characters");
  const frames: {
    file: string;
    line: number;
    column?: number;
    symbol?: string;
    source?: string;
    error?: string;
  }[] = [];
  const unresolved: string[] = [];
  for (const line of trace.split("\n").slice(0, 80)) {
    const match =
      /(?:\(|\s|^)((?:file:\/\/\/|\/?)[^()\n]+\.[cm]?[jt]sx?):(\d+)(?::(\d+))?\)?\s*$/.exec(
        line.trim(),
      );
    if (!match) {
      if (line.trim()) unresolved.push(line.slice(0, 300));
      continue;
    }
    let file = match[1]!.trim();
    if (file.startsWith("at ")) file = file.slice(3);
    try {
      if (file.startsWith("file:")) file = fileURLToPath(file);
    } catch {
      unresolved.push(line.slice(0, 300));
      continue;
    }
    if (isAbsolute(file)) {
      try {
        file = realpathSync(file);
      } catch {
        /* Missing locations remain unresolved. */
      }
      file = relative(graph.root, file).replaceAll("\\", "/");
    }
    file = file.replace(/^\.\//, "");
    const frame: (typeof frames)[number] = {
      file,
      line: Number(match[2]),
      column: match[3] ? Number(match[3]) : undefined,
    };
    try {
      const source = freshSource(graph, file);
      const lines = source.split("\n");
      bounded(frame.line, 1, lines.length, "line");
      frame.source = lines[frame.line - 1]!.slice(0, 500);
      try {
        frame.symbol = graph.focus({ file, line: frame.line }).id;
      } catch {
        /* Top-level lines may have no declaration. */
      }
    } catch {
      frame.error = "Unindexed, external, stale or invalid source location";
    }
    frames.push(frame);
    if (frames.length === 20) break;
  }
  return {
    frames,
    unresolved: unresolved.slice(0, 10),
    truncated:
      frames.length === 20 ||
      trace.split("\n").length > 80 ||
      unresolved.length > 10,
    warnings: [
      "Stack frames locate source; they do not establish the root cause. Source maps and external frames are not resolved.",
    ],
  };
}

export function fileOverview(graph: GraphQuery, file: string) {
  freshSource(graph, file);
  const nodes = graph.store.nodesInFile(file);
  const dependencies = new Set<string>();
  let truncated = nodes.length > 300;
  for (const node of nodes.slice(0, 300)) {
    const neighbors = graph.store.neighbors(
      node.id,
      "out",
      ["IMPORTS", "CALLS", "REFERENCES", "DEPENDS_ON"],
      60,
    );
    truncated ||= neighbors.length === 60;
    for (const { node: target } of neighbors)
      if (target.location && target.location.file !== file)
        dependencies.add(target.location.file);
  }
  const dependents = graph.store.dependentFiles(file);
  return {
    file,
    hash: graph.store.file(file)!.hash,
    declarations: nodes
      .filter((n) => !["file", "package"].includes(n.kind))
      .slice(0, 100),
    dependencies: [...dependencies].sort().slice(0, 100),
    dependents: dependents.slice(0, 100),
    truncated:
      truncated ||
      dependencies.size > 100 ||
      dependents.length > 100 ||
      nodes.length > 100,
    warnings: [
      "File relationships use the current index; dynamic and cross-root dependencies may be missing.",
    ],
  };
}

export function dependencyCycles(graph: GraphQuery, scope?: string) {
  const files = graph.store
    .files()
    .filter(
      (f) =>
        f.language !== "json" &&
        (!scope ||
          scope === "." ||
          f.path.startsWith(scope.replace(/\/$/, "") + "/")),
    );
  const selected = files.slice(0, 1000).map((f) => f.path);
  const allowed = new Set(selected),
    edges = new Map<string, string[]>();
  let truncated = files.length > 1000;
  for (const file of selected) {
    const dependencies = graph.store.dependentFiles(file);
    truncated ||= dependencies.length > 200;
    edges.set(
      file,
      dependencies.slice(0, 200).filter((d) => allowed.has(d)),
    );
  }
  // Tarjan SCCs on the reversed file dependency graph; components are unchanged by reversal.
  let serial = 0;
  const indices = new Map<string, number>(),
    lows = new Map<string, number>(),
    stack: string[] = [],
    active = new Set<string>(),
    components: string[][] = [];
  const visit = (file: string): void => {
    indices.set(file, serial);
    lows.set(file, serial++);
    stack.push(file);
    active.add(file);
    for (const target of edges.get(file) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lows.set(file, Math.min(lows.get(file)!, lows.get(target)!));
      } else if (active.has(target))
        lows.set(file, Math.min(lows.get(file)!, indices.get(target)!));
    }
    if (lows.get(file) === indices.get(file)) {
      const component: string[] = [];
      let target: string;
      do {
        target = stack.pop()!;
        active.delete(target);
        component.push(target);
      } while (target !== file);
      if (component.length > 1) components.push(component.sort());
    }
  };
  for (const file of selected) if (!indices.has(file)) visit(file);
  return {
    components: components.sort((a, b) => b.length - a.length).slice(0, 30),
    filesConsidered: selected.length,
    truncated: truncated || components.length > 30,
    warnings: [
      "Dependency components are navigation candidates, not proof of runtime initialization bugs. Query uses the current index.",
    ],
  };
}
