import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGraph } from "@praesidia/pgraph-core";
import { dispatchTool, toolDefinitions } from "@praesidia/pgraph-tools";
import { runBenchmark, validateScenarios } from "@praesidia/pgraph-benchmark";

export const help = `PGraph by Praesidia — local graph-native context for coding agents

Usage: pgraph <command> [arguments] [options]

  init                         Initialize local storage
  index [--changed]             Incrementally index TS/JS/TSX/JSX
  rebuild                      Re-extract and resolve every source file
  status                       Show index health
  clean                        Remove local graph database artifacts
  symbol <name>                Resolve a definition
  search <query>               Find symbols
  callers|callees <symbol>      Explore calls
  references|implementations   Explore symbol use
  dependencies|dependents      Explore dependencies
  impact <symbol>              Rank the change surface
  review_changes               Review current changed files and candidate tests
  tests <symbol>               Find related tests
  slice|skeleton <symbol>       Read only the necessary source/signatures
  excerpt <symbol>             Read a targeted part of a large declaration
  file_slice <file> <from> <to> Read explicit source lines
  path <from> <to>              Find a call/dependency path
  context <task>               Build a strict-budget context package
  architecture                 Map packages and entry points
  feature <concept>            Retrieve name/concept associations
  workflow <action> [query]     health|text|trace|file|cycles|changes|change_impact|test_gaps|checks|verification
  benchmark --suite <json>      Run declared baseline retrieval scenarios

Options: --root <path> --tokens <128..32000> --depth <n> --scope <folder>
         --json --markdown --limit <n> --offset <n> --help --version
         --evidence <local|assisted> --file <relative-path> --line <n> (context)
         --query <text> --line <n> --max-lines <n> (excerpt); --explain (context)
         --mode <working|staged|branch> --base <ref> --case-sensitive (workflow)
         --review-id <id> --offset <n> (workflow change_impact continuation)
No model keys, network services, Docker or application execution required.
`;
export function runCli(args: string[]): string {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      root: { type: "string" },
      tokens: { type: "string" },
      depth: { type: "string" },
      scope: { type: "string" },
      json: { type: "boolean" },
      markdown: { type: "boolean" },
      changed: { type: "boolean" },
      suite: { type: "string" },
      limit: { type: "string" },
      offset: { type: "string" },
      "review-id": { type: "string" },
      evidence: { type: "string" },
      file: { type: "string" },
      line: { type: "string" },
      query: { type: "string" },
      "max-lines": { type: "string" },
      explain: { type: "boolean" },
      mode: { type: "string" },
      base: { type: "string" },
      "case-sensitive": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.version) return "0.6.1";
  if (values.help || !positionals.length) return help;
  if (values.json && values.markdown)
    throw new Error("Choose --json or --markdown");
  const [command, ...rest] = positionals;
  const root = resolve(values.root ?? process.cwd());
  if (command === "benchmark") {
    if (!values.suite)
      throw new Error(
        "Provide --suite benchmarks/auth.json (see docs/benchmarks.md)",
      );
    return JSON.stringify(
      runBenchmark(
        root,
        validateScenarios(
          JSON.parse(readFileSync(resolve(values.suite), "utf8")),
        ),
      ),
      null,
      2,
    );
  }
  if (command === "clean") {
    PGraph.clean(root);
    return "Local graph removed. Configuration preserved.";
  }
  const graph = PGraph.open(root, {
    requireIndex: !["init", "index", "rebuild"].includes(command!),
    readOnly: !["init", "index", "rebuild"].includes(command!),
  });
  try {
    if (command === "init") return JSON.stringify(graph.init(), null, 2);
    if (command === "index" || command === "rebuild") {
      graph.init();
      return JSON.stringify(
        graph.index({ rebuild: command === "rebuild" }),
        null,
        2,
      );
    }
    if (!toolDefinitions.some((t) => t.name === command))
      throw new Error(`Unknown command: ${command}. Run pgraph --help.`);
    const input: Record<string, unknown> = {};
    if (values.tokens) input.maxTokens = Number(values.tokens);
    if (values.scope) input.scope = values.scope;
    if (values.depth) input.depth = Number(values.depth);
    if (values.evidence) input.evidenceMode = values.evidence;
    if (values.file && !["context", "workflow"].includes(command!))
      throw new Error("--file is a context option");
    if (values.line && !["context", "excerpt"].includes(command!))
      throw new Error("--line is a context/excerpt option");
    if ((values.query || values["max-lines"]) && command !== "excerpt")
      throw new Error("--query and --max-lines are excerpt options");
    if (values.explain && command !== "context")
      throw new Error("--explain is a context option");
    if (
      values["review-id"] &&
      (command !== "workflow" || rest[0] !== "change_impact")
    )
      throw new Error("--review-id is a workflow change_impact option");
    if (
      (values.mode || values.base || values["case-sensitive"]) &&
      command !== "workflow"
    )
      throw new Error(
        "--mode, --base and --case-sensitive are workflow options",
      );
    if (command === "workflow") {
      input.action = rest[0];
      if (rest.length > 1) input.query = rest.slice(1).join(" ");
      if (values.file) input.file = values.file;
      if (values.mode) input.mode = values.mode;
      if (values.base) input.base = values.base;
      if (values.limit) input.limit = Number(values.limit);
      if (values.offset) input.offset = Number(values.offset);
      if (values["review-id"]) input.reviewId = values["review-id"];
      if (values["case-sensitive"]) input.caseSensitive = true;
    } else if (command === "context") {
      input.task = rest.join(" ");
      input.maxTokens = Number(
        values.tokens ?? graph.config.context.defaultTokenBudget,
      );
      input.format = values.json ? "json" : "markdown";
      if (values.explain) input.explain = true;
      if (values.file || values.line)
        input.focus = { file: values.file, line: Number(values.line) };
    } else if (command === "excerpt") {
      input.symbol = rest.join(" ");
      if (values.query) input.query = values.query;
      if (values.line) input.line = Number(values.line);
      if (values["max-lines"]) input.maxLines = Number(values["max-lines"]);
    } else if (command === "search") {
      input.query = rest.join(" ");
      if (values.limit) input.limit = Number(values.limit);
      if (values.offset) input.offset = Number(values.offset);
    } else if (command === "path") {
      input.from = rest[0];
      input.to = rest[1];
    } else if (command === "file_slice") {
      input.file = rest[0];
      input.startLine = Number(rest[1]);
      input.endLine = Number(rest[2]);
    } else if (command === "feature") input.concept = rest.join(" ");
    else if (!["status", "architecture", "review_changes"].includes(command!))
      input.symbol = rest.join(" ");
    return dispatchTool(graph, command!, input);
  } finally {
    graph.close();
  }
}
