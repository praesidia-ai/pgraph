import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  readChangeHunks,
  readGitSnapshot,
  gitSnapshotIdentity,
  type DiffOptions,
} from "@praesidia/pgraph-git";
import { GraphIndexer, snapshotInput } from "@praesidia/pgraph-indexer";
import { SqliteGraphStore } from "@praesidia/pgraph-store-sqlite";
import { GraphQuery } from "@praesidia/pgraph-query";
import { declarationShapes } from "@praesidia/pgraph-typescript";
import {
  hash,
  bounded,
  loadConfig,
  readLocal,
  type Config,
} from "@praesidia/pgraph-shared";
import type { GraphNode, EdgeType } from "@praesidia/pgraph-ir";
import type { PGraph } from "./index.js";

type Shape = { hash: string; renamed?: string; header?: string };
type View = {
  query: GraphQuery;
  shape(node: GraphNode): Shape;
  files: Set<string>;
  warnings: string[];
  identity?: string;
  dispose(): void;
};
function view(
  query: GraphQuery,
  warnings: string[],
  dispose: () => void,
): View {
  const shapes = new Map<string, ReturnType<typeof declarationShapes>>();
  const sources = new Map<string, string>();
  return {
    query,
    files: new Set(query.store.files().map((file) => file.path)),
    warnings,
    dispose,
    shape(node) {
      const loc = node.location!;
      let entries = shapes.get(loc.file);
      if (!entries) {
        const source = readLocal(query.root, loc.file, query.maxFileBytes);
        if (hash(source) !== query.store.file(loc.file)?.hash)
          throw new Error(`Snapshot changed: ${loc.file}`);
        entries = declarationShapes(loc.file, source);
        shapes.set(loc.file, entries);
        sources.set(loc.file, source);
      }
      return (
        entries.get(`${loc.startOffset}:${loc.endOffset}`) ?? {
          hash: hash(
            sources.get(loc.file)!.slice(loc.startOffset, loc.endOffset),
          ),
        }
      );
    },
  };
}
function historicalView(graph: PGraph, revision: string, policy: Config): View {
  const limits = {
    maxFiles: Math.min(5000, policy.limits.maxFiles),
    maxFileBytes: policy.limits.maxFileBytes,
    maxTotalBytes: Math.min(100_000_000, policy.limits.maxTotalBytes),
  };
  const snapshot = readGitSnapshot(graph.root, revision, snapshotInput, limits);
  const root = mkdtempSync(join(tmpdir(), "pgraph-history-"));
  const store = new SqliteGraphStore(":memory:");
  try {
    for (const file of snapshot.files) {
      mkdirSync(dirname(join(root, file.path)), { recursive: true });
      writeFileSync(join(root, file.path), file.source, {
        mode: 0o600,
        flag: "wx",
      });
    }
    const config = loadConfig(root);
    config.limits = limits;
    config.include = policy.include;
    config.exclude = [...new Set([...config.exclude, ...policy.exclude])];
    const indexing = new GraphIndexer(root, store, config).index();
    const result = view(
      new GraphQuery(store, root, limits.maxFileBytes),
      [
        ...snapshot.warnings,
        ...indexing.diagnostics.slice(0, 20),
        ...(indexing.diagnostics.length > 20
          ? [`${indexing.diagnostics.length} diagnostics; first 20 shown`]
          : []),
      ],
      () => {
        store.close();
        rmSync(root, { recursive: true, force: true });
      },
    );
    result.identity = snapshot.identity;
    return result;
  } catch (error) {
    store.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
const relevant = (node: GraphNode) =>
  node.location &&
  ([
    "function",
    "method",
    "constructor",
    "class",
    "service",
    "controller",
    "interface",
    "type",
    "enum",
    "route",
    "event_handler",
    "queue_handler",
  ].includes(node.kind) ||
    (["constant", "variable"].includes(node.kind) &&
      node.metadata.exported === true) ||
    (node.kind === "property" && node.visibility !== "private"));
const containers = new Set(["class", "service", "controller"]);
const identity = (node: GraphNode) =>
  `${node.location!.file}:${node.qualifiedName}`;

export interface HistoricalChange {
  change:
    | "added"
    | "removed"
    | "modified"
    | "signature"
    | "move-candidate"
    | "rename-candidate";
  before?: GraphNode;
  after?: GraphNode;
  beforeHash?: string;
  afterHash?: string;
  reasons: string[];
  renderedSignatureChanged?: boolean;
  consumers: {
    node: GraphNode;
    snapshot: "before" | "after" | "both";
    path: {
      symbol: string;
      at: string;
      edge?: EdgeType;
      direction?: "in" | "out";
    }[];
    potentialDispatch: boolean;
    afterState?: "same source" | "changed source" | "absent or unresolved";
  }[];
  truncated: boolean;
}
interface SnapshotReference {
  kind: "commit" | "index" | "working";
  commit?: string;
  revision?: number;
  identity?: string;
}
export interface HistoricalResult {
  analysis: "git-snapshot-declarations";
  mode: "working" | "staged" | "branch";
  base: string;
  head: string;
  revision: number;
  policyHash: string;
  before: SnapshotReference;
  after: SnapshotReference;
  totalFiles: number;
  filesSelected: number;
  page: {
    reviewId: string;
    offset: number;
    returned: number;
    total: number;
    nextOffset?: number;
  };
  counts: Partial<Record<HistoricalChange["change"], number>>;
  changes: HistoricalChange[];
  unknown: { file: string; reason: string }[];
  truncated: boolean;
  warnings: string[];
}
export interface HistoricalOptions extends DiffOptions {
  offset?: number;
  reviewId?: string;
}
const cache = new WeakMap<PGraph, { key: string; result: HistoricalResult }>();
function consumers(
  target: GraphNode,
  origin: View,
  after: View,
  snapshot: "before" | "after",
) {
  type Entry = {
    node: GraphNode;
    path: HistoricalChange["consumers"][number]["path"];
    potentialDispatch: boolean;
  };
  const step = (
    node: GraphNode,
    edge?: EdgeType,
    direction?: "in" | "out",
  ) => ({
    symbol: node.qualifiedName,
    at: `${node.location?.file ?? "?"}:${node.location?.startLine ?? 0}`,
    ...(edge ? { edge, direction } : {}),
  });
  const queue: Entry[] = [
    { node: target, path: [step(target)], potentialDispatch: false },
  ];
  const seen = new Set([target.id]);
  const result: HistoricalChange["consumers"] = [];
  let truncated = false;
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    if (item.path.length > 3) {
      truncated = true;
      continue;
    }
    for (const direction of ["in", "out"] as const) {
      const neighbors = origin.query.store.neighbors(
        item.node.id,
        direction,
        direction === "in"
          ? [
              "CALLS",
              "REFERENCES",
              "IMPORTS",
              "EXPORTS",
              "DEPENDS_ON",
              "ACCEPTS",
              "RETURNS",
              "EXTENDS",
              "IMPLEMENTS",
            ]
          : ["TESTED_BY", "IMPLEMENTS"],
        60,
      );
      if (neighbors.length === 60) truncated = true;
      for (const { node, edge } of neighbors) {
        if (seen.has(node.id)) continue;
        if (seen.size >= 60) {
          truncated = true;
          continue;
        }
        seen.add(node.id);
        const next = {
          node,
          path: [...item.path, step(node, edge.type, direction)],
          potentialDispatch:
            item.potentialDispatch || edge.type === "IMPLEMENTS",
        };
        queue.push(next);
        if (
          !node.location ||
          ["file", "package", "variable", "constant"].includes(node.kind)
        )
          continue;
        if (result.length >= 8) {
          truncated = true;
          continue;
        }
        const counterpart = after.query.store.node(node.id);
        result.push({
          ...next,
          snapshot,
          ...(snapshot === "before"
            ? {
                afterState: counterpart?.location
                  ? after.shape(counterpart).hash === origin.shape(node).hash
                    ? ("same source" as const)
                    : ("changed source" as const)
                  : ("absent or unresolved" as const),
              }
            : {}),
        });
      }
    }
  }
  return { result, truncated };
}

/** Compare actual selected snapshots; historical locations never masquerade as working source. */
export function historicalChanges(
  graph: PGraph,
  options: HistoricalOptions = {},
): HistoricalResult {
  const offset = bounded(options.offset ?? 0, 0, 5000, "offset");
  if (offset && !options.reviewId)
    throw new Error(
      "Continue a historical review with its reviewId and nextOffset",
    );
  const diff = readChangeHunks(graph.root, options);
  const revision = graph.status().revision;
  const policy = loadConfig(graph.root);
  const health = diff.mode === "working" ? graph.health() : undefined;
  if (health && !health.current)
    throw new Error(
      "Working index is stale; reindex before historical change review",
    );
  const initialBefore = gitSnapshotIdentity(graph.root, diff.base);
  const afterRevision = diff.mode === "staged" ? "index" : diff.head;
  const initialAfter =
    diff.mode === "working"
      ? health!.fingerprint
      : gitSnapshotIdentity(graph.root, afterRevision);
  const key = hash(
    JSON.stringify({
      diff,
      revision,
      policy,
      initialBefore,
      initialAfter,
      selection: { file: options.file, maxFiles: options.maxFiles ?? 30 },
    }),
  );
  if (options.reviewId && options.reviewId !== key)
    throw new Error(
      "Historical review inputs changed; restart from offset 0 without reviewId",
    );
  const pageKey = `${key}:${offset}`;
  const retained = cache.get(graph);
  if (retained?.key === pageKey) return structuredClone(retained.result);
  const warnings = [
    "Static within-project evidence, not proof of breakage, runtime dispatch or test coverage. Signature text changes are not a type-compatibility check.",
    "Git snapshots use supported tracked source/configuration, without installed dependencies or external project sources. Exclusions, unresolved references and dynamic consumers can hide impact.",
  ];
  if (!diff.files.length) {
    if (offset)
      throw new Error("Historical review offset exceeds the compared changes");
    return {
      analysis: "git-snapshot-declarations",
      mode: diff.mode,
      base: diff.base,
      head: diff.head,
      revision,
      policyHash: hash(JSON.stringify(policy)),
      before: { kind: "commit", commit: diff.base, identity: initialBefore },
      after:
        diff.mode === "working"
          ? { kind: "working", revision, identity: initialAfter }
          : diff.mode === "staged"
            ? { kind: "index", identity: initialAfter }
            : { kind: "commit", commit: diff.head, identity: initialAfter },
      totalFiles: diff.totalFiles,
      filesSelected: diff.files.length,
      page: { reviewId: key, offset, returned: 0, total: 0 },
      counts: {},
      changes: [],
      unknown: [],
      truncated: diff.truncated,
      warnings,
    };
  }
  const unknown: { file: string; reason: string }[] = [];
  let before: View | undefined, after: View | undefined;
  const workingFingerprint = health?.fingerprint;
  const changes: HistoricalChange[] = [];
  type Candidate = Pick<
    HistoricalChange,
    "before" | "after" | "change" | "reasons"
  >;
  const candidates: Candidate[] = [];
  const counts: HistoricalResult["counts"] = {};
  let truncated = diff.truncated;
  try {
    before = historicalView(graph, diff.base, policy);
    if (diff.mode === "working") {
      after = view(graph, [], () => {});
    } else after = historicalView(graph, afterRevision, policy);
    if (
      before.identity !== initialBefore ||
      (diff.mode !== "working" && after.identity !== initialAfter)
    )
      throw new Error("Git snapshot changed before historical analysis; retry");
    warnings.push(
      ...before.warnings.map((w) => `Before: ${w}`),
      ...after.warnings.map((w) => `After: ${w}`),
    );
    const oldNodes: GraphNode[] = [],
      newNodes: GraphNode[] = [];
    for (const file of diff.files) {
      if (
        (file.status !== "A" &&
          file.status !== "?" &&
          !before.files.has(file.file)) ||
        (file.status !== "D" && !after.files.has(file.file))
      ) {
        unknown.push({
          file: file.file,
          reason:
            "Source is unsupported, excluded or absent from an indexed snapshot",
        });
        continue;
      }
      // A parser recovery must not masquerade as the removal of a declaration.
      const old = before.query.store.nodesInFile(file.file).filter(relevant);
      const next = after.query.store.nodesInFile(file.file).filter(relevant);
      if (!old.length && !next.length)
        unknown.push({
          file: file.file,
          reason:
            "No supported declarations; configuration, imports or module initialization may still affect consumers",
        });
      if (oldNodes.length + newNodes.length + old.length + next.length > 5000) {
        truncated = true;
        unknown.push({
          file: file.file,
          reason:
            "Declaration comparison limit reached; request this file separately",
        });
        continue;
      }
      try {
        for (const [selected, nodes] of [
          [before, old],
          [after, next],
        ] as const) {
          if (!selected.files.has(file.file)) continue;
          const fileNode = selected.query.store
            .nodesInFile(file.file)
            .find((node) => node.kind === "file");
          if (fileNode) selected.shape(fileNode);
          for (const node of nodes) selected.shape(node);
        }
      } catch (error) {
        unknown.push({
          file: file.file,
          reason:
            error instanceof Error
              ? error.message
              : "Declaration syntax cannot be verified",
        });
        continue;
      }
      oldNodes.push(...old);
      newNodes.push(...next);
      const covered = (nodes: GraphNode[], start: number, count: number) => {
        if (!count) return true;
        let cursor = start;
        for (const node of [...nodes].sort(
          (a, b) => a.location!.startLine - b.location!.startLine,
        )) {
          if (node.location!.endLine < cursor) continue;
          if (node.location!.startLine > cursor) return false;
          cursor = node.location!.endLine + 1;
          if (cursor > start + count - 1) return true;
        }
        return false;
      };
      if (
        file.hunks.some(
          (hunk) =>
            !covered(old, hunk.oldStart, hunk.oldCount) ||
            !covered(next, hunk.newStart, hunk.newCount),
        )
      )
        unknown.push({
          file: file.file,
          reason:
            "Changed text extends outside modeled declarations; imports/module effects require wider checks",
        });
      if (file.unknown) unknown.push({ file: file.file, reason: file.unknown });
    }
    const added = new Set(newNodes),
      removed = new Set(oldNodes);
    const add = (
      old: GraphNode | undefined,
      next: GraphNode | undefined,
      change: HistoricalChange["change"],
      reasons: string[],
    ) => {
      candidates.push({ before: old, after: next, change, reasons });
    };
    const expand = ({
      before: old,
      after: next,
      change,
      reasons,
    }: Candidate) => {
      const prior = old ? consumers(old, before!, after!, "before") : undefined;
      const following = next
        ? consumers(next, after!, after!, "after")
        : undefined;
      const evidence = prior?.result ?? [];
      for (const consumer of following?.result ?? []) {
        const same = evidence.find(
          (item) =>
            item.node.id === consumer.node.id &&
            item.node.signature === consumer.node.signature &&
            item.node.provenance.sourceHash ===
              consumer.node.provenance.sourceHash &&
            item.potentialDispatch === consumer.potentialDispatch &&
            JSON.stringify(item.path) === JSON.stringify(consumer.path),
        );
        if (same) same.snapshot = "both";
        else evidence.push(consumer);
      }
      const bounded = !!prior?.truncated || !!following?.truncated;
      changes.push({
        change,
        before: old,
        after: next,
        reasons,
        ...(old && next && old.signature !== next.signature
          ? { renderedSignatureChanged: true }
          : {}),
        beforeHash: old?.provenance.sourceHash,
        afterHash: next?.provenance.sourceHash,
        consumers: evidence,
        truncated: bounded,
      });
      truncated ||= bounded;
    };
    const groupByIdentity = (nodes: GraphNode[]) => {
      const groups = new Map<string, GraphNode[]>();
      for (const node of nodes) {
        const key = identity(node);
        const group = groups.get(key) ?? [];
        group.push(node);
        groups.set(key, group);
      }
      return groups;
    };
    const oldGroups = groupByIdentity(oldNodes),
      newGroups = groupByIdentity(newNodes);
    for (const old of oldNodes) {
      const same = newGroups.get(identity(old)) ?? [];
      const group = oldGroups.get(identity(old))!;
      if (!same.length) continue;
      if (same.length !== 1 || group.length !== 1) {
        removed.delete(old);
        same.forEach((node) => added.delete(node));
        unknown.push({
          file: old.location!.file,
          reason: `Ambiguous overloaded/duplicate declaration: ${old.qualifiedName}`,
        });
        continue;
      }
      const next = same[0]!;
      removed.delete(old);
      added.delete(next);
      const oldShape = before.shape(old),
        nextShape = after.shape(next);
      const contractChanged =
        old.kind !== next.kind ||
        old.visibility !== next.visibility ||
        old.metadata.exported !== next.metadata.exported ||
        oldShape.header !== nextShape.header;
      if (contractChanged)
        add(old, next, "signature", [
          "Declared header, visibility, export flag or declaration kind changed; compatibility requires verification",
        ]);
      else if (oldShape.hash !== nextShape.hash) {
        if (!containers.has(old.kind))
          add(old, next, "modified", [
            "Declaration source changed",
            ...(old.signature !== next.signature
              ? [
                  "Compiler-rendered signatures differ; inference and dependency environments may contribute",
                ]
              : []),
          ]);
        else if (
          !oldNodes.some(
            (child) =>
              child !== old &&
              child.location!.file === old.location!.file &&
              child.qualifiedName.startsWith(`${old.qualifiedName}.`) &&
              (!newGroups.has(identity(child)) ||
                before!.shape(child).hash !==
                  after!.shape(newGroups.get(identity(child))![0]!).hash),
          )
        )
          unknown.push({
            file: old.location!.file,
            reason: `${old.qualifiedName}: container source changed outside matched child declarations; inspect static initialization and other class effects`,
          });
      }
    }
    for (const old of [...removed]) {
      const shape = before.shape(old);
      const candidates = [...added].filter(
        (node) =>
          node.kind === old.kind &&
          (after!.shape(node).hash === shape.hash ||
            (shape.renamed && after!.shape(node).renamed === shape.renamed)),
      );
      if (candidates.length !== 1) continue;
      const next = candidates[0]!;
      const competing = [...removed].filter(
        (node) =>
          node.kind === next.kind &&
          (before!.shape(node).hash === after!.shape(next).hash ||
            (after!.shape(next).renamed &&
              before!.shape(node).renamed === after!.shape(next).renamed)),
      );
      if (competing.length !== 1) continue;
      removed.delete(old);
      added.delete(next);
      const exact = shape.hash === after.shape(next).hash;
      add(old, next, exact ? "move-candidate" : "rename-candidate", [
        exact
          ? "Unique unchanged declaration among changed locations; inferred move pairing, not proven identity or import compatibility"
          : "Unique source match after replacing only the declaration name; inferred pairing, not proven rename identity",
      ]);
    }
    for (const old of removed)
      add(old, undefined, "removed", [
        "Declaration absent at its previous path/name in the selected after snapshot",
      ]);
    for (const next of added)
      add(undefined, next, "added", [
        "Declaration absent at its new path/name in the selected before snapshot",
      ]);
    // Classify all compared declarations before applying the page/consumer limit.
    // Otherwise early body edits can hide later removals and signature changes.
    const order = {
      removed: 0,
      signature: 1,
      "rename-candidate": 2,
      "move-candidate": 2,
      modified: 3,
      added: 4,
    };
    candidates.sort(
      (a, b) =>
        order[a.change] - order[b.change] ||
        (a.before?.id ?? a.after!.id).localeCompare(
          b.before?.id ?? b.after!.id,
        ),
    );
    for (const item of candidates)
      counts[item.change] = (counts[item.change] ?? 0) + 1;
    if (offset > candidates.length)
      throw new Error("Historical review offset exceeds the compared changes");
    for (const candidate of candidates.slice(offset, offset + 100))
      expand(candidate);
    // Re-read mutable selections so an edit/index update during analysis is never silently mixed in.
    if (diff.mode === "working") {
      const health = graph.health();
      if (
        !health.current ||
        health.fingerprint !== workingFingerprint ||
        graph.status().revision !== revision
      )
        throw new Error(
          "Working source/index changed during historical review; reindex and retry",
        );
    }
    if (
      gitSnapshotIdentity(graph.root, diff.base) !== initialBefore ||
      (diff.mode !== "working" &&
        gitSnapshotIdentity(graph.root, afterRevision) !== initialAfter)
    )
      throw new Error("Git snapshot changed during historical review; retry");
    if (JSON.stringify(loadConfig(graph.root)) !== JSON.stringify(policy))
      throw new Error(
        "Project configuration changed during historical review; retry",
      );
    const now = readChangeHunks(graph.root, options);
    if (JSON.stringify(now) !== JSON.stringify(diff))
      throw new Error("Git selection changed during historical review; retry");
  } finally {
    before?.dispose();
    after?.dispose();
  }
  const result: HistoricalResult = {
    analysis: "git-snapshot-declarations",
    mode: diff.mode,
    base: diff.base,
    head: diff.head,
    revision,
    policyHash: hash(JSON.stringify(policy)),
    before: { kind: "commit", commit: diff.base, identity: before?.identity },
    after:
      diff.mode === "working"
        ? { kind: "working", revision, identity: workingFingerprint }
        : diff.mode === "staged"
          ? { kind: "index", identity: after?.identity }
          : { kind: "commit", commit: diff.head, identity: after?.identity },
    totalFiles: diff.totalFiles,
    filesSelected: diff.files.length,
    page: {
      reviewId: key,
      offset,
      returned: changes.length,
      total: candidates.length,
      ...(offset + changes.length < candidates.length
        ? { nextOffset: offset + changes.length }
        : {}),
    },
    counts,
    changes,
    unknown: unknown.slice(0, 100),
    truncated:
      truncated ||
      unknown.length > 100 ||
      offset + changes.length < candidates.length,
    warnings: [...new Set(warnings)].slice(0, 45),
  };
  cache.set(graph, { key: pageKey, result: structuredClone(result) });
  return result;
}
