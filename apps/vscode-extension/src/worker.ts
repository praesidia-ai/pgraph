import { hash, safePath } from "@praesidia/pgraph-shared";
import {
  PGraph,
  workspaceImpact,
  type WorkspaceImpactProject,
  relationships,
  topologySnapshot,
  composeWorkspace,
  type RepositoryTopology,
  type RelationshipOptions,
  semanticPrompt,
  type SemanticInput,
} from "@praesidia/pgraph-core";
import {
  dispatchTool,
  toolDefinitions,
  workspaceCandidate,
  packWorkspaceContext,
  packWorkspaceImpact,
  type WorkspaceProject,
} from "@praesidia/pgraph-tools";
let graph: PGraph | undefined;
process.on("message", (message: unknown) => {
  if (!message || typeof message !== "object") return;
  const m = message as {
    id: number;
    op: string;
    args: Record<string, unknown>;
  };
  if (!Number.isSafeInteger(m.id) || typeof m.op !== "string") return;
  try {
    // Validation/packing do not require the first project's index or configuration.
    if (m.op === "validateTool" || m.op === "workspacePack") {
      const result =
        m.op === "validateTool"
          ? toolDefinitions
              .find((t) => t.name === m.args.name)
              ?.schema.parse(m.args.input)
          : packWorkspaceContext(
              m.args.projects as WorkspaceProject[],
              Number(m.args.maxTokens),
              m.args.format as "json" | "markdown",
              m.args.warnings as string[],
            );
      if (result === undefined) throw new Error("Unknown PGraph tool");
      process.send?.({ id: m.id, result });
      return;
    }
    if (m.op === "workspaceImpact") {
      const input = toolDefinitions
        .find((t) => t.name === "impact")!
        .schema.parse(m.args.input) as {
        project?: string;
        symbol: string;
        depth: number;
        maxTokens: number;
        workspace?: boolean;
      };
      const roots = m.args.projects as {
        root: string;
        project: string;
        name: string;
      }[];
      if (
        !input.project ||
        !input.workspace ||
        !Array.isArray(roots) ||
        !roots.length ||
        roots.length > 64
      )
        throw new Error(
          "Workspace impact needs an origin project ID and 1–64 open projects",
        );
      const opened: WorkspaceImpactProject[] = [];
      try {
        for (const root of roots) {
          const item: WorkspaceImpactProject = {
            project: root.project,
            name: root.name,
          };
          opened.push(item);
          try {
            item.graph = PGraph.open(root.root, {
              requireIndex: true,
              readOnly: true,
            });
          } catch (error) {
            item.error =
              error instanceof Error
                ? error.message
                : "Project index unavailable";
          }
        }
        const result = workspaceImpact(opened, {
          project: input.project,
          symbol: input.symbol,
          depth: input.depth,
        });
        result.warnings.push(
          ...((m.args.warnings as string[] | undefined) ?? []),
        );
        process.send?.({
          id: m.id,
          result: packWorkspaceImpact(result, input.maxTokens),
        });
      } finally {
        for (const item of opened) item.graph?.close();
      }
      return;
    }
    graph ??= PGraph.open(process.argv[2]!);
    let result: unknown;
    switch (m.op) {
      case "workspaceContext":
        if (m.args.project !== hash(graph.root).slice(0, 24))
          throw new Error(
            "Project identity changed. Refresh Workspace Projects and reindex.",
          );
        result = workspaceCandidate(
          graph,
          m.args.input as Record<string, unknown>,
        );
        break;
      case "focus":
        result = graph.focus({
          file: String(m.args.file),
          line: Number(m.args.line),
        });
        break;
      case "beginCheck":
        result = graph.verification.begin(String(m.args.id));
        break;
      case "finishCheck":
        result = graph.verification.finish(
          String(m.args.id),
          m.args.exitCode === null ? null : Number(m.args.exitCode),
        );
        break;
      case "reviewChanges":
        result = graph.reviewChanges();
        break;
      case "init":
        result = graph.init();
        break;
      case "index":
        graph.init();
        result = graph.index({
          onProgress: (progress) => process.send?.({ id: m.id, progress }),
        });
        break;
      case "tool":
        if (
          !graph.status().revision &&
          m.args.name !== "status" &&
          !(
            m.args.name === "workflow" &&
            (m.args.input as { action?: string })?.action === "health"
          )
        )
          throw new Error(
            "Index the repository first with PGraph: Index Repository",
          );
        result = dispatchTool(graph, String(m.args.name), m.args.input);
        break;
      case "topology":
        result = topologySnapshot(graph.store, graph.root);
        break;
      case "workspaceGraph":
        result = composeWorkspace(m.args.snapshots as RepositoryTopology[]);
        break;
      case "relationships":
        result = relationships(
          graph.store,
          hash(graph.root).slice(0, 24),
          m.args as RelationshipOptions,
        );
        break;
      case "sourceLocation": {
        if (m.args.revision !== graph.status().revision)
          throw new Error("Index changed. Refresh the relationship view.");
        const node = graph.store.node(String(m.args.symbol));
        if (!node?.location) throw new Error("Choose an indexed source symbol");
        const line =
          m.args.line === undefined
            ? node.location.startLine
            : Number(m.args.line);
        if (
          !Number.isSafeInteger(line) ||
          line < node.location.startLine ||
          line > node.location.endLine
        )
          throw new Error("Evidence line outside indexed symbol");
        graph.fileSlice({
          file: node.location.file,
          startLine: node.location.startLine,
          endLine: node.location.startLine,
        });
        result = {
          path: safePath(graph.root, node.location.file),
          line,
        };
        break;
      }
      case "metrics":
        result = graph.lastContextMetrics ?? {
          message:
            "Run PGraph: Find Relevant Context or use pgraph_context first.",
        };
        break;
      case "semanticInput": {
        const input = graph.semanticInput(String(m.args.symbol));
        result = { input, prompt: semanticPrompt(input) };
        break;
      }
      case "semanticAccept":
        graph.validateSemanticInput(m.args.input as SemanticInput);
        result = graph.memory.accept(
          String(m.args.raw),
          m.args.input as SemanticInput,
          "vscode-copilot",
        );
        break;
      default:
        throw new Error("Unknown engine operation");
    }
    process.send?.({ id: m.id, result });
  } catch (error) {
    process.send?.({
      id: m.id,
      error: error instanceof Error ? error.message : "Engine operation failed",
    });
  }
});
process.on("disconnect", () => {
  graph?.close();
  process.exit(0);
});
