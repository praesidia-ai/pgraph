import type { GraphNode } from "@praesidia/pgraph-ir";
export type TaskStrategy =
  "locate" | "impact" | "debug" | "change" | "architecture" | "tests";
export interface RankingWeights {
  name: number;
  path: number;
  signature: number;
  proximity: number;
  entry: number;
  tests: number;
  public: number;
  concept: number;
  git: number;
}
export const defaultWeights: RankingWeights = {
  name: 0.38,
  path: 0.12,
  signature: 0.1,
  proximity: 0.18,
  entry: 0.06,
  tests: 0.06,
  public: 0.03,
  concept: 0.05,
  git: 0.02,
};
export function classifyTask(task: string): TaskStrategy {
  if (/\b(test|tests|coverage)\b/i.test(task)) return "tests";
  if (/\b(impact|rename|refactor|type|break)\b/i.test(task)) return "impact";
  if (/\b(why|bug|fail|fails|debug|error)\b/i.test(task)) return "debug";
  if (/\b(architecture|flow|explain|overview)\b/i.test(task))
    return "architecture";
  if (/\b(where|find|locate)\b/i.test(task)) return "locate";
  return "change";
}
export interface RankingSignals {
  terms: string[];
  distance?: number;
  semantic?: number;
  git?: number;
  strategy: TaskStrategy;
}
export function rank(
  node: GraphNode,
  signals: RankingSignals,
  weights: RankingWeights = defaultWeights,
): number {
  const overlap = (text: string): number =>
    signals.terms.filter((t) => text.toLowerCase().includes(t)).length /
    Math.max(1, signals.terms.length);
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (!sum) return 0;
  const values: RankingWeights = {
    name: overlap(node.qualifiedName),
    path: overlap(node.location?.file ?? ""),
    signature: overlap(node.signature ?? ""),
    proximity: signals.distance === undefined ? 0 : 1 / (signals.distance + 1),
    entry: node.metadata.entryPoint ? 1 : 0,
    tests: node.kind === "test" ? (signals.strategy === "tests" ? 1 : 0.5) : 0,
    public: node.metadata.exported ? 1 : 0,
    concept: signals.semantic ?? 0,
    git: signals.git ?? 0,
  };
  return Number(
    Math.max(
      0,
      Math.min(
        1,
        Object.entries(weights).reduce(
          (acc, [key, value]) =>
            acc + value * values[key as keyof RankingWeights],
          0,
        ) / sum,
      ),
    ).toFixed(4),
  );
}
