#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./index.js";
try {
  const args = process.argv.slice(2);
  if (args.length > 1)
    throw new Error("Usage: pgraph-mcp [repository-root]");
  const { server } = createServer(args[0] ?? process.cwd());
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
