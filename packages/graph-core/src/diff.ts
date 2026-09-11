import { readChangeHunks, type DiffOptions } from "@praesidia/pgraph-git";
import { hash, readLocal } from "@praesidia/pgraph-shared";
import type { PGraph } from "./index.js";
import type { GraphNode } from "@praesidia/pgraph-ir";
export type { DiffOptions } from "@praesidia/pgraph-git";

export function changedDeclarations(graph: PGraph, options: DiffOptions = {}) {
  const diff = readChangeHunks(
    graph.root,
    options,
    new Set(graph.store.files().map((file) => file.path)),
  );
  const declarations: {
    node: GraphNode;
    change: "added-file" | "modified";
    hunks: number[];
  }[] = [];
  const unknown: { file: string; reason: string }[] = [];
  const files = diff.files.map(({ snapshotSource, ...file }) => {
    try {
      const record = graph.store.file(file.file);
      if (file.status === "D")
        throw new Error(
          "Deleted file: historical symbols and consumers require a baseline graph",
        );
      if (file.unknown) throw new Error(file.unknown);
      if (!record)
        throw new Error(
          "Not indexed; source/configuration impact remains unknown",
        );
      if (
        hash(readLocal(graph.root, file.file, graph.maxFileBytes)) !==
        record.hash
      )
        throw new Error("Stale index; reindex first");
      if (snapshotSource !== undefined && hash(snapshotSource) !== record.hash)
        throw new Error(
          "Selected Git snapshot differs from indexed working source; declarations are not mapped",
        );
      const nodes = graph.store
        .nodesInFile(file.file)
        .filter((n) => n.location && !["file", "package"].includes(n.kind));
      const selected = new Map<string, { node: GraphNode; hunks: number[] }>();
      if (file.status === "?" || file.status === "A")
        for (const node of nodes) selected.set(node.id, { node, hunks: [] });
      else
        for (const [i, hunk] of file.hunks.entries()) {
          const end = hunk.newStart + Math.max(1, hunk.newCount) - 1;
          const candidates = nodes.filter((n) =>
            hunk.newCount
              ? n.location!.startLine <= end &&
                n.location!.endLine >= hunk.newStart
              : n.location!.startLine < hunk.newStart &&
                n.location!.endLine > hunk.newStart,
          );
          const smallest = candidates.filter(
            (n) =>
              !candidates.some(
                (child) =>
                  child.id !== n.id &&
                  child.location!.startOffset > n.location!.startOffset &&
                  child.location!.endOffset < n.location!.endOffset &&
                  child.location!.startLine <= hunk.newStart &&
                  child.location!.endLine >= end,
              ),
          );
          if (!smallest.length || !hunk.newCount)
            unknown.push({
              file: file.file,
              reason: `Hunk ${i + 1}: removed or top-level text may have consumers absent from the current graph`,
            });
          for (const node of smallest) {
            const item = selected.get(node.id) ?? { node, hunks: [] };
            item.hunks.push(i + 1);
            selected.set(node.id, item);
          }
        }
      if (!nodes.length)
        unknown.push({
          file: file.file,
          reason:
            "No indexed declarations; check configuration/dependency impact",
        });
      for (const { node, hunks } of selected.values())
        declarations.push({
          node,
          hunks,
          change:
            file.status === "A" || file.status === "?"
              ? "added-file"
              : "modified",
        });
    } catch (error) {
      unknown.push({
        file: file.file,
        reason: error instanceof Error ? error.message : "Unknown change",
      });
    }
    return file;
  });
  return {
    base: diff.base,
    head: diff.head,
    mode: diff.mode,
    revision: graph.status().revision,
    totalFiles: diff.totalFiles,
    files,
    declarations: declarations.slice(0, 100),
    unknown: unknown.slice(0, 100),
    truncated:
      diff.truncated || declarations.length > 100 || unknown.length > 100,
    warnings: [
      "Hunk-to-current-declaration mapping, not a semantic contract comparison. Renames/removals and historical consumers may be unknown.",
    ],
  };
}

export function changeTestGaps(graph: PGraph, options: DiffOptions = {}) {
  const changed = changedDeclarations(graph, options);
  const targets = changed.declarations.filter(({ node }) =>
    [
      "function",
      "method",
      "constructor",
      "route",
      "event_handler",
      "queue_handler",
    ].includes(node.kind),
  );
  const rows = targets.slice(0, 30).map(({ node }) => {
    const paths = graph.testPaths(node.id, { depth: 4, limit: 100 });
    return {
      node,
      tests: paths.tests.map((t) => ({
        id: t.node.id,
        name: t.node.name,
        potentialDispatch: t.potentialDispatch,
      })),
      assessment: paths.tests.length
        ? "candidate tests found"
        : paths.truncated
          ? "unknown: traversal limit"
          : "no static test path found",
      truncated: paths.truncated,
    };
  });
  return {
    base: changed.base,
    mode: changed.mode,
    rows,
    unknown: changed.unknown,
    truncated:
      changed.truncated || targets.length > 30 || rows.some((r) => r.truncated),
    warnings: [
      "Static test reachability is not execution coverage. No path does not prove missing tests; candidate tests may not exercise the edited behavior.",
    ],
  };
}
