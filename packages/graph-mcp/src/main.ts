#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./index.js";
import { parseArgs } from "node:util";
try {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { "tool-profile": { type: "string", default: "full" } },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 1)
    throw new Error(
      "Usage: pgraph-mcp [repository-root] [--tool-profile full|essential]",
    );
  const profile = values["tool-profile"];
  if (profile !== "full" && profile !== "essential")
    throw new Error("Unknown tool profile; choose full or essential");
  const { server } = createServer(positionals[0] ?? process.cwd(), {
    toolProfile: profile,
  });
  await server.connect(new StdioServerTransport());
  const shutdown = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
