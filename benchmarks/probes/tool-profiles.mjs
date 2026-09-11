import {
  mkdtempSync,
  cpSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PGraph, bpeCounter } from "../../packages/graph-core/dist/index.js";

const root = mkdtempSync(join(tmpdir(), "pgraph-profile-probe-"));
const main = resolve("packages/graph-mcp/dist/main.js");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const requests = [
  { name: "search", arguments: { query: "AuthService.login", maxTokens: 500 } },
  {
    name: "excerpt",
    arguments: { symbol: "AuthService.login", maxTokens: 1000 },
  },
  {
    name: "impact",
    arguments: { symbol: "AuthService.login", maxTokens: 1000 },
  },
];
try {
  cpSync(resolve("examples/sample-typescript-app"), root, {
    recursive: true,
    filter: (path) => !path.includes(".pgraph"),
  });
  const graph = PGraph.open(root);
  try {
    graph.index();
  } finally {
    graph.close();
  }
  const profiles = {};
  const evidence = {};
  for (const profile of ["full", "essential"]) {
    const client = new Client({
      name: "pgraph-profile-probe",
      version: "1.0.0",
    });
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [main, root, "--tool-profile", profile],
          stderr: "pipe",
        }),
      );
      const { tools } = await client.listTools();
      const instructions = client.getInstructions() ?? "";
      const calls = [];
      evidence[profile] = [];
      for (const request of requests) {
        const result = await client.callTool(request);
        if (result.isError) throw new Error(JSON.stringify(result));
        const response = JSON.stringify(result);
        evidence[profile].push(response);
        calls.push({
          request,
          requestTokens: bpeCounter.count(JSON.stringify(request)),
          responseTokens: bpeCounter.count(response),
          responseSha256: hash(response),
        });
      }
      profiles[profile] = {
        toolCount: tools.length,
        names: tools.map((tool) => tool.name),
        toolsListJsonTokens: bpeCounter.count(JSON.stringify(tools)),
        instructionsTokens: bpeCounter.count(instructions),
        calls,
      };
    } finally {
      await client.close();
    }
  }
  const identical =
    JSON.stringify(evidence.full) === JSON.stringify(evidence.essential);
  if (!identical) throw new Error("Profiles changed the shared query evidence");
  const report = {
    generatedAt: new Date().toISOString(),
    tokenizer: "cl100k_base",
    node: process.version,
    sourceSha256: Object.fromEntries(
      [
        "packages/graph-mcp/src/index.ts",
        "packages/graph-mcp/src/main.ts",
        "packages/graph-tools/src/index.ts",
      ].map((path) => [path, hash(readFileSync(path))]),
    ),
    method:
      "Actual MCP stdio tools/list array, server instructions, and three identical query request/result JSON values. Definitions and instructions counted once. No model or billing measurement.",
    profiles,
    sharedQueryResponsesIdentical: identical,
    schemaReductionPercent:
      100 *
      (1 -
        profiles.essential.toolsListJsonTokens /
          profiles.full.toolsListJsonTokens),
    limitation:
      "Fewer exposed tools restricts available operations; full remains the compatibility default. Host framing, tool deferral, caching, repeated schemas, reasoning, task completion and paid tokens are not measured.",
  };
  writeFileSync(
    process.argv[2] ?? "benchmarks/reports/tool-profiles.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} finally {
  rmSync(root, { recursive: true, force: true });
}
