import type { GraphStore } from "@praesidia/pgraph-store";
import {
  edgeTypes,
  explorerNode,
  type ExplorerGraph,
  type RelationshipOptions,
  type GraphNode,
} from "@praesidia/pgraph-ir";
import { bounded } from "@praesidia/pgraph-shared";

export function relationships(
  store: GraphStore,
  rootId: string,
  options: RelationshipOptions = {},
): ExplorerGraph {
  const maxNodes = bounded(options.maxNodes ?? 100, 1, 200, "maxNodes");
  const maxEdges = bounded(options.maxEdges ?? 400, 1, 800, "maxEdges");
  const depth = bounded(options.depth ?? 1, 0, 4, "depth");
  const direction = options.direction ?? "both";
  if (!["in", "out", "both"].includes(direction))
    throw new Error("Invalid direction");
  if (options.types?.some((type) => !edgeTypes.includes(type)))
    throw new Error("Invalid relationship type");
  if (
    (options.query?.length ?? 0) > 500 ||
    (options.symbol?.length ?? 0) > 2000
  )
    throw new Error("Search too long");
  const seeds = options.symbol
    ? store.resolve(options.symbol)
    : store.search(options.query ?? "", {
        limit: Math.min(20, maxNodes),
        scope: options.scope === "." ? undefined : options.scope,
      });
  if (options.symbol && seeds.length !== 1)
    throw new Error("Select a unique symbol ID");
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, ExplorerGraph["edges"][number]>();
  const queue: { node: GraphNode; depth: number }[] = [];
  let truncated = !options.symbol && seeds.length === Math.min(20, maxNodes);
  for (const node of seeds) {
    nodes.set(node.id, node);
    queue.push({ node, depth: 0 });
  }
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    if (current.depth >= depth) continue;
    for (const dir of direction === "both"
      ? (["in", "out"] as const)
      : [direction]) {
      const neighbors = store.neighbors(
        current.node.id,
        dir,
        options.types?.length ? options.types : undefined,
        500,
      );
      if (neighbors.length === 500) truncated = true;
      for (const { node, edge } of neighbors) {
        const id = JSON.stringify([
          edge.from,
          edge.to,
          edge.type,
          edge.ownerFile,
        ]);
        if (edges.has(id)) continue;
        if (
          edges.size >= maxEdges ||
          (!nodes.has(node.id) && nodes.size >= maxNodes)
        ) {
          truncated = true;
          continue;
        }
        if (!nodes.has(node.id)) {
          nodes.set(node.id, node);
          queue.push({ node, depth: current.depth + 1 });
        }
        const owner = store.file(edge.ownerFile);
        const sourceNode = store.node(edge.from);
        const loc = sourceNode?.location;
        edges.set(id, {
          id,
          from: JSON.stringify([rootId, edge.from]),
          to: JSON.stringify([rootId, edge.to]),
          type: edge.type,
          evidence: edge.evidence,
          confidence: edge.confidence,
          detail: `${edge.source}\n${edge.ownerFile}\n${edge.evidence} evidence`,
          sources:
            loc && loc.file === edge.ownerFile && sourceNode
              ? [
                  {
                    rootId,
                    symbolId: sourceNode.id,
                    location: loc,
                    hash: owner?.hash,
                  },
                ]
              : [],
        });
      }
    }
  }
  return {
    nodes: [...nodes.values()].map((node) => explorerNode(node, rootId)),
    edges: [...edges.values()],
    revisions: { [rootId]: store.stats().revision },
    truncated,
    warnings: [
      "Bounded neighborhood of the last committed index. Reindex after edits.",
    ],
  };
}
