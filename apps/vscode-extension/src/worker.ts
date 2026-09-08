import { hash, safePath } from "@praesidia/pgraph-shared";
import {
  PGraph,
  relationships,
  topologySnapshot,
  composeWorkspace,
  type RepositoryTopology,
  type RelationshipOptions,
  semanticPrompt,
  type SemanticInput,
} from "@praesidia/pgraph-core";
import { dispatchTool } from "@praesidia/pgraph-tools";
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
    graph ??= PGraph.open(process.argv[2]!);
    let result: unknown;
    switch (m.op) {
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
        if (!graph.status().revision && m.args.name !== "status")
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
