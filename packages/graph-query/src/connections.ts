import type { RepositoryTopology } from "@praesidia/pgraph-ir";

export function connectionReadiness(snapshot: RepositoryTopology) {
  const requirements = new Map<
    string,
    {
      service: string;
      path: string;
      kind: "origin" | "url" | "resource" | "channel" | "handler";
      setting?: string;
      status: "configured" | "missing" | "dynamic";
      configuration: string;
      fallback?: string;
      sites: number;
      examples: { file: string; line: number; hash?: string }[];
    }
  >();
  for (const endpoint of snapshot.endpoints) {
    const service = snapshot.services
      .filter(
        (service) =>
          service.path === "." ||
          endpoint.location.file.startsWith(service.path + "/"),
      )
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (!service) continue;
    const add = (
      kind: "origin" | "url" | "resource" | "channel" | "handler",
      setting: string | undefined,
      status: "configured" | "missing" | "dynamic",
      configuration: string,
      fallback?: string,
    ) => {
      const key = JSON.stringify([service.path, kind, setting, status]);
      const row = requirements.get(key) ?? {
        service: service.name,
        path: service.path,
        kind,
        setting,
        status,
        configuration,
        fallback,
        sites: 0,
        examples: [],
      };
      row.sites++;
      if (
        row.examples.length < 2 &&
        !row.examples.some(
          (source) =>
            source.file === endpoint.location.file &&
            source.line === endpoint.location.startLine,
        )
      )
        row.examples.push({
          file: endpoint.location.file,
          line: endpoint.location.startLine,
          hash: endpoint.provenance.sourceHash,
        });
      requirements.set(key, row);
    };
    if (endpoint.protocol === "http") {
      if (endpoint.direction === "provide")
        add(
          "origin",
          undefined,
          service.origins.length ? "configured" : "missing",
          "origins",
        );
      else if (endpoint.setting)
        add(
          "url",
          endpoint.setting,
          service.urls[endpoint.setting] ? "configured" : "missing",
          `urls.${endpoint.setting}`,
        );
      else if (!endpoint.address)
        add(
          "url",
          undefined,
          "dynamic",
          "Resolve the URL expression in source",
        );
    } else {
      const resourceSetting =
        endpoint.setting ??
        (endpoint.protocol === "event-grid" ? "event-grid" : undefined);
      if (!endpoint.resource)
        add(
          "resource",
          resourceSetting,
          resourceSetting
            ? service.resources[resourceSetting]
              ? "configured"
              : "missing"
            : "dynamic",
          resourceSetting
            ? `resources.${resourceSetting}`
            : "Resolve the namespace/endpoint expression in source",
        );
      if (endpoint.addressSetting)
        add(
          "channel",
          endpoint.addressSetting,
          service.channels?.[endpoint.addressSetting]
            ? "configured"
            : "missing",
          `channels.${endpoint.addressSetting}`,
          endpoint.addressFallback,
        );
      else if (!endpoint.address)
        add(
          "channel",
          undefined,
          "dynamic",
          "Resolve the queue/topic expression in source",
        );
    }
    if (
      ["provide", "subscribe"].includes(endpoint.direction) &&
      !endpoint.execution?.symbols.length
    )
      add(
        "handler",
        undefined,
        "dynamic",
        "Resolve the registered handler in source",
      );
  }
  const all = [...requirements.values()].sort(
    (a, b) =>
      ({ missing: 0, dynamic: 1, configured: 2 })[a.status] -
        { missing: 0, dynamic: 1, configured: 2 }[b.status] ||
      a.path.localeCompare(b.path) ||
      a.configuration.localeCompare(b.configuration),
  );
  return {
    analysis: "connection-readiness",
    project: snapshot.rootId,
    revision: snapshot.revision,
    counts: {
      sites: snapshot.endpoints.length,
      requirements: all.length,
      missing: all.filter((row) => row.status === "missing").length,
      dynamic: all.filter((row) => row.status === "dynamic").length,
      configured: all.filter((row) => row.status === "configured").length,
    },
    requirements: all.slice(0, 100),
    truncated: snapshot.truncated || all.length > 100,
    note: "Configure the named fields in .pgraph.json topology.services for each service path using non-secret deployment identities. No environment values or local.settings.json are read. Defaults are clues, never assumed deployment values. Configured mappings do not prove connectivity, deployment, runtime delivery or exhaustive extraction. Missing rows can remain when truncated.",
    warnings: snapshot.warnings,
  };
}
