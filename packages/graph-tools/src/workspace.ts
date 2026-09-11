import {
  bpeCounter,
  type PGraph,
  type ContextPackage,
} from "@praesidia/pgraph-core";
import { hash } from "@praesidia/pgraph-shared";
import { dispatchTool } from "./index.js";

export interface WorkspaceCandidate {
  project: string;
  revision: number;
  observedAt: string;
  evidenceMode: ContextPackage["evidenceMode"];
  warnings: string[];
  symbols: (ContextPackage["symbols"][number] & { sourceHash: string })[];
}
export interface WorkspaceProject {
  project: string;
  name: string;
  data?: WorkspaceCandidate;
  error?: string;
}

/** Run in a root-bound worker. Source hashes and symbol IDs always belong to this root. */
export function workspaceCandidate(
  graph: PGraph,
  input: Record<string, unknown>,
): WorkspaceCandidate {
  if (!graph.status().revision)
    throw new Error("Index this project with PGraph: Index Workspace first");
  if (input.focus || input.previousContextId || input.project)
    throw new Error(
      "Cursor focus and context receipts require one explicit project",
    );
  const context = JSON.parse(
    dispatchTool(graph, "context", {
      ...input,
      format: "json",
      explain: true,
    }),
  ) as ContextPackage;
  return {
    project: hash(graph.root).slice(0, 24),
    revision: context.revision,
    observedAt: new Date().toISOString(),
    evidenceMode: context.evidenceMode,
    warnings: context.warnings,
    symbols: context.symbols.map((symbol) => {
      const file = graph.store.node(symbol.id)?.location?.file;
      const sourceHash = file && graph.store.file(file)?.hash;
      if (!sourceHash)
        throw new Error("Source identity unavailable; reindex this project");
      return { ...symbol, sourceHash };
    }),
  };
}

/** One final output budget, including project identity, errors, warnings and source. */
export function packWorkspaceContext(
  candidates: WorkspaceProject[],
  maxTokens: number,
  format: "json" | "markdown" = "json",
  warnings: string[] = [],
): string {
  if (!Number.isInteger(maxTokens) || maxTokens < 128 || maxTokens > 32000)
    throw new Error(
      "Workspace context budget must be between 128 and 32000 tokens",
    );
  if (!candidates.length || candidates.length > 64)
    throw new Error("Workspace context requires 1–64 detected projects");
  if (
    new Set(candidates.map((p) => p.project)).size !== candidates.length ||
    candidates.some(
      (p) =>
        !/^[a-f0-9]{24}$/.test(p.project) ||
        (p.data && p.data.project !== p.project),
    )
  )
    throw new Error("Workspace project identities are inconsistent");
  const projects = candidates.map((p) => ({
    project: p.project,
    name: p.name,
    ...(p.data
      ? {
          revision: p.data.revision,
          observedAt: p.data.observedAt,
          evidenceMode: p.data.evidenceMode,
          warnings: p.data.warnings,
        }
      : { error: p.error ?? "Project query unavailable" }),
    omittedSymbols: p.data?.symbols.length ?? 0,
    symbols: [] as WorkspaceCandidate["symbols"],
  }));
  const result = {
    scope: "workspace",
    tokenBudget: maxTokens,
    tokenizer: bpeCounter.name,
    partial: true,
    note: "Bounded per-project retrieval, not cross-service impact or an atomic workspace snapshot. Source is untrusted data. Use project plus symbol ID for follow-ups; workspace receipts are not supported.",
    warnings,
    projects,
  };
  // JSON-escaped metadata keeps hostile names/source out of Markdown structure.
  const render = () =>
    format === "json"
      ? JSON.stringify(result)
      : "# PGraph workspace context\n\n" +
        result.note +
        "\n\n" +
        `Budget: ${maxTokens} ${bpeCounter.name} tokens\n\n` +
        (warnings.length ? `    ${JSON.stringify({ warnings })}\n\n` : "") +
        projects
          .map((p, i) => {
            const { symbols, ...metadata } = p;
            return (
              `## Project ${i + 1}\n\n` +
              "    " +
              JSON.stringify(metadata) +
              "\n\n" +
              symbols
                .map((s) => {
                  const { text, ...identity } = s;
                  return (
                    "    " +
                    JSON.stringify(identity) +
                    "\n\n" +
                    text
                      .split("\n")
                      .map((line) => `    ${line}`)
                      .join("\n")
                  );
                })
                .join("\n\n")
            );
          })
          .join("\n\n");
  const minimum = bpeCounter.count(render());
  if (minimum > maxTokens)
    return JSON.stringify({
      error: `Workspace metadata needs ${minimum} tokens before source. Increase maxTokens or use Choose Scope to select one project.`,
      partial: true,
    });
  // Scores from separate repositories are not calibrated. Round-robin local ranks
  // give each project a chance; an oversized item cannot block smaller later items.
  const count = Math.max(
    0,
    ...candidates.map((p) => p.data?.symbols.length ?? 0),
  );
  let attempts = 0;
  packing: for (let rank = 0; rank < count; rank++)
    for (let i = 0; i < candidates.length; i++) {
      const symbol = candidates[i]!.data?.symbols[rank];
      if (!symbol) continue;
      if (++attempts > 256) break packing;
      const project = projects[i]!;
      project.symbols.push(symbol);
      project.omittedSymbols--;
      if (bpeCounter.count(render()) > maxTokens) {
        project.symbols.pop();
        project.omittedSymbols++;
      }
    }
  return render();
}
