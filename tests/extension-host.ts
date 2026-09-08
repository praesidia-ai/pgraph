import * as vscode from "vscode";
import assert from "node:assert/strict";

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
  const extension = vscode.extensions.getExtension("praesidia.pgraph");
  assert.ok(extension, "Development extension is present");
  const api = (await extension.activate()) as {
    request: (name: string, input: unknown) => Promise<string>;
  };
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
  console.log(
    "PGraph extension-host workflow passed: activation, sidebar, indexing, LM tool, context document, metrics, incremental update.",
  );
}
