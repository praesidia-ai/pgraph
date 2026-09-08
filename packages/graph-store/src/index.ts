import type {
  EdgeType,
  FileRecord,
  GraphEdge,
  GraphNode,
  GraphStats,
  IndexResult,
  Neighbor,
  SearchOptions,
  SemanticFact,
} from "@praesidia/pgraph-ir";

export interface GraphStore {
  transaction<T>(work: () => T): T;
  files(): FileRecord[];
  file(path: string): FileRecord | undefined;
  putFile(file: FileRecord): void;
  removeFile(path: string): void;
  removeOwnedEdges(path: string): void;
  pruneNodes(path: string, keepIds: string[]): void;
  putNode(node: GraphNode): void;
  putEdge(edge: GraphEdge): void;
  node(id: string): GraphNode | undefined;
  resolve(name: string, limit?: number): GraphNode[];
  search(query: string, options?: SearchOptions): GraphNode[];
  nodesInFile(path: string): GraphNode[];
  dependentFiles(path: string): string[];
  neighbors(
    id: string,
    direction: "out" | "in",
    types?: EdgeType[],
    limit?: number,
  ): Neighbor[];
  getMeta<T>(key: string): T | undefined;
  setMeta(key: string, value: unknown): void;
  finishRun(result: IndexResult): void;
  stats(): GraphStats;
  putSemantic(fact: SemanticFact): void;
  semantic(symbolId?: string): SemanticFact[];
  invalidateSemantic(paths: string[]): void;
  close(): void;
}
