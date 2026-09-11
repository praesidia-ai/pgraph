import * as vscode from "vscode";
import { relative } from "node:path";
import type { EngineClient } from "./client.js";
import type { RepositoryCheck } from "@praesidia/pgraph-core";
import { dailyReport } from "./daily-report.js";

interface SavedInvestigation {
  id: string;
  root: string;
  task: string;
  symbol?: string;
}
interface DailyHost {
  client(): Promise<EngineClient>;
  folder(): vscode.WorkspaceFolder | undefined;
  command(name: string, handler: (arg?: string) => unknown): void;
  show(text: string, language?: string): Promise<void>;
  projects(): vscode.WorkspaceFolder[];
  engineFor(folder: vscode.WorkspaceFolder): EngineClient;
  workspaceScope(): boolean;
  scopeLabel(): string;
  onScopeChanged: vscode.Event<void>;
  projectAt(uri: vscode.Uri): vscode.WorkspaceFolder | undefined;
  warnings(): string[];
  rememberProject(folder: vscode.WorkspaceFolder): void;
}
export function registerDaily(
  context: vscode.ExtensionContext,
  host: DailyHost,
) {
  let historyRun = 0;
  const pendingHistory = new Map<
    string,
    {
      folder: vscode.WorkspaceFolder;
      input: Record<string, unknown>;
    }
  >();
  const rememberHistory = (
    folder: vscode.WorkspaceFolder,
    input: Record<string, unknown>,
    data: Record<string, unknown>,
    run: number,
  ) => {
    if (run !== historyRun) return;
    const page = data.page as
      { reviewId?: string; nextOffset?: number } | undefined;
    const root = folder.uri.toString();
    if (
      page &&
      typeof page.reviewId === "string" &&
      /^[a-f0-9]{64}$/.test(page.reviewId) &&
      Number.isInteger(page.nextOffset) &&
      page.nextOffset! > 0 &&
      page.nextOffset! <= 5000
    )
      pendingHistory.set(root, {
        folder,
        input: { ...input, reviewId: page.reviewId, offset: page.nextOffset },
      });
    else pendingHistory.delete(root);
  };
  const query = async (action: string, input: Record<string, unknown> = {}) => {
    const run = historyRun;
    if (host.workspaceScope() && action !== "file") {
      const folders = host.projects();
      if (!folders.length)
        throw new Error("Open a local project or workspace folder first");
      return vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `PGraph: ${action} across ${folders.length} projects`,
          cancellable: true,
        },
        async (progress, token) => {
          const projects: {
            name: string;
            root: string;
            data?: Record<string, unknown>;
            error?: string;
          }[] = [];
          for (const [i, folder] of folders.entries()) {
            if (token.isCancellationRequested)
              throw new vscode.CancellationError();
            progress.report({
              message: `${i + 1}/${folders.length}: ${folder.name}`,
            });
            let engine: EngineClient | undefined;
            try {
              engine = host.engineFor(folder);
              const text = await engine.request<string>(
                "tool",
                {
                  name: "workflow",
                  input: {
                    action,
                    ...input,
                    maxTokens: Math.max(
                      256,
                      Math.min(6000, Math.floor(32000 / folders.length)),
                    ),
                  },
                },
                token,
              );
              projects.push({
                name: folder.name,
                root: folder.uri.toString(),
                data: JSON.parse(text),
              });
              if (action === "change_impact")
                rememberHistory(folder, input, JSON.parse(text), run);
            } catch (error) {
              if (
                token.isCancellationRequested ||
                error instanceof vscode.CancellationError
              )
                throw error;
              projects.push({
                name: folder.name,
                root: folder.uri.toString(),
                error: error instanceof Error ? error.message : String(error),
              });
            } finally {
              engine?.releaseIdle();
            }
          }
          return JSON.stringify({
            scope: "workspace",
            action,
            projects,
            warnings: host.warnings(),
            note: "Each project uses its own index and Git history. These results do not prove cross-project impact. Inspect per-project errors and omissions.",
          });
        },
      );
    }
    const engine = await host.client();
    if (action === "change_impact") {
      const folder = host.folder();
      const text = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "PGraph: comparing Git snapshots and historical consumers",
          cancellable: true,
        },
        (_progress, token) =>
          engine.request<string>(
            "tool",
            {
              name: "workflow",
              input: { action, maxTokens: 6000, ...input },
            },
            token,
          ),
      );
      if (folder) rememberHistory(folder, input, JSON.parse(text), run);
      return text;
    }
    return engine.request<string>("tool", {
      name: "workflow",
      input: { action, maxTokens: 6000, ...input },
    });
  };
  const display = async (
    action: string,
    input: Record<string, unknown> = {},
  ) => {
    const text = await query(action, input);
    const data = JSON.parse(text);
    if (data.scope === "workspace")
      await host.show(
        [
          `# PGraph workspace: ${action}`,
          data.note,
          ...(data.warnings ?? []),
          ...data.projects.map(
            (p: {
              name: string;
              root: string;
              data?: Record<string, unknown>;
              error?: string;
            }) =>
              `## ${p.name.replace(/[\r\n#`<>]/g, " ")}\n\n${p.root}\n\n${p.error ? `Unavailable: ${p.error}` : dailyReport(action, p.data ?? {}).replace(/^# /, "### ")}`,
          ),
        ].join("\n\n"),
      );
    else
      await host.show(
        `${dailyReport(action, data)}\n\nProject: ${host.folder()?.name ?? "selected project"}`,
      );
    return text;
  };
  host.command("health", () => display("health"));
  host.command("connections", () => display("connections"));
  host.command("cycles", () => display("cycles"));
  host.command("checks", () => display("checks"));
  host.command("verification", () => display("verification"));
  host.command("changedDeclarations", () => display("changes"));
  host.command("historicalChanges", async (arg) => {
    const mode =
      arg ??
      (await vscode.window.showQuickPick(["working", "staged", "branch"], {
        title: "Review historical impact",
        placeHolder:
          "Choose the after snapshot to compare with its Git baseline",
      }));
    if (!mode) return;
    const base =
      mode === "branch"
        ? await vscode.window.showInputBox({
            prompt:
              "Compare committed changes from the merge base with this Git reference",
          })
        : undefined;
    if (mode === "branch" && !base) return;
    historyRun++;
    pendingHistory.clear();
    return display("change_impact", { mode, ...(base ? { base } : {}) });
  });
  host.command("continueHistoricalChanges", async (root) => {
    const choices = [...pendingHistory.entries()];
    if (!choices.length)
      throw new Error(
        "No pending historical pages. Run PGraph: Review Historical Impact first.",
      );
    const selected = root
      ? pendingHistory.get(root)
      : choices.length === 1
        ? choices[0]![1]
        : (
            await vscode.window.showQuickPick(
              choices.map(([, entry]) => ({
                label: entry.folder.name,
                description: `${entry.folder.uri.fsPath} · next change ${Number(entry.input.offset) + 1}`,
                entry,
              })),
              { placeHolder: "Continue a project's historical review" },
            )
          )?.entry;
    if (!selected) {
      if (root)
        throw new Error("No pending historical review for that project");
      return;
    }
    if (
      !host
        .projects()
        .some(
          (folder) => folder.uri.toString() === selected.folder.uri.toString(),
        )
    )
      throw new Error(
        "The historical review's project is no longer open. Reopen it and start a new review.",
      );
    const run = historyRun;
    const engine = host.engineFor(selected.folder);
    try {
      const text = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `PGraph: continuing historical review for ${selected.folder.name}`,
          cancellable: true,
        },
        (_progress, token) =>
          engine.request<string>(
            "tool",
            {
              name: "workflow",
              input: {
                action: "change_impact",
                maxTokens: 6000,
                ...selected.input,
              },
            },
            token,
          ),
      );
      const data = JSON.parse(text);
      rememberHistory(selected.folder, selected.input, data, run);
      await host.show(
        `${dailyReport("change_impact", data)}\n\nProject: ${selected.folder.name}`,
      );
      return text;
    } finally {
      engine.releaseIdle();
    }
  });
  host.command("stagedChanges", () => display("changes", { mode: "staged" }));
  host.command("testGaps", () => display("test_gaps"));
  host.command("branchChanges", async (arg) => {
    const base =
      arg ??
      (await vscode.window.showInputBox({
        prompt:
          "Compare committed changes from the merge base with this Git reference",
      }));
    if (base) return display("changes", { mode: "branch", base });
  });
  host.command("searchText", async (arg) => {
    const text =
      arg ??
      (await vscode.window.showInputBox({
        prompt: "Exact error message or source text",
      }));
    if (text) return display("text", { query: text });
  });
  host.command("traceError", async (arg) => {
    let trace = arg;
    if (!trace) {
      const editor = vscode.window.activeTextEditor;
      trace = editor?.document.getText(editor.selection);
      if (!trace)
        trace = await vscode.window.showInputBox({
          prompt:
            "Paste a stack frame, or select a full stack trace in an editor before running this command",
        });
    }
    if (trace) return display("trace", { query: trace });
  });
  host.command("fileOverview", async (arg) => {
    const editor = vscode.window.activeTextEditor;
    let folder =
      !arg && editor ? host.projectAt(editor.document.uri) : undefined;
    if (!arg && editor?.document.uri.scheme === "file" && !folder)
      throw new Error(
        "This file is outside the detected projects. Open its folder as a project to investigate it.",
      );
    if (!folder) {
      await host.client();
      folder = host.folder();
    }
    const file =
      arg ??
      (editor && folder && editor.document.uri.scheme === "file"
        ? relative(folder.uri.fsPath, editor.document.uri.fsPath).replaceAll(
            "\\",
            "/",
          )
        : undefined);
    if (!file || !folder) throw new Error("Open an indexed source file first");
    host.rememberProject(folder);
    const text = await host.engineFor(folder).request<string>("tool", {
      name: "workflow",
      input: { action: "file", file, maxTokens: 6000 },
    });
    await host.show(
      `${dailyReport("file", JSON.parse(text))}\n\nProject: ${folder.name}`,
    );
    return text;
  });
  host.command("runCheck", async (arg) => {
    if (!host.workspaceScope()) await host.client();
    const folders = host.workspaceScope() ? host.projects() : [host.folder()!];
    const choices: {
      check: RepositoryCheck;
      folder: vscode.WorkspaceFolder;
    }[] = [];
    const failures: string[] = [];
    for (const folder of folders) {
      const engine = host.engineFor(folder);
      try {
        const data = JSON.parse(
          await engine.request<string>("tool", {
            name: "workflow",
            input: { action: "checks", maxTokens: 16000 },
          }),
        ) as { checks?: RepositoryCheck[]; error?: string };
        if (data.error) failures.push(`${folder.name}: ${data.error}`);
        choices.push(
          ...(data.checks ?? []).map((check) => ({ check, folder })),
        );
      } catch (error) {
        failures.push(`${folder.name}: ${String(error)}`);
      } finally {
        engine.releaseIdle();
      }
    }
    if (!choices.length)
      throw new Error(
        `No supported package scripts found; index the selected projects or use your existing VS Code tasks. ${failures.join("; ")}`,
      );
    if (arg && choices.filter((c) => c.check.id === arg).length > 1)
      throw new Error(
        "This check exists in several projects. Choose Project scope before running it by ID.",
      );
    const choice = arg
      ? choices.find((c) => c.check.id === arg)
      : (
          await vscode.window.showQuickPick(
            choices.map((c) => ({
              label: `${c.folder.name} · ${c.check.cwd}: ${c.check.manager} run ${c.check.script}`,
              description: c.check.body,
              choice: c,
            })),
            {
              placeHolder: `Run one check (executes its script and lifecycle hooks)${failures.length ? `; ${failures.length} projects unavailable` : ""}`,
            },
          )
        )?.choice;
    if (!choice) return;
    const { check, folder } = choice;
    const engine = host.engineFor(folder);
    const run = await engine.request<{
      id: string;
      executable: string;
      args: string[];
      cwd: string;
    }>("beginCheck", { id: check.id });
    const task = new vscode.Task(
      { type: "pgraph", runId: run.id },
      vscode.workspace.getWorkspaceFolder(folder.uri) ?? folder,
      check.script,
      "PGraph",
      new vscode.ProcessExecution(run.executable, run.args, { cwd: run.cwd }),
    );
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Dedicated,
    };
    return new Promise((resolve, reject) => {
      let finished = false;
      const end = vscode.tasks.onDidEndTaskProcess((event) => {
        if (event.execution.task.definition.runId !== run.id || finished)
          return;
        finished = true;
        end.dispose();
        cancel.dispose();
        void engine
          .request("finishCheck", {
            id: run.id,
            exitCode: event.exitCode ?? null,
          })
          .then(async (result) => {
            await host.show(JSON.stringify(result, null, 2), "json");
            resolve(result);
          })
          .catch(reject);
      });
      // Tasks that never produce a process-end event (e.g. failed launch) must not leave a pending run.
      const cancel = vscode.tasks.onDidEndTask((event) => {
        if (event.execution.task.definition.runId !== run.id) return;
        setTimeout(() => {
          if (finished) return;
          finished = true;
          end.dispose();
          cancel.dispose();
          void engine
            .request("finishCheck", { id: run.id, exitCode: null })
            .then(resolve, reject);
        }, 100);
      });
      context.subscriptions.push(end, cancel);
      void Promise.resolve(vscode.tasks.executeTask(task)).catch(
        async (error) => {
          if (finished) return;
          finished = true;
          end.dispose();
          cancel.dispose();
          await engine
            .request("finishCheck", { id: run.id, exitCode: null })
            .catch(() => undefined);
          reject(error);
        },
      );
    });
  });
  const saved = () =>
    context.workspaceState.get<SavedInvestigation[]>(
      "pgraph.investigations",
      [],
    );
  host.command("saveInvestigation", async (arg) => {
    const editor = vscode.window.activeTextEditor;
    let folder = editor ? host.projectAt(editor.document.uri) : undefined;
    if (!folder) {
      await host.client();
      folder = host.folder();
    }
    if (!folder) return;
    const engine = host.engineFor(folder);
    const task =
      arg ??
      (await vscode.window.showInputBox({
        prompt: "Name the task you want to resume later",
        validateInput: (value) =>
          !value.trim() || value.length > 1000
            ? "Enter 1–1000 characters"
            : undefined,
      }));
    if (!task?.trim() || task.length > 1000) return;
    let symbol: string | undefined;
    if (
      editor?.document.uri.scheme === "file" &&
      host.projectAt(editor.document.uri)?.uri.toString() ===
        folder.uri.toString()
    ) {
      if (editor.document.isDirty)
        throw new Error("Save and reindex before bookmarking this declaration");
      const focus = await engine.request<{ id: string }>("focus", {
        file: relative(
          folder.uri.fsPath,
          editor.document.uri.fsPath,
        ).replaceAll("\\", "/"),
        line: editor.selection.active.line + 1,
      });
      symbol = focus.id;
    }
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      root: folder.uri.toString(),
      task,
      symbol,
    };
    await context.workspaceState.update(
      "pgraph.investigations",
      [entry, ...saved()].slice(0, 30),
    );
    return entry;
  });
  host.command("resumeInvestigation", async (arg) => {
    if (!host.workspaceScope()) await host.client();
    const allowed = new Set(
      (host.workspaceScope() ? host.projects() : [host.folder()!]).map((p) =>
        p.uri.toString(),
      ),
    );
    const items = saved().filter((item) => allowed.has(item.root));
    const entry = arg
      ? items.find((item) => item.id === arg)
      : (
          await vscode.window.showQuickPick(
            items.map((item) => ({
              label: item.task,
              description: `${host.projects().find((p) => p.uri.toString() === item.root)?.name}: ${item.symbol ?? "task"}`,
              entry: item,
            })),
            { placeHolder: "Resume a saved task with fresh context" },
          )
        )?.entry;
    if (!entry) return;
    const folder = host.projects().find((p) => p.uri.toString() === entry.root);
    if (!folder) throw new Error("Saved project is no longer open");
    const engine = host.engineFor(folder);
    let focus: { file: string; line: number } | undefined;
    if (entry.symbol) {
      const node = JSON.parse(
        await engine.request<string>("tool", {
          name: "symbol",
          input: { symbol: entry.symbol, maxTokens: 1000 },
        }),
      ) as { at?: string };
      const at = /^(.*):(\d+)-\d+$/.exec(node.at ?? "");
      if (!at)
        throw new Error(
          "Saved symbol is missing; remove this bookmark or search for its replacement",
        );
      focus = { file: at[1]!, line: Number(at[2]) };
    }
    const text = await engine.request<string>("tool", {
      name: "context",
      input: {
        task: entry.task,
        focus,
        format: "markdown",
        maxTokens: 2000,
        evidenceMode: vscode.workspace
          .getConfiguration("pgraph")
          .get("evidenceMode", "local"),
      },
    });
    await host.show(text);
    return text;
  });
  host.command("removeInvestigation", async (arg) => {
    if (!host.workspaceScope()) await host.client();
    const allowed = new Set(
      (host.workspaceScope() ? host.projects() : [host.folder()!]).map((p) =>
        p.uri.toString(),
      ),
    );
    const items = saved().filter((item) => allowed.has(item.root));
    const id =
      arg ??
      (
        await vscode.window.showQuickPick(
          items.map((item) => ({ label: item.task, id: item.id })),
          { placeHolder: "Remove a saved task" },
        )
      )?.id;
    if (id)
      await context.workspaceState.update(
        "pgraph.investigations",
        saved().filter((item) => item.id !== id),
      );
  });
  const actions = [
    ["Choose Project or Workspace scope", "chooseScope"],
    ["Refresh detected projects", "refreshProjects"],
    ["Index all workspace projects", "indexWorkspace"],
    ["Find exact source text", "searchText"],
    ["Investigate a stack trace", "traceError"],
    ["Understand this file", "fileOverview"],
    ["Changed declarations", "changedDeclarations"],
    ["Review historical impact", "historicalChanges"],
    ["Continue historical review", "continueHistoricalChanges"],
    ["Review staged changes", "stagedChanges"],
    ["Compare a branch", "branchChanges"],
    ["Find change test gaps", "testGaps"],
    ["Choose and run a check", "runCheck"],
    ["Recorded check results", "verification"],
    ["Check index freshness", "health"],
    ["Inspect connection mappings", "connections"],
    ["Find dependency cycles", "cycles"],
    ["Save this investigation", "saveInvestigation"],
    ["Resume an investigation", "resumeInvestigation"],
    ["Context for current symbol", "contextHere"],
  ];
  host.command("daily", async () => {
    const choice = await vscode.window.showQuickPick(
      actions.map(([label, command]) => ({ label: label!, command: command! })),
      { placeHolder: `${host.scopeLabel()} — what is blocking your change?` },
    );
    if (choice)
      return vscode.commands.executeCommand(`pgraph.${choice.command}`);
  });
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10,
  );
  status.command = "pgraph.daily";
  const update = () => {
    if (
      vscode.workspace.isTrusted &&
      vscode.workspace.workspaceFolders?.length
    ) {
      status.text = `$(references) PGraph: ${host.scopeLabel()}`;
      status.tooltip = "Daily Workflow — choose Project or Workspace scope";
      status.show();
    } else status.hide();
  };
  update();
  context.subscriptions.push(
    status,
    vscode.workspace.onDidChangeWorkspaceFolders(update),
    vscode.workspace.onDidGrantWorkspaceTrust(update),
    host.onScopeChanged(update),
  );
}
