import type { EdgeType, GraphNode, Location, Provenance } from "./index.js";

export interface CommunicationEndpoint {
  id: string;
  protocol: "http" | "service-bus" | "storage-queue" | "event-grid";
  direction: "provide" | "request" | "publish" | "subscribe";
  address?: string;
  setting?: string;
  resource?: string;
  channelKind?: "queue" | "topic";
  method?: string;
  location: Location;
  symbolId: string;
  provenance: Provenance;
}
export interface ServiceDefinition {
  name: string;
  path: string;
  origins: string[];
  urls: Record<string, string>;
  resources: Record<string, string>;
}
export interface ExplorerNode {
  id: string;
  label: string;
  kind: string;
  rootId: string;
  scope?: string;
  symbolId?: string;
  location?: Location;
  detail: string;
}
export interface ExplorerEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  evidence: string;
  confidence: number;
  detail: string;
  sources: {
    rootId: string;
    symbolId: string;
    location: Location;
    hash?: string;
  }[];
}
export interface ExplorerGraph {
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
  revisions: Record<string, number>;
  truncated: boolean;
  warnings: string[];
}
export interface RepositoryTopology {
  rootId: string;
  name: string;
  revision: number;
  services: ServiceDefinition[];
  endpoints: CommunicationEndpoint[];
  truncated: boolean;
  warnings: string[];
}
export interface RelationshipOptions {
  symbol?: string;
  query?: string;
  scope?: string;
  direction?: "in" | "out" | "both";
  types?: EdgeType[];
  depth?: number;
  maxNodes?: number;
  maxEdges?: number;
}
export function explorerNode(node: GraphNode, rootId: string): ExplorerNode {
  return {
    id: JSON.stringify([rootId, node.id]),
    label: node.qualifiedName.slice(0, 200),
    kind: node.kind,
    rootId,
    symbolId: node.id,
    location: node.location,
    detail: `${node.signature?.slice(0, 1000) ?? node.kind}\n${node.provenance.source}: ${node.provenance.evidence}`,
  };
}
