import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { EngineClient } from "./client.js";
import type { GraphStats, SemanticInput } from "@praesidia/pgraph-core";

interface ToolManifest {
  name: string;
  description: string;
}
class Overview implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private stats: GraphStats | undefined;
  private recent = "Ready to index";
  update(stats?: GraphStats, message?: string): void {
    this.stats = stats;
    this.recent = message ?? this.recent;
    this.changed.fire();
  }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }
  getChildren(): vscode.TreeItem[] {
    const rows: [string, string, string?][] = [
      [
        "Index health",
        this.stats?.revision ? "Indexed" : "Not indexed",
        "status",
      ],
      ["Files", String(this.stats?.files ?? 0)],
      ["Symbols", String(this.stats?.nodes ?? 0), "symbol"],
      ["Relationships", String(this.stats?.edges ?? 0), "architecture"],
      [
        "Features and concepts",
        "Explore architecture / semantic index",
        "architecture",
      ],
      ["Current task", "Find relevant context", "context"],
      ["Token savings", "Repository-context estimates", "savings"],
      ["Recent indexing", this.recent, "reindex"],
    ];
    return rows.map(([name, description, command]) => {
      const item = new vscode.TreeItem(name);
      item.description = description;
      if (command) item.command = { command: `pgraph.${command}`, title: name };
      return item;
    });
  }
}
export function activate(context: vscode.ExtensionContext): {
  request: (name: string, input: unknown) => Promise<string>;
} {
  const output = vscode.window.createOutputChannel("PGraph");
  context.subscriptions.push(output);
  const clients = new Map<string, EngineClient>();
  const overview = new Overview();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("pgraph.overview", overview),
  );
  const client = async (): Promise<EngineClient> => {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust the workspace before using PGraph");
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length)
      throw new Error("Open a local repository folder first");
    const editor = vscode.window.activeTextEditor;
    let folder = editor
      ? vscode.workspace.getWorkspaceFolder(editor.document.uri)
      : undefined;
    folder ??=
      folders.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick({
            placeHolder: "Choose the repository to query",
          });
    if (!folder) throw new vscode.CancellationError();
    if (folder.uri.scheme !== "file")
      throw new Error("PGraph requires a local filesystem workspace");
    let engine = clients.get(folder.uri.fsPath);
    if (!engine) {
      engine = new EngineClient(
        folder.uri.fsPath,
        context.asAbsolutePath("dist/worker.cjs"),
        output,
      );
      clients.set(folder.uri.fsPath, engine);
      context.subscriptions.push(engine);
    }
    return engine;
  };
  const show = async (text: string, language = "markdown"): Promise<void> => {
    const document = await vscode.workspace.openTextDocument({
      content: text,
      language,
    });
    await vscode.window.showTextDocument(document, { preview: true });
  };
  const request = async (
    name: string,
    input: unknown,
    token?: vscode.CancellationToken,
  ): Promise<string> => {
    const engine = await client();
    return engine.request<string>("tool", { name, input }, token);
  };
  const refresh = async (): Promise<void> => {
    const text = await request("status", {});
    overview.update(JSON.parse(text) as GraphStats);
  };
  const command = (
    name: string,
    handler: (arg?: string) => Promise<unknown>,
  ): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `pgraph.${name}`,
        async (arg?: string) => {
          try {
            return await handler(arg);
          } catch (error) {
            if (!(error instanceof vscode.CancellationError))
              void vscode.window.showErrorMessage(
                `PGraph: ${error instanceof Error ? error.message : String(error)}`,
              );
            throw error;
          }
        },
      ),
    );
  };
  const index = async (): Promise<unknown> =>
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "PGraph: indexing repository",
        cancellable: true,
      },
      async (_progress, token) => {
        const result = await (
          await client()
        ).request<{ durationMs: number; parsed: number }>("index", {}, token);
        await refresh();
        overview.update(
          undefined,
          `${result.parsed} files / ${result.durationMs} ms`,
        );
        await refresh();
        return result;
      },
    );
  command("initialize", async () => {
    await (await client()).request("init");
    return index();
  });
  command("index", index);
  command("reindex", index);
  command("status", async () => {
    const text = await request("status", {});
    await show(text, "json");
    return JSON.parse(text);
  });
  command("architecture", async () => {
    const text = await request("architecture", {});
    await show(text, "json");
    return text;
  });
  for (const name of ["symbol", "callers", "callees", "impact"])
    command(name, async (arg) => {
      const symbol =
        arg ??
        (await vscode.window.showInputBox({
          prompt: "Symbol name (e.g. AuthService.login)",
        }));
      if (!symbol) return;
      const text = await request(name, { symbol });
      await show(text, "json");
      return text;
    });
  command("context", async (arg) => {
    const task =
      arg ??
      (await vscode.window.showInputBox({
        prompt: "What are you trying to change or understand?",
      }));
    if (!task) return;
    const text = await request("context", {
      task,
      maxTokens: 2000,
      format: "markdown",
    });
    await show(text);
    return text;
  });
  command("savings", async () => {
    const metrics = await (await client()).request("metrics");
    await show(JSON.stringify(metrics, null, 2), "json");
    return metrics;
  });
  command("semantic", async (arg) => {
    if (
      !vscode.workspace
        .getConfiguration("pgraph")
        .get<boolean>("semanticEnabled")
    )
      throw new Error(
        "Enable PGraph: Semantic Enabled in user settings to allow this explicit Copilot action",
      );
    const symbol =
      arg ??
      (await vscode.window.showInputBox({
        prompt:
          "Symbol/module to enrich through Copilot (compact skeleton and graph only)",
      }));
    if (!symbol) return;
    const engine = await client();
    const evidence = await engine.request<{
      input: SemanticInput;
      prompt: string;
    }>("semanticInput", { symbol });
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    if (!models.length)
      throw new Error(
        "No Copilot model is available. Sign in to GitHub Copilot and check organization policy.",
      );
    const model =
      models.length === 1
        ? models[0]
        : await vscode.window
            .showQuickPick(
              models.map((m) => ({
                label: m.name,
                description: m.id,
                model: m,
              })),
            )
            .then((m) => m?.model);
    if (!model) return;
    if (
      (await model.countTokens(evidence.prompt)) >
      Math.min(4000, model.maxInputTokens - 1000)
    )
      throw new Error(
        "Semantic evidence exceeds the model input budget; choose a smaller symbol",
      );
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "PGraph: enriching through Copilot",
        cancellable: true,
      },
      async (_p, token) => {
        const response = await model.sendRequest(
          [vscode.LanguageModelChatMessage.User(evidence.prompt)],
          {},
          token,
        );
        let raw = "";
        for await (const part of response.text) {
          raw += part;
          if (raw.length > 20000)
            throw new Error("Semantic response too large");
        }
        const fact = await engine.request(
          "semanticAccept",
          { raw, input: evidence.input },
          token,
        );
        await show(JSON.stringify(fact, null, 2), "json");
        return fact;
      },
    );
  });
  const manifest = JSON.parse(
    readFileSync(context.asAbsolutePath("tools.json"), "utf8"),
  ) as ToolManifest[];
  for (const tool of manifest)
    context.subscriptions.push(
      vscode.lm.registerTool<Record<string, unknown>>(`pgraph_${tool.name}`, {
        async invoke(options, token) {
          let input = { ...options.input };
          const modelBudget = options.tokenizationOptions?.tokenBudget;
          if (modelBudget !== undefined) {
            if (modelBudget < 128)
              return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                  "PGraph needs at least 128 output tokens.",
                ),
              ]);
            input.maxTokens = Math.min(
              Number(input.maxTokens ?? 2000),
              modelBudget,
            );
          }
          let text = await request(tool.name, input, token);
          if (options.tokenizationOptions) {
            for (let retry = 0; retry < 3; retry++) {
              const actual = await options.tokenizationOptions.countTokens(
                text,
                token,
              );
              if (actual <= options.tokenizationOptions.tokenBudget) break;
              input = {
                ...input,
                maxTokens: Math.floor(
                  ((Number(input.maxTokens ?? 2000) *
                    options.tokenizationOptions.tokenBudget) /
                    actual) *
                    0.9,
                ),
              };
              if (Number(input.maxTokens) < 128) {
                text =
                  "PGraph result exceeds this model’s output budget. Increase the budget or narrow the request.";
                break;
              }
              text = await request(tool.name, input, token);
            }
            if (
              (await options.tokenizationOptions.countTokens(text, token)) >
              options.tokenizationOptions.tokenBudget
            )
              text = "";
          }
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(text),
          ]);
        },
        prepareInvocation() {
          return {
            invocationMessage: `PGraph: ${tool.name} (local repository)`,
          };
        },
      }),
    );
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs,json}",
  );
  context.subscriptions.push(watcher);
  const changed = (uri: vscode.Uri): void => {
    if (
      /\/(node_modules|\.pgraph|dist|build|\.next|coverage)\//.test(uri.path) ||
      !vscode.workspace.getConfiguration("pgraph").get<boolean>("autoIndex")
    )
      return;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return;
    const engine = clients.get(folder.uri.fsPath);
    if (!engine) return;
    clearTimeout(timers.get(folder.uri.fsPath));
    timers.set(
      folder.uri.fsPath,
      setTimeout(() => {
        void engine
          .request<string>("tool", { name: "status", input: {} })
          .then((text) => {
            if ((JSON.parse(text) as GraphStats).revision)
              return engine.request("index").then(() => refresh());
            return undefined;
          })
          .catch((error) => output.appendLine(String(error)));
      }, 400),
    );
  };
  context.subscriptions.push(
    watcher.onDidChange(changed),
    watcher.onDidCreate(changed),
    watcher.onDidDelete(changed),
    {
      dispose() {
        for (const timer of timers.values()) clearTimeout(timer);
      },
    },
  );
  return { request };
}
