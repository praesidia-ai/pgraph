import { RelationshipExplorer } from "./explorer.js";
import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { EngineClient, NodeLaunchError } from "./client.js";
import type {
  GraphStats,
  ExplorerGraph,
  RepositoryTopology,
  SemanticInput,
  IndexResult,
} from "@praesidia/pgraph-core";

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
  updateRecent(message: string): void {
    this.recent = message;
    this.changed.fire();
  }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }
  getChildren(): vscode.TreeItem[] {
    const rows: [string, string, string?][] = [
      ["Workspace", "Index all open folders", "indexWorkspace"],
      ["Service map", "Explore relationships", "explore"],
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
  let selectedFolder: vscode.WorkspaceFolder | undefined;
  let explorer: RelationshipExplorer | undefined;
  const explorerRoots = new Map<string, vscode.WorkspaceFolder>();
  const engineFor = (folder: vscode.WorkspaceFolder): EngineClient => {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust the workspace before using PGraph");
    if (
      !vscode.workspace.workspaceFolders?.some(
        (current) => current.uri.toString() === folder.uri.toString(),
      )
    )
      throw new Error("Repository is no longer open in the workspace");
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
    folder ??= selectedFolder;
    folder ??=
      folders.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick({
            placeHolder: "Choose the repository to query",
          });
    if (!folder) throw new vscode.CancellationError();
    selectedFolder = folder;
    return engineFor(folder);
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
              void vscode.window
                .showErrorMessage(
                  `PGraph: ${error instanceof Error ? error.message : String(error)}`,
                  ...(error instanceof NodeLaunchError
                    ? ["Open Node Settings"]
                    : []),
                )
                .then((action) => {
                  if (action === "Open Node Settings")
                    return vscode.commands.executeCommand(
                      "workbench.action.openSettings",
                      "@id:pgraph.nodePath",
                    );
                });
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
      async (progress, token) => {
        const started = performance.now();
        let phase = "Waiting to index";
        const elapsed = setInterval(() => {
          const seconds = Math.floor((performance.now() - started) / 1000);
          progress.report({
            message: `${phase} — ${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`,
          });
        }, 1000);
        try {
          const result = await (
            await client()
          ).request<{ durationMs: number; parsed: number }>(
            "index",
            {},
            token,
            (update) => {
              phase = update.message;
              progress.report({ message: phase });
            },
          );
          await refresh();
          overview.update(
            undefined,
            `${result.parsed} files / ${result.durationMs} ms`,
          );
          await refresh();
          return result;
        } finally {
          clearInterval(elapsed);
        }
      },
    );
  command("initialize", async () => {
    await (await client()).request("init");
    return index();
  });
  command("index", index);
  command("reindex", index);
  const indexWorkspace = async (): Promise<unknown> => {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust the workspace before using PGraph");
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) throw new Error("Open repository folders first");
    const results: {
      root: string;
      name: string;
      result?: IndexResult;
      error?: string;
    }[] = [];
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "PGraph: indexing workspace",
        cancellable: true,
      },
      async (progress, token) => {
        const started = performance.now();
        let phase = "Preparing repositories";
        const elapsed = setInterval(
          () =>
            progress.report({
              message: `${phase} — ${Math.floor((performance.now() - started) / 1000)}s elapsed`,
            }),
          1000,
        );
        try {
          for (const [i, folder] of folders.entries()) {
            if (token.isCancellationRequested)
              throw new vscode.CancellationError();
            phase = `${i + 1}/${folders.length}: ${folder.name}`;
            progress.report({ message: phase });
            let engine: EngineClient | undefined;
            try {
              engine = engineFor(folder);
              const result = await engine.request<IndexResult>(
                "index",
                {},
                token,
                (update) => {
                  phase = `${i + 1}/${folders.length}: ${folder.name} — ${update.message}`;
                  progress.report({ message: phase });
                },
              );
              results.push({
                root: folder.uri.toString(),
                name: folder.name,
                result,
              });
            } catch (error) {
              if (
                error instanceof vscode.CancellationError ||
                token.isCancellationRequested ||
                error instanceof NodeLaunchError
              )
                throw error;
              results.push({
                root: folder.uri.toString(),
                name: folder.name,
                error: error instanceof Error ? error.message : String(error),
              });
            } finally {
              // Avoid retaining a compiler process for every microservice in a large workspace.
              engine?.releaseIdle();
            }
          }
        } finally {
          clearInterval(elapsed);
        }
      },
    );
    const summary = {
      indexed: results.filter((root) => root.result).length,
      failed: results.filter((root) => root.error).length,
      roots: results,
    };
    overview.updateRecent(
      `${summary.indexed}/${folders.length} workspace folders indexed; ${summary.failed} failed`,
    );
    await show(JSON.stringify(summary, null, 2), "json");
    return summary;
  };
  let workspaceRun: Promise<unknown> | undefined;
  command("indexWorkspace", () => {
    workspaceRun ??= indexWorkspace().finally(() => {
      workspaceRun = undefined;
    });
    return workspaceRun;
  });
  const workspaceGraph = async (): Promise<ExplorerGraph> => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) throw new Error("Open repository folders first");
    if (folders.length > 64)
      throw new Error("Select up to 64 workspace roots for this map");
    const snapshots: RepositoryTopology[] = [];
    const warnings: string[] = [];
    explorerRoots.clear();
    for (const folder of folders) {
      let engine: EngineClient | undefined;
      try {
        engine = engineFor(folder);
        const snapshot = await engine.request<RepositoryTopology>("topology");
        if (explorerRoots.has(snapshot.rootId)) {
          warnings.push(`${folder.name}: duplicate repository root skipped`);
          continue;
        }
        explorerRoots.set(snapshot.rootId, folder);
        snapshots.push(snapshot);
      } catch (error) {
        if (error instanceof NodeLaunchError) throw error;
        warnings.push(
          `${folder.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        engine?.releaseIdle();
      }
    }
    const first = snapshots[0];
    if (!first)
      throw new Error(warnings.join("; ") || "No local indexed repositories");
    const engine = engineFor(explorerRoots.get(first.rootId)!);
    try {
      const result = await engine.request<ExplorerGraph>("workspaceGraph", {
        snapshots,
      });
      result.warnings.push(...warnings);
      return result;
    } finally {
      engine.releaseIdle();
    }
  };
  command("explore", async () => {
    if (explorer) {
      explorer.panel.reveal();
      return;
    }
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust the workspace before using PGraph");
    explorer = new RelationshipExplorer(context.extensionUri, {
      workspace: workspaceGraph,
      relationships: async (rootId, options) => {
        const folder = explorerRoots.get(rootId);
        if (!folder) throw new Error("Refresh the service map first");
        return engineFor(folder).request<ExplorerGraph>(
          "relationships",
          options,
        );
      },
      open: async (rootId, symbol, revision, line) => {
        const folder = explorerRoots.get(rootId);
        if (!folder) throw new Error("Repository is no longer in this view");
        const source = await engineFor(folder).request<{
          path: string;
          line: number;
        }>("sourceLocation", { symbol, revision, line });
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(source.path),
        );
        if (document.isDirty)
          throw new Error(
            "Save and reindex this source before opening indexed evidence",
          );
        await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.Beside,
          selection: new vscode.Range(source.line - 1, 0, source.line - 1, 0),
        });
      },
    });
    const current = explorer;
    current.panel.onDidDispose(() => {
      if (explorer === current) explorer = undefined;
    });
    context.subscriptions.push(current);
  });
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (
        event.document.uri.scheme === "file" &&
        vscode.workspace.getWorkspaceFolder(event.document.uri)
      )
        explorer?.markStale();
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => explorer?.markStale()),
  );
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
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const folder of event.removed) {
        clients.get(folder.uri.fsPath)?.dispose();
        clients.delete(folder.uri.fsPath);
        if (selectedFolder?.uri.toString() === folder.uri.toString())
          selectedFolder = undefined;
      }
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
