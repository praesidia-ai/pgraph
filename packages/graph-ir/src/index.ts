export const nodeKinds = [
  "repository",
  "package",
  "directory",
  "file",
  "module",
  "namespace",
  "class",
  "interface",
  "type",
  "enum",
  "function",
  "method",
  "constructor",
  "property",
  "variable",
  "constant",
  "route",
  "controller",
  "service",
  "repository_class",
  "database_model",
  "database_table",
  "test",
  "event",
  "event_handler",
  "queue",
  "queue_handler",
  "configuration",
  "feature",
  "concept",
] as const;
export type NodeKind = (typeof nodeKinds)[number];
export const edgeTypes = [
  "CONTAINS",
  "IMPORTS",
  "EXPORTS",
  "REFERENCES",
  "CALLS",
  "CALLED_BY",
  "IMPLEMENTS",
  "EXTENDS",
  "RETURNS",
  "ACCEPTS",
  "READS",
  "WRITES",
  "TESTED_BY",
  "ROUTED_FROM",
  "DEPENDS_ON",
  "CONFIGURED_BY",
  "EMITS",
  "CONSUMES",
  "HANDLES",
  "CREATES",
  "UPDATES",
  "DELETES",
  "BELONGS_TO_FEATURE",
  "BELONGS_TO_CONCEPT",
] as const;
export type EdgeType = (typeof edgeTypes)[number];
export type Metadata = Record<string, unknown>;
export interface Provenance {
  source: string;
  confidence: number;
  evidence: "deterministic" | "heuristic" | "semantic";
  sourceHash?: string;
}
/** Lines are one-based, offsets UTF-16, endOffset exclusive. */
export interface Location {
  file: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}
export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  qualifiedName: string;
  language: string;
  location?: Location;
  signature?: string;
  visibility?: "public" | "protected" | "private";
  metadata: Metadata;
  provenance: Provenance;
}
export interface GraphEdge extends Provenance {
  from: string;
  to: string;
  type: EdgeType;
  ownerFile: string;
  metadata: Metadata;
}
export interface FileRecord {
  path: string;
  hash: string;
  language: string;
  bytes: number;
  lines: number;
  indexedAt: string;
}
export interface ParsedFile {
  file: FileRecord;
  nodes: GraphNode[];
  edges: GraphEdge[];
  diagnostics: string[];
}
export interface IndexProgress {
  phase: "discover" | "analyze" | "persist" | "complete";
  message: string;
  completed?: number;
  total?: number;
}
export interface IndexOptions {
  rebuild?: boolean;
  onProgress?: (progress: IndexProgress) => void;
}
export interface IndexResult {
  files: number;
  parsed: number;
  skipped: number;
  deleted: number;
  nodes: number;
  edges: number;
  durationMs: number;
  revision: number;
  diagnostics: string[];
}
export interface GraphStats {
  files: number;
  nodes: number;
  edges: number;
  revision: number;
  lastIndex?: IndexResult;
}
export interface Neighbor {
  node: GraphNode;
  edge: GraphEdge;
}
export interface SearchOptions {
  limit?: number;
  offset?: number;
  scope?: string;
  kind?: NodeKind;
}
export interface SemanticFact extends Provenance {
  id: string;
  symbolId: string;
  summary: string;
  concepts: string[];
  constraints: string[];
  hashes: Record<string, string>;
  createdAt: string;
}
export interface LanguageAdapter {
  readonly name: string;
  readonly extensions: readonly string[];
  parse(
    root: string,
    files: FileRecord[],
    changed: Set<string>,
    onProgress?: (progress: IndexProgress) => void,
  ): ParsedFile[];
}
export function symbolId(
  language: string,
  file: string,
  qualifiedName: string,
): string {
  return `${language}:${file.replaceAll("\\", "/")}:${qualifiedName}`;
}
export const compilerProvenance: Provenance = {
  source: "typescript-compiler",
  confidence: 1,
  evidence: "deterministic",
};
export * from "./explorer.js";
