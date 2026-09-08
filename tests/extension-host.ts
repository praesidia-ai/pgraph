import * as vscode from "vscode";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineClient } from "../apps/vscode-extension/src/client.js";

export async function run(): Promise<void> {
  await vscode.workspace
    .getConfiguration("pgraph")
    .update(
      "nodePath",
      process.env.PGRAPH_TEST_NODE,
      vscode.ConfigurationTarget.Global,
    );
  await vscode.workspace
    .getConfiguration("pgraph")
    .update("autoIndex", false, vscode.ConfigurationTarget.Global);
  assert.equal(
    vscode.workspace.workspaceFolders?.length,
    2,
    "Test two open microservice repositories",
  );
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders![0]!.uri,
        "src/auth.service.ts",
      ),
    ),
  );
  const extension = vscode.extensions.getExtension("praesidia.pgraph");
  assert.ok(extension, "Development extension is present");
  const api = (await extension.activate()) as {
    request: (name: string, input: unknown) => Promise<string>;
  };
  // Reproduce a machine whose editor cannot find Node, then recover without reload.
  await vscode.workspace
    .getConfiguration("pgraph")
    .update(
      "nodePath",
      vscode.Uri.joinPath(extension.extensionUri, "missing-node-executable")
        .fsPath,
      vscode.ConfigurationTarget.Global,
    );
  await assert.rejects(api.request("status", {}), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /VS Code cannot find Node\.js/);
    assert.ok(error.message.includes('node -p "process.execPath"'));
    return true;
  });
  await vscode.workspace
    .getConfiguration("pgraph")
    .update(
      "nodePath",
      process.env.PGRAPH_TEST_NODE,
      vscode.ConfigurationTarget.Global,
    );
  const indexed = await vscode.commands.executeCommand<{ nodes: number }>(
    "pgraph.index",
  );
  assert.ok(indexed && indexed.nodes > 30, "Real worker indexed fixture");
  const symbol = JSON.parse(
    await api.request("symbol", { symbol: "AuthService.login" }),
  );
  assert.equal(symbol.symbol, "AuthService.login");
  const result = await vscode.lm.invokeTool(
    "pgraph_callers",
    {
      input: { symbol: "AuthService.login", maxTokens: 1000 },
      toolInvocationToken: undefined,
    },
    new vscode.CancellationTokenSource().token,
  );
  assert.ok(
    result.content.some(
      (part) =>
        part instanceof vscode.LanguageModelTextPart &&
        part.value.includes("AuthController.login"),
    ),
    "Registered LM tool invokes worker",
  );
  await vscode.commands.executeCommand(
    "pgraph.context",
    "Add account lockout to login",
  );
  assert.ok(
    vscode.window.activeTextEditor?.document
      .getText()
      .includes("PGraph context"),
    "Context opens in actual editor",
  );
  const savings = await vscode.commands.executeCommand<{
    contextTokens: number;
  }>("pgraph.savings");
  assert.ok(savings && savings.contextTokens > 0);
  assert.ok(vscode.lm.tools.some((t) => t.name === "pgraph_context"));
  const noChange = await vscode.commands.executeCommand<{ parsed: number }>(
    "pgraph.reindex",
  );
  assert.equal(noChange?.parsed, 0);
  const [workspaceResult, duplicateRun] = await Promise.all([
    vscode.commands.executeCommand<{
      indexed: number;
      failed: number;
      roots: { result?: { nodes: number } }[];
    }>("pgraph.indexWorkspace"),
    vscode.commands.executeCommand("pgraph.indexWorkspace"),
  ]);
  assert.deepEqual(
    duplicateRun,
    workspaceResult,
    "Repeated workspace commands share the current run",
  );
  assert.equal(workspaceResult?.indexed, 2);
  assert.equal(workspaceResult?.failed, 0);
  assert.ok(
    workspaceResult.roots.every((root) => root.result && root.result.nodes > 0),
  );
  for (const folder of vscode.workspace.workspaceFolders!)
    assert.ok(
      existsSync(join(folder.uri.fsPath, ".pgraph/graph.db")),
      "Every open root has its own persistent graph",
    );
  const afterRelease = JSON.parse(
    await api.request("symbol", { symbol: "AuthService.login" }),
  );
  assert.equal(
    afterRelease.symbol,
    "AuthService.login",
    "Released workers restart for later queries",
  );
  const testRoot = mkdtempSync(join(tmpdir(), "pgraph-timeouts-"));
  const worker = join(testRoot, "worker.cjs");
  writeFileSync(
    worker,
    `process.on("message", m => {
    if (m.op === "index") process.send({id: m.id, progress: {phase: "analyze", message: "Analyzing fixture"}});
    setTimeout(() => process.send({ id: m.id, result: m.op }), m.op === "index" ? 3200 : (m.args.delay || 0));
  });`,
  );
  const output = vscode.window.createOutputChannel("PGraph timeout test");
  const queuedClient = new EngineClient(testRoot, worker, output);
  const queuedCancellation = new vscode.CancellationTokenSource();
  try {
    await vscode.workspace
      .getConfiguration("pgraph")
      .update("indexTimeoutSeconds", 10, vscode.ConfigurationTarget.Global);
    await vscode.workspace
      .getConfiguration("pgraph")
      .update("queryTimeoutSeconds", 2, vscode.ConfigurationTarget.Global);
    const phases: string[] = [];
    const indexing = queuedClient.request("index", {}, undefined, (update) =>
      phases.push(update.message),
    );
    const waitingQuery = queuedClient.request("tool");
    const cancelled = queuedClient.request(
      "tool",
      {},
      queuedCancellation.token,
    );
    queuedCancellation.cancel();
    await assert.rejects(
      cancelled,
      (error) => error instanceof vscode.CancellationError,
    );
    assert.equal(await indexing, "index");
    assert.deepEqual(
      phases,
      ["Analyzing fixture"],
      "Progress must not resolve the request before indexing completes",
    );
    assert.equal(
      await waitingQuery,
      "tool",
      "A queued query must survive waiting longer than its execution timeout",
    );
    await assert.rejects(
      queuedClient.request("tool", { delay: 4000 }),
      /query exceeded 2 seconds/,
    );
    assert.equal(
      await queuedClient.request("tool"),
      "tool",
      "Worker restarts after a real timeout",
    );
  } finally {
    queuedClient.dispose();
    queuedCancellation.dispose();
    output.dispose();
    rmSync(testRoot, { recursive: true, force: true });
    await vscode.workspace
      .getConfiguration("pgraph")
      .update(
        "indexTimeoutSeconds",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    await vscode.workspace
      .getConfiguration("pgraph")
      .update(
        "queryTimeoutSeconds",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
  }
  console.log(
    "PGraph extension-host workflow passed: multi-root indexing, per-project progress, long indexing, queued query/cancellation, timeout recovery, missing Node recovery, activation, sidebar, indexing, LM tool, context document, metrics, incremental update.",
  );
}
