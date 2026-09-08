import {
  PGraph,
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
