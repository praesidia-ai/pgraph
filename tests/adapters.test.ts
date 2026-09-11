import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, cpSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PGraph, bpeCounter } from "@praesidia/pgraph-core";
import {
  dispatchTool,
  toolDefinitions,
  toolJsonSchema,
  essentialToolNames,
} from "@praesidia/pgraph-tools";
import { runCli } from "@praesidia/pgraph-cli";
import { runBenchmark } from "@praesidia/pgraph-benchmark";

const roots: string[] = [];
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "pgraph-adapter-"));
  roots.push(root);
  cpSync(resolve("examples/sample-typescript-app"), root, {
    recursive: true,
    filter: (p) => !p.includes(".pgraph"),
  });
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("consumer adapters", () => {
  it("runs actual CLI processes against persistent storage", () => {
    expect(runCli(["--version"])).toBe("0.6.1");
    const root = fixture();
    const cli = resolve("packages/graph-cli/dist/main.js");
    const run = (args: string[]) =>
      execFileSync(process.execPath, [cli, ...args, "--root", root], {
        encoding: "utf8",
      });
    expect(JSON.parse(run(["index"])).nodes).toBeGreaterThan(30);
    expect(JSON.parse(run(["symbol", "AuthService.login"])).symbol).toBe(
      "AuthService.login",
    );
    expect(run(["callers", "AuthService.login"])).toContain(
      "AuthController.login",
    );
    const text = run([
      "context",
      "Add account lockout to login",
      "--tokens",
      "1500",
      "--json",
    ]).trim();
    expect(bpeCounter.count(text)).toBeLessThanOrEqual(1500);
    expect(JSON.parse(run(["index", "--changed"])).parsed).toBe(0);
    expect(() => runCli(["symbol", "missing", "--root", root])).toThrow(
      "not found",
    );
    expect(() => runCli(["status", "--no-such-option"])).toThrow();
  });
  it("validates schemas and keeps every tool output bounded", () => {
    const root = fixture();
    const graph = PGraph.open(root);
    try {
      graph.index();
      const inputs: Record<string, unknown> = {
        workflow: { action: "health" },
        context: { task: "Find login" },
        search: { query: "login" },
        symbol: { symbol: "AuthService.login" },
        path: { from: "AuthController.login", to: "TokenService.issue" },
        feature: { concept: "login" },
        status: {},
        architecture: {},
        file_slice: { file: "src/auth.service.ts", startLine: 6, endLine: 12 },
      };
      for (const tool of toolDefinitions) {
        if (tool.name === "review_changes") {
          expect(() => dispatchTool(graph, tool.name, {})).toThrow(
            "not a Git repository",
          );
          expect(toolJsonSchema(tool.name).type).toBe("object");
          continue;
        }
        const input = {
          ...((inputs[tool.name] ?? { symbol: "AuthService.login" }) as object),
          maxTokens: 500,
        };
        const result = dispatchTool(graph, tool.name, input);
        expect(bpeCounter.count(result), tool.name).toBeLessThanOrEqual(500);
        expect(toolJsonSchema(tool.name).type).toBe("object");
      }
      expect(() =>
        dispatchTool(graph, "slice", {
          symbol: "AuthService.login",
          root: "/etc",
        }),
      ).toThrow();
      expect(() =>
        dispatchTool(graph, "context", { task: "x", maxTokens: 1 }),
      ).toThrow();
    } finally {
      graph.close();
    }
  });
  it("negotiates real MCP stdio, lists tools and performs a query", async () => {
    const root = fixture();
    const graph = PGraph.open(root);
    graph.index();
    graph.close();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("packages/graph-mcp/dist/main.js"), root],
      stderr: "pipe",
    });
    const client = new Client({ name: "pgraph-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const list = await client.listTools();
      expect(list.tools.map((t) => t.name)).toContain("context");
      expect(
        list.tools.every(
          (t) =>
            !Object.hasOwn(t.inputSchema.properties ?? {}, "project") &&
            !Object.hasOwn(t.inputSchema.properties ?? {}, "workspace"),
        ),
      ).toBe(true);
      const result = await client.callTool({
        name: "callers",
        arguments: { symbol: "AuthService.login" },
      });
      expect(JSON.stringify(result.content)).toContain("AuthController.login");
      const invalid = await client.callTool({
        name: "context",
        arguments: { task: "login", maxTokens: -1 },
      });
      expect(invalid.isError).toBe(true);
      const unknownArgument = await client.callTool({
        name: "context",
        arguments: { task: "login", root: "/etc" },
      });
      expect(unknownArgument.isError).toBe(true);
      const editorRouting = await client.callTool({
        name: "context",
        arguments: { task: "login", project: "a".repeat(24) },
      });
      expect(editorRouting.isError).toBe(true);
      const workspaceImpact = await client.callTool({
        name: "impact",
        arguments: { symbol: "AuthService.login", workspace: true },
      });
      expect(workspaceImpact.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
  it("limits MCP discovery and calls to the selected profile without changing evidence", async () => {
    const root = fixture();
    const graph = PGraph.open(root);
    graph.index();
    const input = { symbol: "AuthService.login", maxTokens: 500 };
    const expected = dispatchTool(graph, "impact", input);
    graph.close();
    const client = new Client({
      name: "pgraph-profile-test",
      version: "1.0.0",
    });
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [
            resolve("packages/graph-mcp/dist/main.js"),
            "--tool-profile",
            "essential",
            root,
          ],
          stderr: "pipe",
        }),
      );
      const list = await client.listTools();
      expect(list.tools.map((t) => t.name).sort()).toEqual(
        [...essentialToolNames].sort(),
      );
      const result = await client.callTool({
        name: "impact",
        arguments: input,
      });
      expect(result.content).toEqual([{ type: "text", text: expected }]);
      const unavailable = await client
        .callTool({
          name: "callers",
          arguments: { symbol: "AuthService.login" },
        })
        .then(
          (r) => r.isError === true,
          (e: Error) => /not found|unknown/i.test(e.message),
        );
      expect(unavailable).toBe(true);
      const invalid = await client.callTool({
        name: "context",
        arguments: { task: "login", root: "/etc" },
      });
      expect(invalid.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
  it("rejects invalid MCP profiles and options before opening repository storage", () => {
    const root = fixture();
    for (const flags of [
      ["--tool-profile", "typo"],
      ["--unknown"],
      ["extra-root"],
    ]) {
      const result = spawnSync(
        process.execPath,
        [resolve("packages/graph-mcp/dist/main.js"), root, ...flags],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/profile|option|Usage/);
      expect(existsSync(join(root, ".pgraph"))).toBe(false);
    }
  });
  it("reports measured tokens separately from untested task correctness", () => {
    const root = fixture();
    const result = runBenchmark(root, [
      {
        id: "locate",
        category: "find",
        task: "Where is TokenService.issue?",
        baselineFiles: [
          "src/auth.controller.ts",
          "src/auth.service.ts",
          "src/token.service.ts",
        ],
        baselineSearchCalls: 2,
        requiredSymbols: ["TokenService.issue"],
        maxTokens: 500,
      },
    ]);
    expect(result.results[0]?.requiredSymbolRecall).toBe(1);
    expect(result.results[0]?.taskCorrectness).toBeNull();
    expect(result.summary.correctnessEvaluated).toBe(false);
  });
});
