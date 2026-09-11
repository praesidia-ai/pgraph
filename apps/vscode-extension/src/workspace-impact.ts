import * as vscode from "vscode";
import type { EngineClient } from "./client.js";

export async function requestWorkspaceImpact(
  folders: readonly (vscode.WorkspaceFolder & { project: string })[],
  engineFor: (folder: vscode.WorkspaceFolder) => EngineClient,
  input: unknown,
  warnings: string[],
  token?: vscode.CancellationToken,
): Promise<string> {
  const project =
    input && typeof input === "object"
      ? (input as Record<string, unknown>).project
      : undefined;
  const origin = folders.find((folder) => folder.project === project);
  if (!origin)
    throw new Error(
      "Workspace impact needs an open origin project ID from workspace context or Choose Scope",
    );
  if (folders.length > 64)
    throw new Error("Workspace impact supports up to 64 projects");
  // Only the host supplies root paths. Tool arguments cannot add filesystem roots.
  for (const folder of folders) engineFor(folder);
  const engine = engineFor(origin);
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "PGraph: workspace impact",
      cancellable: true,
    },
    async (progress, progressToken) => {
      const cancellation = new vscode.CancellationTokenSource();
      const subscriptions = [
        progressToken.onCancellationRequested(() => cancellation.cancel()),
      ];
      if (token)
        subscriptions.push(
          token.onCancellationRequested(() => cancellation.cancel()),
        );
      if (
        token?.isCancellationRequested ||
        progressToken.isCancellationRequested
      )
        cancellation.cancel();
      const started = performance.now();
      const elapsed = setInterval(
        () =>
          progress.report({
            message: `Checking ${folders.length} projects · ${Math.floor((performance.now() - started) / 1000)}s`,
          }),
        1000,
      );
      try {
        const result = await engine.request<string>(
          "workspaceImpact",
          {
            projects: folders.map((folder) => ({
              root: folder.uri.fsPath,
              project: folder.project,
              name: folder.name,
            })),
            input,
            warnings,
          },
          cancellation.token,
        );
        // A closed or replaced root must not remain authorized by a captured request.
        for (const folder of folders) engineFor(folder);
        if (cancellation.token.isCancellationRequested)
          throw new vscode.CancellationError();
        return result;
      } finally {
        clearInterval(elapsed);
        subscriptions.forEach((subscription) => subscription.dispose());
        cancellation.dispose();
        engine.releaseIdle();
      }
    },
  );
}
