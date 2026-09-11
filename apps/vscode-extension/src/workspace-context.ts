import * as vscode from "vscode";
import type {
  WorkspaceCandidate,
  WorkspaceProject,
} from "@praesidia/pgraph-tools";
import type { EngineClient } from "./client.js";
import { existsSync } from "node:fs";

export async function requestWorkspaceContext(
  folders: readonly (vscode.WorkspaceFolder & { project: string })[],
  engineFor: (folder: vscode.WorkspaceFolder) => EngineClient,
  input: unknown,
  warnings: string[],
  token?: vscode.CancellationToken,
): Promise<string> {
  if (!folders.length)
    throw new Error("Open a local project or workspace first");
  const targets = folders.map((folder) => ({
    folder,
    project: folder.project,
  }));
  const controlEngine = () => {
    for (const folder of folders) {
      if (!existsSync(folder.uri.fsPath)) continue;
      try {
        return engineFor(folder);
      } catch {
        /* Folder removed from the open workspace. */
      }
    }
    throw new Error(
      "No workspace projects remain available. Refresh Workspace Projects.",
    );
  };
  let validator = controlEngine();
  let data: Record<string, unknown>;
  try {
    data = await validator.request(
      "validateTool",
      { name: "context", input },
      token,
    );
  } finally {
    validator.releaseIdle();
  }
  if (data.focus || data.previousContextId)
    throw new Error(
      "Workspace context needs a project ID for cursor focus or previousContextId. Pin a project with Choose Scope or pass project.",
    );
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "PGraph: workspace context",
      cancellable: true,
    },
    async (progress, progressToken) => {
      const cancelled = new vscode.CancellationTokenSource();
      const subscriptions = [
        progressToken.onCancellationRequested(() => cancelled.cancel()),
      ];
      if (token)
        subscriptions.push(
          token.onCancellationRequested(() => cancelled.cancel()),
        );
      if (
        token?.isCancellationRequested ||
        progressToken.isCancellationRequested
      )
        cancelled.cancel();
      const projects: WorkspaceProject[] = [];
      try {
        for (const { folder, project } of targets) {
          if (cancelled.token.isCancellationRequested)
            throw new vscode.CancellationError();
          progress.report({ message: folder.name });
          let engine: EngineClient | undefined;
          try {
            engine = engineFor(folder);
            const candidate = await engine.request<WorkspaceCandidate>(
              "workspaceContext",
              {
                project,
                input: {
                  ...data,
                  maxTokens: Math.max(
                    1000,
                    Math.min(2000, Number(data.maxTokens)),
                  ),
                  evidenceMode: vscode.workspace
                    .getConfiguration("pgraph")
                    .get<string>("evidenceMode", "local"),
                },
              },
              cancelled.token,
            );
            projects.push({ project, name: folder.name, data: candidate });
          } catch (error) {
            if (error instanceof vscode.CancellationError) throw error;
            projects.push({
              project,
              name: folder.name,
              error:
                error instanceof Error
                  ? error.message
                  : "Project context failed",
            });
          } finally {
            engine?.releaseIdle();
          }
          progress.report({ increment: 100 / folders.length });
        }
        // Recheck open-root authorization before using a worker to pack the response.
        validator = controlEngine();
        try {
          return await validator.request<string>(
            "workspacePack",
            {
              projects,
              maxTokens: data.maxTokens,
              format: data.format,
              warnings,
            },
            cancelled.token,
          );
        } finally {
          validator.releaseIdle();
        }
      } finally {
        subscriptions.forEach((subscription) => subscription.dispose());
        cancelled.dispose();
      }
    },
  );
}
