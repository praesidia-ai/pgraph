import { hash, bounded, readLocal } from "@praesidia/pgraph-shared";
import {
  EXTRACTION_VERSION,
  type GraphNode,
  type EdgeType,
  type RepositoryTopology,
} from "@praesidia/pgraph-ir";
import { composeWorkspace } from "@praesidia/pgraph-query";
import type { PGraph } from "./index.js";

export interface WorkspaceImpactProject {
  project: string;
  name: string;
  graph?: PGraph;
  error?: string;
}
export interface WorkspaceImpactSymbol {
  key: string;
  project: string;
  symbol: string;
  name: string;
  kind: string;
  file: string;
  line: number;
  hash: string;
}
export interface WorkspaceImpactStep {
  from: string;
  to: string;
  type: string;
  direction: "in" | "out";
  evidence: string;
  sources: { project: string; file: string; line: number; hash: string }[];
  detail?: string;
}
export interface WorkspaceImpactPath {
  direction: "upstream callers/publishers" | "downstream candidates";
  bridges: number;
  steps: WorkspaceImpactStep[];
}
export interface WorkspaceImpactResult {
  analysis: "workspace-static-impact";
  origin: string;
  projects: {
    project: string;
    name: string;
    revision?: number;
    fingerprint?: string;
    observedAt?: string;
    error?: string;
  }[];
  symbols: WorkspaceImpactSymbol[];
  paths: WorkspaceImpactPath[];
  tests: {
    target: string;
    test: string;
    steps: WorkspaceImpactStep[];
    potentialDispatch: boolean;
  }[];
  unknown: { project: string; reason: string }[];
  truncated: boolean;
  warnings: string[];
}
type Mode = "dependents" | "callees";

