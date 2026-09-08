import type {
  CommunicationEndpoint,
  ExplorerGraph,
  ExplorerNode,
  RepositoryTopology,
  ServiceDefinition,
} from "@praesidia/pgraph-ir";
import type { GraphStore } from "@praesidia/pgraph-store";
import { hash } from "@praesidia/pgraph-shared";

const contains = (path: string, file: string) =>
  path === "." || file.startsWith(`${path}/`);
export function topologySnapshot(
  store: GraphStore,
  root: string,
): RepositoryTopology {
  const rootId = hash(root).slice(0, 24);
  const endpoints: CommunicationEndpoint[] = [];
  const hosts: { path: string; prefix: string | null }[] = [];
  let truncated = false;
  // Scan indexed file nodes, not all symbols. Work and output are both bounded.
  for (let offset = 0; offset < 100_000; offset += 500) {
    const files = store.search("", { kind: "file", limit: 500, offset });
    for (const node of files) {
      if (node.metadata.azureHost && node.location)
        hosts.push({
          path: node.location.file.replace(/\/?host\.json$/, "") || ".",
          prefix: node.metadata.azurePrefix as string | null,
        });
      if (node.metadata.communicationsTruncated) truncated = true;
      const items = node.metadata.communications as
        CommunicationEndpoint[] | undefined;
      if (items?.length) {
        endpoints.push(...items.slice(0, Math.max(0, 2000 - endpoints.length)));
        if (endpoints.length >= 2000) truncated = true;
      }
    }
    if (files.length < 500) break;
    if (offset === 99_500) truncated = true;
  }
  hosts.sort(
    (a, b) =>
      (b.path === "." ? 0 : b.path.length) -
      (a.path === "." ? 0 : a.path.length),
  );
  for (const endpoint of endpoints)
    if (
      endpoint.protocol === "http" &&
      endpoint.provenance.source === "azure-http"
    ) {
      const host = hosts.find((h) => contains(h.path, endpoint.location.file));
      const prefix = host ? host.prefix : "api";
      endpoint.address =
        endpoint.address === undefined || prefix === null
          ? undefined
          : "/" +
            [prefix, endpoint.address]
              .map((s) => s.replace(/^\/+|\/+$/g, ""))
              .filter(Boolean)
              .join("/");
    }
  const name = store.node("repository:root")?.name ?? "Repository";
  const configured =
    store.getMeta<ServiceDefinition[]>("topologyServices") ?? [];
  const fallback: ServiceDefinition = {
    name,
    path: ".",
    origins: [],
    urls: {},
    resources: {},
  };
  const services = configured.length
    ? configured
    : [
        fallback,
        ...hosts
          .filter((h) => h.path !== ".")
          .slice(0, 99)
          .map((h) => ({ ...fallback, name: h.path, path: h.path })),
      ];
  if (hosts.length > 99 && !configured.length) truncated = true;
  const warnings = [];
  if (store.getMeta<number>("communicationVersion") !== 1)
    warnings.push(`${name}: reindex to extract communication evidence.`);
  if (!store.stats().revision) warnings.push(`${name}: no committed index.`);
  return {
    rootId,
    name,
    revision: store.stats().revision,
    services,
    endpoints,
    truncated,
    warnings,
  };
}

function routeMatches(route: string, path: string): boolean {
  const parts = (s: string) => s.replace(/\/$/, "").split("/");
  const a = parts(route),
    b = parts(path);
  return (
    a.length === b.length &&
    a.every(
      (segment, i) =>
        segment === b[i] ||
        /^:[\w]+$/.test(segment) ||
        /^\{[\w]+\}$/.test(segment),
    )
  );
}
function requestURL(
  endpoint: CommunicationEndpoint,
  service: ServiceDefinition,
): URL | undefined {
  try {
    const address = endpoint.setting
      ? (service.urls[endpoint.setting] ?? "") + (endpoint.address ?? "")
      : endpoint.address;
    if (!address || (endpoint.setting && !service.urls[endpoint.setting]))
      return;
    const url = new URL(address);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    return url;
  } catch {
    return;
  }
}

