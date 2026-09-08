import { basename, dirname } from "node:path";
import type {
  CommunicationEndpoint,
  FileRecord,
  ParsedFile,
} from "@praesidia/pgraph-ir";

/** Only selected non-secret binding metadata is persisted; scriptFile is never followed. */
export function azureConfiguration(
  file: FileRecord,
  source: string,
): ParsedFile {
  const data = JSON.parse(source) as Record<string, unknown>;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error(`Invalid Azure configuration: ${file.path}`);
  const location = {
    file: file.path,
    startLine: 1,
    endLine: file.lines,
    startOffset: 0,
    endOffset: source.length,
  };
  const provenance = {
    source: "azure-function-binding",
    evidence: "deterministic" as const,
    confidence: 1,
    sourceHash: file.hash,
  };
  const id = `json:${file.path}:<file>`;
  const endpoints: CommunicationEndpoint[] = [];
  const string = (v: unknown) =>
    typeof v === "string" &&
    v.length <= 500 &&
    !v.includes(";") &&
    !v.includes("=")
      ? v
      : undefined;
  const host = basename(file.path) === "host.json";
  if (!host && Array.isArray(data.bindings))
    for (const binding of data.bindings.slice(0, 200)) {
      if (!binding || typeof binding !== "object") continue;
      const b = binding as Record<string, unknown>;
      const type = String(b.type).toLowerCase();
      const protocol =
        type === "httptrigger"
          ? "http"
          : type.startsWith("servicebus")
            ? "service-bus"
            : type.startsWith("eventgrid")
              ? "event-grid"
              : ["queue", "queuetrigger"].includes(type)
                ? "storage-queue"
                : undefined;
      if (!protocol) continue;
      const methods =
        protocol === "http"
          ? Array.isArray(b.methods)
            ? b.methods.slice(0, 10).map((v) => string(v)?.toUpperCase() ?? "?")
            : ["*"]
          : [undefined];
      for (const method of methods)
        endpoints.push({
          id: `${file.path}:${endpoints.length}`,
          protocol,
          direction:
            protocol === "http"
              ? "provide"
              : type.endsWith("trigger")
                ? "subscribe"
                : b.direction === "out"
                  ? "publish"
                  : "subscribe",
          address:
            protocol === "http"
              ? (string(b.route) ??
                (b.route === undefined
                  ? basename(dirname(file.path))
                  : undefined))
              : (string(b.queueName) ??
                string(b.topicName) ??
                (protocol === "event-grid" ? "*" : undefined)),
          channelKind: string(b.queueName)
            ? "queue"
            : string(b.topicName)
              ? "topic"
              : undefined,
          setting: string(b.connection) ?? string(b.topicEndpointUri),
          method,
          symbolId: id,
          location,
          provenance: {
            ...provenance,
            source: protocol === "http" ? "azure-http" : provenance.source,
          },
        });
    }
  const extensions = data.extensions as
    { http?: { routePrefix?: unknown } } | undefined;
  const prefix = extensions?.http?.routePrefix;
  return {
    file,
    edges: [],
    diagnostics: [],
    nodes: [
      {
        id,
        kind: "file",
        name: basename(file.path),
        qualifiedName: file.path,
        language: "json",
        location,
        provenance,
        metadata: {
          communications: endpoints.slice(0, 200),
          communicationsTruncated:
            !host &&
            Array.isArray(data.bindings) &&
            (data.bindings.length > 200 || endpoints.length > 200),
          ...(host
            ? {
                azureHost: true,
                azurePrefix:
                  prefix === undefined ? "api" : (string(prefix) ?? null),
              }
            : {}),
        },
      },
    ],
  };
}
