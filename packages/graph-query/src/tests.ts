import { bounded } from "@praesidia/pgraph-shared";
import type { GraphNode, EdgeType } from "@praesidia/pgraph-ir";
import type { GraphQuery } from "./index.js";

export interface TestPath {
  node: GraphNode;
  path: { from: string; to: string; type: EdgeType; direction: "in" | "out" }[];
  potentialDispatch: boolean;
}
export interface TestPathsResult {
  target: GraphNode;
  tests: TestPath[];
  truncated: boolean;
  warnings: string[];
}

export function relatedTestPaths(
  graph: GraphQuery,
  name: string,
  options: { depth?: number; limit?: number } = {},
): TestPathsResult {
  const target = graph.symbol(name);
  const depth = bounded(options.depth ?? 4, 1, 8, "depth");
  const limit = bounded(options.limit ?? 150, 1, 500, "limit");
  const queue: TestPath[] = [
    { node: target, path: [], potentialDispatch: false },
  ];
  const seen = new Map([[target.id, false]]);
  const tests = new Map<string, TestPath>();
  let truncated = false;
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    if (item.node.kind === "test") {
      const prior = tests.get(item.node.id);
      if (!prior || (prior.potentialDispatch && !item.potentialDispatch))
        tests.set(item.node.id, item);
      continue;
    }
    if (item.path.length >= depth) {
      truncated = true;
      continue;
    }
    for (const direction of ["in", "out"] as const) {
      const neighbors = graph.store.neighbors(
        item.node.id,
        direction,
        direction === "in"
          ? ["CALLS", "REFERENCES", "IMPLEMENTS"]
          : ["TESTED_BY", "IMPLEMENTS"],
        60,
      );
      if (neighbors.length === 60) truncated = true;
      for (const { node, edge } of neighbors) {
        const potentialDispatch =
          item.potentialDispatch || edge.type === "IMPLEMENTS";
        const prior = seen.get(node.id);
        if (prior === false || (prior === true && potentialDispatch)) continue;
        if (seen.size >= limit && prior === undefined) {
          truncated = true;
          continue;
        }
        seen.set(node.id, potentialDispatch);
        queue.push({
          node,
          potentialDispatch,
          path: [
            ...item.path,
            { from: item.node.id, to: node.id, type: edge.type, direction },
          ],
        });
      }
    }
  }
  const result = [...tests.values()].sort(
    (a, b) =>
      Number(a.potentialDispatch) - Number(b.potentialDispatch) ||
      a.path.length - b.path.length ||
      a.node.id.localeCompare(b.node.id),
  );
  return {
    target,
    tests: result,
    truncated,
    warnings: [
      "Candidate tests from static paths; execution and coverage are not established.",
      ...(result.some((test) => test.potentialDispatch)
        ? [
            "Interface-member paths describe possible dispatch; runtime receiver identity is unresolved.",
          ]
        : []),
    ],
  };
}
