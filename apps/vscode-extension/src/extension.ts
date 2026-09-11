import { RelationshipExplorer } from "./explorer.js";
import { registerDaily } from "./daily.js";
import { discoverProjects, containsPath } from "./projects.js";
import { requestWorkspaceContext } from "./workspace-context.js";
import { requestWorkspaceImpact } from "./workspace-impact.js";
import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { EngineClient, NodeLaunchError } from "./client.js";
import type {
  GraphStats,
  GraphNode,
  ExplorerGraph,
  RepositoryTopology,
  SemanticInput,
  IndexResult,
  ChangeReview,
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
  private scope = "Choose project or workspace";
  updateScope(scope: string): void {
    this.scope = scope;
    this.changed.fire();
  }
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
      ["Scope", this.scope, "chooseScope"],
      ["Daily workflow", "Find, understand and verify", "daily"],
      [
        "Changed declarations",
        "Focus the review on edited code",
        "changedDeclarations",
      ],
      ["Verification", "Run checks and inspect results", "runCheck"],
      ["Resume work", "Saved investigations", "resumeInvestigation"],
      ["Workspace", "Index all open folders", "indexWorkspace"],
      ["Service map", "Explore relationships", "explore"],
      ["Connection mappings", "Find missing settings", "connections"],
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
      ["Current symbol", "Context at cursor", "contextHere"],
      [
        "Workspace impact",
        "Trace this symbol across services",
        "workspaceImpactHere",
      ],
      ["My changes", "Affected code and candidate tests", "reviewChanges"],
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
  projects: () => { name: string; root: string }[];
} {
  const output = vscode.window.createOutputChannel("PGraph");
  context.subscriptions.push(output);
  const clients = new Map<string, EngineClient>();
  const overview = new Overview();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("pgraph.overview", overview),
  );
  let selectedFolder: vscode.WorkspaceFolder | undefined;
  let discovery: ReturnType<typeof discoverProjects> | undefined;
  const scopeChanged = new vscode.EventEmitter<void>();
  context.subscriptions.push(scopeChanged);
  let scope = context.workspaceState.get<"project" | "workspace">(
    "pgraph.scope",
  );
  let pinnedProject = context.workspaceState.get<string>("pgraph.project");
  const projects = (): (vscode.WorkspaceFolder & { project: string })[] => {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust the workspace before using PGraph");
    discovery ??= discoverProjects(
      (vscode.workspace.workspaceFolders ?? [])
        .filter((f) => f.uri.scheme === "file")
        .map((f) => ({ name: f.name, path: f.uri.fsPath })),
    );
    return discovery.projects.map((p, index) => ({
      name: p.name,
      project: p.project,
      uri: vscode.Uri.file(p.path),
      index,
    }));
  };
  const discoveryWarnings = () => discovery?.warnings ?? [];
  const projectAt = (uri: vscode.Uri): vscode.WorkspaceFolder | undefined =>
    uri.scheme === "file"
      ? projects()
          .filter((p) => containsPath(p.uri.fsPath, uri.fsPath))
          .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)[0]
      : undefined;
  const workspaceScope = () =>
    (scope ?? (projects().length > 1 ? "workspace" : "project")) ===
    "workspace";
  const scopeLabel = () =>
    workspaceScope()
      ? `Workspace · ${projects().length} projects`
      : `Project · ${projects().find((p) => p.uri.toString() === pinnedProject)?.name ?? selectedFolder?.name ?? projects()[0]?.name ?? "Choose project"}`;
  let explorer: RelationshipExplorer | undefined;
  const explorerRoots = new Map<string, vscode.WorkspaceFolder>();
  const engineFor = (folder: vscode.WorkspaceFolder): EngineClient => {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust the workspace before using PGraph");
    if (
      !vscode.workspace.getWorkspaceFolder(folder.uri) ||
      !projects().some(
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
    const folders = projects();
    if (!folders?.length)
      throw new Error("Open a local repository folder first");
    const editor = vscode.window.activeTextEditor;
    let folder: vscode.WorkspaceFolder | undefined =
      scope === "project"
        ? folders.find((p) => p.uri.toString() === pinnedProject)
        : undefined;
    folder ??= editor ? projectAt(editor.document.uri) : undefined;
    if (
      selectedFolder &&
      !folders.some((p) => p.uri.toString() === selectedFolder!.uri.toString())
    )
      selectedFolder = undefined;
    folder ??= selectedFolder;
    folder ??=
      folders.length === 1
        ? folders[0]
        : (
            await vscode.window.showQuickPick(
              folders.map((project) => ({
                label: project.name,
                description: project.uri.fsPath,
                project,
              })),
              {
                placeHolder:
                  "Choose the project for this symbol or source query",
              },
            )
          )?.project;
    if (!folder) throw new vscode.CancellationError();
    selectedFolder = folder;
    overview.updateScope(scopeLabel());
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
    if (
      name === "impact" &&
      input &&
      typeof input === "object" &&
      (input as Record<string, unknown>).workspace === true
    )
      return requestWorkspaceImpact(
        projects(),
        engineFor,
        input,
        discoveryWarnings(),
        token,
      );
    const project =
      input && typeof input === "object"
        ? (input as Record<string, unknown>).project
        : undefined;
    if (project !== undefined) {
      const folder = projects().find((p) => p.project === project);
      if (!folder)
        throw new Error(
          "Unknown or closed project. Get a current project ID from workspace context or Choose Scope.",
        );
      return requestFrom(engineFor(folder), name, input, token);
    }
    if (name === "context" && workspaceScope())
      return requestWorkspaceContext(
        projects(),
        engineFor,
        input,
        discoveryWarnings(),
        token,
      );
    const engine = await client();
    return requestFrom(engine, name, input, token);
  };
  const requestFrom = (
    engine: EngineClient,
    name: string,
    input: unknown,
    token?: vscode.CancellationToken,
  ): Promise<string> => {
    if (["context", "feature"].includes(name))
      input = {
        ...(input as Record<string, unknown>),
        evidenceMode: vscode.workspace
          .getConfiguration("pgraph")
          .get<string>("evidenceMode", "local"),
      };
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
  registerDaily(context, {
    client,
    folder: () => selectedFolder,
    command,
    show,
    projects,
    engineFor,
    workspaceScope,
    scopeLabel,
    onScopeChanged: scopeChanged.event,
    projectAt,
    warnings: discoveryWarnings,
    rememberProject: (folder) => {
      selectedFolder = folder;
      overview.updateScope(scopeLabel());
    },
  });
  command("chooseScope", async (arg) => {
    const available = projects();
    const choice =
      arg ??
      (
        await vscode.window.showQuickPick(
          [
            {
              label: "Workspace",
              description: `Query all ${available.length} detected projects`,
              value: "workspace",
            },
            ...available.map((p) => ({
              label: p.name,
              description: p.uri.fsPath,
              value: p.uri.toString(),
            })),
          ],
          { placeHolder: "Use the whole workspace or pin one project" },
        )
      )?.value;
    if (!choice) return;
    if (choice === "workspace") {
      scope = "workspace";
      pinnedProject = undefined;
    } else {
      const project = available.find((p) => p.uri.toString() === choice);
      if (!project)
        throw new Error(
          "Choose a project currently detected in this workspace",
        );
      scope = "project";
      pinnedProject = choice;
      selectedFolder = project;
    }
    await context.workspaceState.update("pgraph.scope", scope);
    await context.workspaceState.update("pgraph.project", pinnedProject);
    overview.updateScope(scopeLabel());
    scopeChanged.fire();
    return { scope, project: pinnedProject, projects: available.length };
  });
  command("refreshProjects", async () => {
    discovery = undefined;
    const available = projects();
    for (const [root, engine] of clients) {
      if (!available.some((p) => p.uri.fsPath === root)) {
        engine.dispose();
        clients.delete(root);
      }
    }
    overview.updateScope(scopeLabel());
    scopeChanged.fire();
    await show(
      [
        "# PGraph workspace projects",
        ...available.map((p) => `- ${p.name}: ${p.uri.fsPath}`),
        ...discoveryWarnings(),
        "Choose Scope selects one project or the workspace. Index Workspace indexes the detected projects separately.",
      ].join("\n\n"),
    );
    return available.map((p) => ({ name: p.name, root: p.uri.toString() }));
  });
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
    const folders = projects();
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
      warnings: discoveryWarnings(),
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
    const folders = projects();
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
  command("workspaceImpactHere", async () => {
    const editor = vscode.window.activeTextEditor;
    const folder = editor && projectAt(editor.document.uri);
    if (!editor || !folder)
      throw new Error(
        "Open an indexed source file and place the cursor inside a symbol",
      );
    if (editor.document.isDirty)
      throw new Error(
        "Save and reindex before using workspace impact for this symbol",
      );
    const engine = engineFor(folder);
    let focus: GraphNode;
    try {
      focus = await engine.request<GraphNode>("focus", {
        file: relative(
          folder.uri.fsPath,
          editor.document.uri.fsPath,
        ).replaceAll("\\", "/"),
        line: editor.selection.active.line + 1,
      });
    } finally {
      engine.releaseIdle();
    }
    const project = projects().find(
      (p) => p.uri.toString() === folder.uri.toString(),
    )?.project;
    const text = await request("impact", {
      workspace: true,
      project,
      symbol: focus.id,
      maxTokens: Math.min(32000, Math.max(6000, projects().length * 500)),
    });
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
      maxTokens: workspaceScope()
        ? Math.min(32000, Math.max(2000, projects().length * 500))
        : 2000,
      format: "markdown",
    });
    await show(text);
    return text;
  });
  command("contextHere", async (arg) => {
    const editor = vscode.window.activeTextEditor;
    const folder = editor && projectAt(editor.document.uri);
    if (!editor || !folder || editor.document.uri.scheme !== "file")
      throw new Error(
        "Open an indexed source file and place the cursor inside a symbol",
      );
    if (editor.document.isDirty)
      throw new Error(
        "Save and reindex before using indexed context for this symbol",
      );
    const focus = {
      file: relative(folder.uri.fsPath, editor.document.uri.fsPath).replaceAll(
        "\\",
        "/",
      ),
      line: editor.selection.active.line + 1,
    };
    const task =
      arg ??
      (await vscode.window.showInputBox({
        prompt: "What do you want to change or understand about this symbol?",
      }));
    if (!task) return;
    selectedFolder = folder;
    const text = await requestFrom(engineFor(folder), "context", {
      task,
      focus,
      maxTokens: 2000,
      format: "markdown",
    });
    await show(text);
    return text;
  });
  command("reviewChanges", async () => {
    if (workspaceScope()) {
      await vscode.commands.executeCommand("pgraph.indexWorkspace");
      return vscode.commands.executeCommand("pgraph.changedDeclarations");
    }
    const engine = await client();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "PGraph: updating index for change review",
        cancellable: true,
      },
      (progress, token) =>
        engine.request("index", {}, token, (update) =>
          progress.report({ message: update.message }),
        ),
    );
    const review = await engine.request<ChangeReview>("reviewChanges");
    const at = (node: ChangeReview["tests"][number]["node"]) =>
      `${node.qualifiedName} — ${node.location?.file ?? "unknown"}:${node.location?.startLine ?? "?"}`;
    await show(
      [
        "# PGraph change review",
        `Compared with ${review.base.slice(0, 12)} | Index revision ${review.revision}`,
        `${review.totalFiles} changed files. Conservative file-level impact; no checks have been executed.`,
        ...(review.truncated
          ? ["Some files or relationships were omitted by the review limits."]
          : []),
        "\n## Changed files",
        ...review.files.map(
          (file) =>
            `- ${file.file} (${file.status})${file.limitation ? ` — ${file.limitation}` : ""}`,
        ),
        "\n## Affected code",
        ...review.affected.map(
          ({ node, potentialDispatch }) =>
            `- ${at(node)}${potentialDispatch ? " (possible interface dispatch)" : ""}`,
        ),
        "\n## Candidate tests",
        ...review.tests.map(
          ({ node, potentialDispatch }) =>
            `- ${at(node)}${potentialDispatch ? " (possible interface dispatch)" : ""}`,
        ),
        "\n## Suggested checks",
        ...review.checks.map((check) => `- ${check}`),
        "\n## Analysis limits",
        ...review.warnings.map((warning) => `- ${warning}`),
      ].join("\n"),
    );
    return review;
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
          if (workspaceScope() && tool.name !== "context" && !input.project)
            throw new Error(
              "Workspace tool queries need a project ID from pgraph_context, or pin a project with PGraph: Choose Scope.",
            );
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
            invocationMessage: `PGraph: ${tool.name} (${scopeLabel()})`,
          };
        },
      }),
    );
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      discovery = undefined;
      for (const folder of event.removed) {
        for (const [root, engine] of clients)
          if (
            containsPath(folder.uri.fsPath, root) &&
            !vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root))
          ) {
            engine.dispose();
            clients.delete(root);
          }
        if (
          selectedFolder &&
          containsPath(folder.uri.fsPath, selectedFolder.uri.fsPath)
        )
          selectedFolder = undefined;
      }
      scopeChanged.fire();
    }),
  );
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const watchers = [
    "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs,json}",
    "**/{yarn.lock,pnpm-lock.yaml,bun.lock}",
  ].map((pattern) => vscode.workspace.createFileSystemWatcher(pattern));
  context.subscriptions.push(...watchers);
  const changed = (uri: vscode.Uri): void => {
    if (
      /\/(node_modules|\.pgraph|dist|build|\.next|coverage)\//.test(uri.path) ||
      !vscode.workspace.getConfiguration("pgraph").get<boolean>("autoIndex")
    )
      return;
    const folder = projectAt(uri);
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
    ...watchers.flatMap((watcher) => [
      watcher.onDidChange(changed),
      watcher.onDidCreate(changed),
      watcher.onDidDelete(changed),
    ]),
    {
      dispose() {
        for (const timer of timers.values()) clearTimeout(timer);
      },
    },
  );
  return {
    request,
    projects: () =>
      projects().map((p) => ({ name: p.name, root: p.uri.toString() })),
  };
}