/** Pure composition of committed per-root snapshots. Never discovers roots or contacts services. */
export function composeWorkspace(
  snapshots: RepositoryTopology[],
): ExplorerGraph {
  if (snapshots.length > 64)
    throw new Error(
      "Workspace map supports up to 64 roots; narrow the workspace.",
    );
  if (new Set(snapshots.map((s) => s.rootId)).size !== snapshots.length)
    throw new Error("Duplicate repository identity");
  const result: ExplorerGraph = {
    nodes: [],
    edges: [],
    revisions: {},
    truncated: false,
    warnings: [],
  };
  const services: {
    snapshot: RepositoryTopology;
    definition: ServiceDefinition;
    node: ExplorerNode;
  }[] = [];
  for (const snapshot of snapshots) {
    result.revisions[snapshot.rootId] = snapshot.revision;
    result.truncated ||= snapshot.truncated;
    result.warnings.push(...snapshot.warnings);
    for (const definition of snapshot.services) {
      if (services.length >= 150) {
        result.truncated = true;
        break;
      }
      const node = {
        id: JSON.stringify([snapshot.rootId, definition.path]),
        label: definition.name,
        kind: "service",
        rootId: snapshot.rootId,
        scope: definition.path,
        detail: `${snapshot.name} / ${definition.path}\nIndex revision ${snapshot.revision}\n${definition.origins.length ? definition.origins.join("\n") : "No declared HTTP origin"}`,
      };
      services.push({ snapshot, definition, node });
      result.nodes.push(node);
    }
  }
  const points = snapshots.flatMap((snapshot) =>
    snapshot.endpoints
      .map((endpoint) => {
        const service = services
          .filter(
            (s) =>
              s.snapshot.rootId === snapshot.rootId &&
              contains(s.definition.path, endpoint.location.file),
          )
          .sort(
            (a, b) =>
              (b.definition.path === "." ? 0 : b.definition.path.length) -
              (a.definition.path === "." ? 0 : a.definition.path.length),
          )[0];
        return { endpoint, service };
      })
      .filter((p) => p.service !== undefined),
  );
  const providers = points.filter((p) =>
    ["provide", "subscribe"].includes(p.endpoint.direction),
  );
  let comparisons = 0,
    unresolved = 0;
  for (const point of points.filter((p) =>
    ["request", "publish"].includes(p.endpoint.direction),
  )) {
    if (result.edges.length >= 800) {
      result.truncated = true;
      break;
    }
    const service = point.service!;
    const endpoint = point.endpoint;
    const url =
      endpoint.protocol === "http"
        ? requestURL(endpoint, service.definition)
        : undefined;
    const resource =
      endpoint.resource ??
      (endpoint.setting
        ? service.definition.resources[endpoint.setting]
        : endpoint.protocol === "event-grid"
          ? service.definition.resources["event-grid"]
          : undefined);
    const matches: typeof providers = [];
    for (const target of providers) {
      if (++comparisons > 500_000) {
        result.truncated = true;
        break;
      }
      if (
        endpoint.protocol !== target.endpoint.protocol ||
        (!endpoint.address && endpoint.protocol !== "http")
      )
        continue;
      const other = target.endpoint;
      if (endpoint.protocol === "http") {
        if (
          !url ||
          !other.address ||
          !endpoint.method ||
          endpoint.method === "?" ||
          (other.method !== "*" && other.method !== endpoint.method)
        )
          continue;
        const mapped = target.service!.definition.origins.some((origin) => {
          try {
            const base = new URL(origin);
            const prefix = base.pathname.replace(/\/$/, "");
            return (
              base.origin === url.origin &&
              routeMatches(
                prefix + "/" + other.address!.replace(/^\//, ""),
                url.pathname,
              )
            );
          } catch {
            return false;
          }
        });
        if (mapped) matches.push(target);
      } else {
        const otherResource =
          other.resource ??
          (other.setting
            ? target.service!.definition.resources[other.setting]
            : other.protocol === "event-grid"
              ? target.service!.definition.resources["event-grid"]
              : undefined);
        if (
          resource &&
          resource === otherResource &&
          endpoint.address === other.address &&
          !(
            endpoint.channelKind &&
            other.channelKind &&
            endpoint.channelKind !== other.channelKind
          )
        )
          matches.push(target);
      }
    }
    if (comparisons > 500_000) break;
    const source = {
      rootId: service.snapshot.rootId,
      symbolId: endpoint.symbolId,
      location: endpoint.location,
      hash: endpoint.provenance.sourceHash,
    };
    if (matches.length) {
      for (const target of matches) {
        if (result.edges.length >= 800) {
          result.truncated = true;
          break;
        }
        const other = target.endpoint;
        result.edges.push({
          id: JSON.stringify([
            service.node.id,
            endpoint.id,
            target.service!.node.id,
            other.id,
          ]),
          from: service.node.id,
          to: target.service!.node.id,
          type: endpoint.protocol,
          evidence:
            matches.length > 1
              ? "ambiguous candidate"
              : "inferred from declarations",
          confidence: matches.length > 1 ? 0.5 : 0.85,
          detail: `${endpoint.method ?? ""} ${endpoint.protocol === "http" ? (url?.pathname ?? "?") : (endpoint.address ?? "?")}\n${endpoint.provenance.source} → ${other.provenance.source}\nMatched explicit ${endpoint.protocol === "http" ? "URL and route" : "resource identity and channel"}; runtime delivery is unverified.`,
          sources: [
            source,
            {
              rootId: target.service!.snapshot.rootId,
              symbolId: other.symbolId,
              location: other.location,
              hash: other.provenance.sourceHash,
            },
          ],
        });
      }
    } else {
      unresolved++;
      if (result.nodes.length >= 200) {
        result.truncated = true;
        continue;
      }
      const id = JSON.stringify([service.node.id, "unresolved", endpoint.id]);
      result.nodes.push({
        id,
        rootId: service.snapshot.rootId,
        symbolId: endpoint.symbolId,
        location: endpoint.location,
        label:
          `${endpoint.protocol}: ${endpoint.setting ?? (url?.host || endpoint.address) ?? "dynamic target"}`.slice(
            0,
            200,
          ),
        kind: "unresolved",
        detail:
          "No matching declared destination. Add topology service URLs/resource mappings or index the receiving service.",
      });
      result.edges.push({
        id: id + "edge",
        from: service.node.id,
        to: id,
        type: endpoint.protocol,
        confidence: 0,
        evidence: "unresolved",
        detail:
          "Destination unresolved; no service-to-service relationship has been established.",
        sources: [source],
      });
    }
  }
  if (unresolved)
    result.warnings.push(
      `${unresolved} outgoing declarations have unresolved destinations.`,
    );
  result.warnings.push(
    "Static evidence only. Dynamic clients, mounted routers, deployment rewrites and runtime delivery may be incomplete.",
  );
  result.warnings = result.warnings.slice(0, 100);
  return result;
}
