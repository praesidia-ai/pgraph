const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/[\r\n]/g, " ")
    .replace(/[&<>`|\\[\]_*]/g, (character) => `&#${character.charCodeAt(0)};`);
type Item = Record<string, unknown>;
const rows = (value: unknown): Item[] =>
  Array.isArray(value)
    ? (value.filter((v) => v && typeof v === "object") as Item[])
    : [];
const node = (value: unknown): Item =>
  value && typeof value === "object" ? (value as Item) : {};
function table(headers: string[], data: unknown[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...data.map((row) => `| ${row.map(clean).join(" | ")} |`),
  ].join("\n");
}
export function dailyReport(action: string, data: Item): string {
  const titles: Record<string, string> = {
    health: "Index freshness",
    connections: "Connection mapping readiness",
    text: "Exact source matches",
    trace: "Stack trace locations",
    file: "File dependencies",
    cycles: "Dependency cycles",
    changes: "Changed declarations",
    change_impact: "Historical change impact",
    test_gaps: "Candidate test gaps",
    checks: "Available checks",
    verification: "Recorded checks",
  };
  const parts = [`# ${titles[action] ?? "PGraph workflow"}`];
  if (data.error) return `${parts[0]}\n\n${clean(data.error)}`;
  if (data.truncated)
    parts.push(
      "Some results are omitted. Narrow the scope or use the CLI/agent tool to request a larger budget.",
    );
  switch (action) {
    case "connections":
      parts.push(
        `Missing mapping groups: ${clean(node(data.counts).missing)} · Dynamic groups: ${clean(node(data.counts).dynamic)} · Configured groups: ${clean(node(data.counts).configured)}`,
        table(
          [
            "Service path",
            "Status",
            "Configuration field",
            "Sites",
            "Source examples",
            "Default clue",
          ],
          rows(data.requirements).map((row) => [
            row.path,
            row.status,
            row.configuration,
            row.sites,
            rows(row.examples)
              .map((example) => `${example.file}:${example.line}`)
              .join(", "),
            row.fallback ?? "",
          ]),
        ),
        clean(data.note),
      );
      break;
    case "health":
      parts.push(
        `**${data.current ? "Supported indexed inputs match the filesystem" : "Index refresh needed"}** · ${clean(data.filesChecked)} files checked.`,
        data.extractionChanged
          ? "Analysis rules changed. Reindex to use the updated engine."
          : "",
        data.configChanged
          ? "Repository or compiler configuration changed."
          : "",
        clean(data.next),
        table(
          ["File", "Change"],
          rows(data.changed).map((r) => [r.file, r.reason]),
        ),
        clean(data.scope),
      );
      break;
    case "text":
      parts.push(
        table(
          ["File", "Line", "Matching source"],
          rows(data.matches).map((r) => [r.file, r.line, r.text]),
        ),
      );
      break;
    case "trace":
      parts.push(
        table(
          ["File", "Line", "Source / unresolved reason"],
          rows(data.frames).map((r) => [r.file, r.line, r.error ?? r.source]),
        ),
      );
      break;
    case "file":
      parts.push(
        `File: ${clean(data.file)}`,
        table(
          ["Declaration", "Kind", "Location"],
          rows(data.declarations).map((r) => [r.symbol, r.kind, r.at]),
        ),
        `Depends on: ${clean((data.dependencies as string[] | undefined)?.join(", ")) || "None indexed"}`,
        `Used by: ${clean((data.dependents as string[] | undefined)?.join(", ")) || "None indexed"}`,
      );
      break;
    case "cycles":
      parts.push(
        ...((data.components as string[][] | undefined) ?? []).map(
          (component, i) => `${i + 1}. ${component.map(clean).join(" ↔ ")}`,
        ),
      );
      if (!(data.components as unknown[] | undefined)?.length)
        parts.push(
          "No multi-file dependency cycles found within the query limits.",
        );
      break;
    case "changes":
      parts.push(
        `Comparison: ${clean(data.mode)} · base ${clean(data.base)}`,
        table(
          ["Declaration", "Location", "Change"],
          rows(data.declarations).map((r) => [
            node(r.node).symbol,
            node(r.node).at,
            r.change,
          ]),
        ),
      );
      break;
    case "change_impact":
      parts.push(
        `Comparison: ${clean(data.mode)} · before ${clean(data.base)}`,
      );
      if (data.page) {
        const page = node(data.page);
        parts.push(
          `Showing ${Number(page.returned) ? Number(page.offset) + 1 : 0}–${Number(page.offset) + Number(page.returned)} of ${clean(page.total)} compared changes. Selected changed files: ${clean(data.filesSelected)}/${clean(data.totalFiles)}. Counts apply only to modeled declarations: ${
            Object.entries(node(data.counts))
              .map(([kind, count]) => `${clean(kind)} ${clean(count)}`)
              .join(", ") || "none"
          }.`,
        );
        if (page.nextOffset !== undefined)
          parts.push(
            "Run **PGraph: Continue Historical Review** for the next page. Changed inputs require starting a new review.",
          );
      }
      if (!rows(data.changes).length)
        parts.push(
          "No changed declarations identified within this comparison. Inspect unknown areas and limits below before choosing further checks.",
        );
      for (const change of rows(data.changes)) {
        const before = node(change.before),
          after = node(change.after);
        parts.push(
          `## ${clean(change.change)}: ${clean(after.symbol || before.symbol)}`,
        );
        parts.push(
          table(
            ["Snapshot", "Declaration", "Location", "Signature"],
            [
              ...(change.before
                ? [["Before", before.symbol, before.at, before.signature]]
                : []),
              ...(change.after
                ? [["After", after.symbol, after.at, after.signature]]
                : []),
            ],
          ),
        );
        parts.push(
          ...(Array.isArray(change.reasons) ? change.reasons.map(clean) : []),
        );
        parts.push(
          table(
            [
              "Consumer",
              "Evidence snapshot",
              "Path from change",
              "After source",
            ],
            rows(change.consumers).map((consumer) => [
              `${node(consumer.node).symbol}${consumer.potentialDispatch ? " (possible dispatch)" : ""}`,
              consumer.snapshot,
              rows(consumer.path)
                .map(
                  (step) =>
                    `${step.edge ? `${step.direction} ${step.edge} → ` : ""}${step.symbol} (${step.at})`,
                )
                .join(" → "),
              consumer.afterState ?? "selected after snapshot",
            ]),
          ),
        );
        if (change.truncated)
          parts.push(
            "Consumer traversal was bounded; inspect wider dependencies and required checks.",
          );
      }
      break;
    case "test_gaps":
      parts.push(
        table(
          ["Changed declaration", "Assessment", "Candidate tests"],
          rows(data.rows).map((r) => [
            node(r.node).symbol,
            r.assessment,
            rows(r.tests)
              .map(
                (t) =>
                  `${t.name}${t.potentialDispatch ? " (possible dispatch)" : ""}`,
              )
              .join(", "),
          ]),
        ),
      );
      break;
    case "checks":
      parts.push(
        table(
          ["Package", "Command", "Script body"],
          rows(data.checks).map((r) => [
            r.cwd,
            `${r.manager} run ${r.script}`,
            r.body,
          ]),
        ),
        clean(data.note),
      );
      break;
    case "verification":
      parts.push(
        table(
          ["Check", "Result", "Evidence freshness", "Finished"],
          rows(data.runs).map((r) => [
            node(r.check).id,
            r.result,
            r.freshness,
            r.finishedAt,
          ]),
        ),
        clean(data.scope),
      );
      break;
  }
  for (const item of rows(data.unknown))
    parts.push(`Unknown: ${clean(item.file)} — ${clean(item.reason)}`);
  for (const warning of [
    ...(Array.isArray(data.warnings) ? data.warnings : []),
    ...(Array.isArray(data.diagnostics) ? data.diagnostics : []),
  ])
    parts.push(`Note: ${clean(warning)}`);
  return parts.filter(Boolean).join("\n\n");
}