/** Read-only candidate paths across explicitly supplied roots; no service calls or model calls. */
export function workspaceImpact(
  projects: readonly WorkspaceImpactProject[],
  options: { project: string; symbol: string; depth?: number },
): WorkspaceImpactResult {
  if (
    !projects.length ||
    projects.length > 64 ||
    new Set(projects.map((p) => p.project)).size !== projects.length
  )
    throw new Error("Workspace impact needs 1–64 unique projects");
  const depth = bounded(options.depth ?? 3, 1, 4, "workspace depth");
  const graphs = new Map<string, PGraph>();
  const topologies: RepositoryTopology[] = [];
  const metadata: WorkspaceImpactResult["projects"] = [];
  const unknown: WorkspaceImpactResult["unknown"] = [];
  let truncated = false;
  const note = (project: string, reason: string) => {
    if (
      !unknown.some(
        (item) => item.project === project && item.reason === reason,
      )
    ) {
      if (unknown.length < 40) unknown.push({ project, reason });
      else truncated = true;
    }
  };
  for (const item of projects) {
    if (
      !/^[a-f0-9]{24}$/.test(item.project) ||
      (item.graph && hash(item.graph.root).slice(0, 24) !== item.project)
    )
      throw new Error("Workspace project identity does not match its graph");
    const state: WorkspaceImpactResult["projects"][number] = {
      project: item.project,
      name: item.name.slice(0, 200),
    };
    metadata.push(state);
    try {
      const graph = item.graph;
      if (!graph) throw new Error(item.error ?? "Project index unavailable");
      if (
        !graph.status().revision ||
        graph.store.getMeta("retrievalVersion") !== EXTRACTION_VERSION
      )
        throw new Error(
          "Index this project with the current PGraph extraction before workspace impact",
        );
      const health = graph.health();
      if (!health.current)
        throw new Error(
          "Project index is stale; reindex before workspace impact",
        );
      Object.assign(state, {
        revision: graph.status().revision,
        fingerprint: health.fingerprint,
        observedAt: new Date().toISOString(),
      });
      graphs.set(item.project, graph);
      const topology = graph.topology();
      topologies.push(topology);
      truncated ||= topology.truncated;
      for (const warning of topology.warnings) note(item.project, warning);
      const declarations = topology.endpoints.filter(
        (e) => !e.execution?.symbols.length,
      ).length;
      if (declarations)
        note(
          item.project,
          `${declarations} communication sites lack a linked operation/handler; configuration alone is not an execution path`,
        );
    } catch (error) {
      graphs.delete(item.project);
      state.error = (
        error instanceof Error ? error.message : "Project query failed"
      ).slice(0, 300);
    }
  }
  const originGraph = graphs.get(options.project);
  if (!originGraph)
    throw new Error(
      metadata.find((p) => p.project === options.project)?.error ??
        "Choose an open origin project",
    );
  const target = originGraph.symbol(options.symbol);
  if (
    !target.location ||
    ["file", "package", "repository", "directory"].includes(target.kind)
  )
    throw new Error(
      "Choose an indexed declaration as the workspace impact origin",
    );
  const symbols = new Map<string, WorkspaceImpactSymbol>();
  const verified = new Map<string, string>();
  const key = (project: string, symbol: string) =>
    JSON.stringify([project, symbol]);
  const source = (project: string, file: string, line: number) => {
    const id = key(project, file);
    let digest = verified.get(id);
    if (!digest) {
      const graph = graphs.get(project)!;
      const record = graph.store.file(file);
      if (
        !record ||
        hash(readLocal(graph.root, file, graph.maxFileBytes)) !== record.hash
      )
        throw new Error(
          "Workspace source changed during impact analysis; reindex and retry",
        );
      digest = record.hash;
      verified.set(id, digest);
    }
    return { project, file, line, hash: digest };
  };
  const intern = (project: string, node: GraphNode): string => {
    const id = key(project, node.id);
    const existing = symbols.get(id);
    if (existing) return existing.key;
    if (!node.location)
      throw new Error("Workspace path has no indexed source location");
    const location = source(
      project,
      node.location.file,
      node.location.startLine,
    );
    if (
      node.provenance.sourceHash &&
      location.hash !== node.provenance.sourceHash
    )
      throw new Error(
        "Workspace symbol source identity changed; reindex and retry",
      );
    const handle = `s${symbols.size}`;
    symbols.set(id, {
      key: handle,
      symbol: node.id,
      name: node.qualifiedName,
      kind: node.kind,
      ...location,
    });
    return handle;
  };
  const origin = intern(options.project, target);
  type Local = { node: GraphNode; steps: WorkspaceImpactStep[]; leaf: boolean };
  const trace = (project: string, start: GraphNode, mode: Mode): Local[] => {
    const graph = graphs.get(project)!;
    const result: Local[] = [{ node: start, steps: [], leaf: true }];
    const seen = new Set([start.id]);
    for (let i = 0; i < result.length; i++) {
      const item = result[i]!;
      if (item.steps.length >= depth) {
        truncated = true;
        continue;
      }
      const directions: ["in" | "out", EdgeType[]][] =
        mode === "dependents"
          ? [
              [
                "in",
                ["CALLS", "REFERENCES", "ACCEPTS", "RETURNS", "IMPLEMENTS"],
              ],
              ["out", ["IMPLEMENTS"]],
            ]
          : [
              ["out", ["CALLS"]],
              ["in", ["IMPLEMENTS"]],
            ];
      if (
        !item.steps.length &&
        ["class", "service", "controller", "interface"].includes(item.node.kind)
      )
        directions.push(["out", ["CONTAINS"]]);
      for (const [direction, types] of directions) {
        const neighbors = graph.store.neighbors(
          item.node.id,
          direction,
          types,
          60,
        );
        if (neighbors.length === 60) truncated = true;
        for (const { node, edge } of neighbors) {
          if (
            !node.location ||
            [
              "file",
              "package",
              "repository",
              "variable",
              "constant",
              "test",
            ].includes(node.kind)
          )
            continue;
          if (seen.has(node.id)) continue;
          if (result.length >= 80) {
            truncated = true;
            continue;
          }
          item.leaf = false;
          seen.add(node.id);
          const evidence = source(
            project,
            edge.ownerFile,
            Number(edge.metadata.line) ||
              graph.store.node(edge.from)?.location?.startLine ||
              1,
          );
          if (edge.sourceHash && edge.sourceHash !== evidence.hash)
            throw new Error(
              "Workspace edge source identity changed; reindex and retry",
            );
          result.push({
            node,
            leaf: true,
            steps: [
              ...item.steps,
              {
                from: intern(project, item.node),
                to: intern(project, node),
                type: edge.type,
                direction,
                evidence:
                  edge.type === "IMPLEMENTS"
                    ? "possible interface dispatch"
                    : edge.evidence,
                sources: [evidence],
              },
            ],
          });
        }
      }
    }
    return result;
  };
  type Frontier = {
    project: string;
    node: GraphNode;
    mode: Mode;
    steps: WorkspaceImpactStep[];
    bridges: number;
    used: Set<string>;
  };
  const queue: Frontier[] = ["dependents", "callees"].map((mode) => ({
    project: options.project,
    node: target,
    mode: mode as Mode,
    steps: [],
    bridges: 0,
    used: new Set(),
  }));
  const paths: WorkspaceImpactPath[] = [];
  const tests: WorkspaceImpactResult["tests"] = [];
  const tested = new Set<string>();
  const pathKeys = new Set<string>();
  const pathId = (steps: WorkspaceImpactStep[]) =>
    JSON.stringify(
      steps.map((step) => [
        step.from,
        step.to,
        step.type,
        step.direction,
        step.sources,
      ]),
    );
  const rememberPath = (item: Frontier, local: Local) => {
    const steps = [...item.steps, ...local.steps];
    const signature = pathId(steps);
    if (!pathKeys.has(signature)) {
      pathKeys.add(signature);
      if (paths.length < 24)
        paths.push({
          direction:
            item.mode === "dependents"
              ? "upstream callers/publishers"
              : "downstream candidates",
          bridges: item.bridges,
          steps,
        });
      else truncated = true;
    }
  };
  for (let q = 0; q < queue.length; q++) {
    const item = queue[q]!;
    const graph = graphs.get(item.project)!;
    const local = trace(item.project, item.node, item.mode);
    if (item.bridges) {
      const leaves = local.filter((p) => p.leaf);
      for (const leaf of leaves.slice(0, 6)) rememberPath(item, leaf);
      if (leaves.length > 6) truncated = true;
    }
    const testKey = key(item.project, item.node.id);
    if (!tested.has(testKey) && tested.size < 12) {
      tested.add(testKey);
      const candidates = graph.testPaths(item.node.id, { depth: 3, limit: 60 });
      truncated ||= candidates.truncated || candidates.tests.length > 3;
      for (const candidate of candidates.tests.slice(0, 3)) {
        const steps: WorkspaceImpactStep[] = [];
        for (const edge of candidate.path) {
          const from = graph.store.node(edge.from),
            to = graph.store.node(edge.to);
          if (!from?.location || !to?.location) continue;
          const owner = edge.direction === "out" ? from : to;
          steps.push({
            from: intern(item.project, from),
            to: intern(item.project, to),
            type: edge.type,
            direction: edge.direction,
            evidence:
              edge.type === "IMPLEMENTS"
                ? "possible interface dispatch"
                : "static test candidate",
            sources: [
              source(
                item.project,
                owner.location!.file,
                owner.location!.startLine,
              ),
            ],
          });
        }
        tests.push({
          target: intern(item.project, item.node),
          test: intern(item.project, candidate.node),
          steps,
          potentialDispatch: candidate.potentialDispatch,
        });
      }
    }
    const topology = topologies.find((t) => t.rootId === item.project)!;
    const owners = new Map(local.map((path) => [path.node.id, path]));
    const reachable = topology.endpoints.filter((endpoint) =>
      endpoint.execution?.symbols.some((id) => owners.has(id)),
    );
    if (item.bridges >= 2) {
      if (
        reachable.some(
          (endpoint) =>
            ["request", "publish"].includes(endpoint.direction) &&
            endpoint.execution?.kind === "call",
        )
      ) {
        truncated = true;
        note(
          item.project,
          "Further communication boundaries may exist beyond the two-boundary limit",
        );
      }
      continue;
    }
    for (const direction of ["out", "in"] as const) {
      if (direction === "in" && item.mode !== "dependents") continue;
      const selected = reachable.filter((endpoint) =>
        direction === "out"
          ? ["request", "publish"].includes(endpoint.direction) &&
            endpoint.execution?.kind === "call"
          : ["provide", "subscribe"].includes(endpoint.direction) &&
            endpoint.execution?.kind === "handler",
      );
      if (!selected.length) continue;
      const ids = new Set(selected.map((endpoint) => endpoint.id));
      const snapshots = topologies.map((snapshot) => ({
        ...snapshot,
        endpoints: snapshot.endpoints.filter((endpoint) => {
          const outgoing = ["request", "publish"].includes(endpoint.direction);
          if (outgoing && endpoint.execution?.kind !== "call") return false;
          return (direction === "out" ? outgoing : !outgoing)
            ? snapshot.rootId === item.project && ids.has(endpoint.id)
            : true;
        }),
      }));
      const matches = composeWorkspace(snapshots, {
        omitUnresolved: direction === "in",
      });
      truncated ||= matches.truncated;
      for (const edge of matches.edges) {
        const bridge = edge.communication;
        if (!bridge) continue;
        const reached = direction === "out" ? bridge.from : bridge.to;
        const other = direction === "out" ? bridge.to : bridge.from;
        if (
          !reached ||
          reached.project !== item.project ||
          !ids.has(reached.endpoint)
        )
          continue;
        const endpoint = selected.find(
          (point) => point.id === reached.endpoint,
        )!;
        if (!other) {
          note(
            item.project,
            `${endpoint.protocol} destination unresolved at ${endpoint.location.file}:${endpoint.location.startLine}`,
          );
          continue;
        }
        const destination = topologies
          .find((t) => t.rootId === other.project)
          ?.endpoints.find((e) => e.id === other.endpoint);
        if (!destination?.execution?.symbols.length) {
          note(
            other.project,
            `Matched ${endpoint.protocol} boundary has no indexed execution handler/operation`,
          );
          continue;
        }
        if (destination.execution.unresolved)
          note(other.project, destination.execution.unresolved);
        if (item.used.has(edge.id)) continue;
        const otherGraph = graphs.get(other.project)!;
        for (const fromId of endpoint.execution!.symbols.filter((id) =>
          owners.has(id),
        ))
          for (const toId of destination.execution.symbols) {
            const next = otherGraph.store.node(toId);
            if (!next?.location) {
              note(
                other.project,
                "Matched handler is not present in this project's index",
              );
              continue;
            }
            const localPath = owners.get(fromId)!;
            const step: WorkspaceImpactStep = {
              from: intern(item.project, localPath.node),
              to: intern(other.project, next),
              type: endpoint.protocol,
              direction,
              evidence: edge.evidence,
              detail: edge.detail,
              sources: edge.sources.map((s) => {
                const evidence = source(
                  s.rootId,
                  s.location.file,
                  s.location.startLine,
                );
                if (s.hash && s.hash !== evidence.hash)
                  throw new Error(
                    "Communication source identity changed; reindex and retry",
                  );
                return evidence;
              }),
            };
            const nextSteps = [...item.steps, ...localPath.steps, step];
            const signature = pathId(nextSteps);
            if (queue.some((entry) => pathId(entry.steps) === signature))
              continue;
            if (queue.length >= 24) {
              truncated = true;
              continue;
            }
            queue.push({
              project: other.project,
              node: next,
              mode: direction === "out" ? "callees" : "dependents",
              steps: nextSteps,
              bridges: item.bridges + 1,
              used: new Set([...item.used, edge.id]),
            });
          }
      }
    }
  }
  // Per-project snapshots are observed sequentially. Discard paths through any root
  // that changed, retaining usable evidence from the other roots as partial output.
  for (const state of metadata) {
    const graph = graphs.get(state.project);
    if (!graph) continue;
    try {
      const health = graph.health();
      if (
        !health.current ||
        health.fingerprint !== state.fingerprint ||
        graph.status().revision !== state.revision
      )
        state.error =
          "Project changed during workspace impact; reindex and retry";
    } catch {
      state.error =
        "Project inputs became unavailable during workspace impact; reindex and retry";
    }
  }
  const failed = new Set(metadata.filter((p) => p.error).map((p) => p.project));
  if (failed.has(options.project))
    throw new Error(
      "Origin project changed during workspace impact; reindex and retry",
    );
  const byHandle = new Map(
    [...symbols.values()].map((node) => [node.key, node]),
  );
  const valid = (steps: WorkspaceImpactStep[]) =>
    steps.every(
      (step) =>
        !failed.has(byHandle.get(step.from)!.project) &&
        !failed.has(byHandle.get(step.to)!.project),
    );
  const keptPaths = paths.filter((path) => valid(path.steps));
  const keptTests = tests.filter(
    (test) =>
      !failed.has(byHandle.get(test.target)!.project) && valid(test.steps),
  );
  truncated ||= failed.size > 0;
  const used = new Set([
    origin,
    ...keptPaths.flatMap((p) => p.steps.flatMap((s) => [s.from, s.to])),
    ...keptTests.flatMap((t) => [
      t.target,
      t.test,
      ...t.steps.flatMap((s) => [s.from, s.to]),
    ]),
  ]);
  return {
    analysis: "workspace-static-impact",
    origin,
    projects: metadata,
    symbols: [...symbols.values()].filter((node) => used.has(node.key)),
    paths: keptPaths,
    tests: keptTests,
    unknown,
    truncated,
    warnings: [
      "Potential impact paths from static calls/references and explicit communication mappings. No payload/type compatibility, runtime delivery, ordering or test coverage is established.",
      "Per-project snapshots are observed separately, not atomically. Dynamic clients, callbacks, registration overrides, deployment rewrites and unindexed services can hide or change paths.",
      "Traversal keeps upstream dependencies separate from downstream callees; up to two communication boundaries and bounded local depth. Reverse messaging paths identify producer review candidates, not a return channel. Inspect unknowns, failed projects and truncation before choosing checks.",
    ],
  };
}
