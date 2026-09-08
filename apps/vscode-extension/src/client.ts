import { fork, type ChildProcess } from "node:child_process";
import * as vscode from "vscode";

export class EngineClient implements vscode.Disposable {
  private child: ChildProcess | undefined;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >();
  constructor(
    private readonly root: string,
    private readonly workerPath: string,
    private readonly output: vscode.OutputChannel,
  ) {}
  private start(): ChildProcess {
    if (this.child) return this.child;
    if (!vscode.workspace.isTrusted)
      throw new Error("PGraph requires a trusted workspace");
    const nodePath = vscode.workspace
      .getConfiguration("pgraph")
      .get<string>("nodePath", "node");
    const child = fork(this.workerPath, [this.root], {
      execPath: nodePath,
      execArgv: [],
      cwd: this.root,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
    });
    this.child = child;
    child.stderr?.on("data", (data: Buffer) =>
      this.output.appendLine(data.toString()),
    );
    child.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const m = message as { id: number; result?: unknown; error?: string };
      const pending = this.pending.get(m.id);
      if (!pending) return;
      pending.cleanup();
      this.pending.delete(m.id);
      if (m.error) pending.reject(new Error(m.error));
      else pending.resolve(m.result);
    });
    child.on("error", (error) =>
      this.stop(
        new Error(
          `Cannot start PGraph. Configure a Node.js >=22.18 executable in PGraph: Node Path. ${error.message}`,
        ),
      ),
    );
    child.on("exit", () => {
      if (this.child === child)
        this.stop(
          new Error("PGraph engine exited; the next request will restart it"),
        );
    });
    return child;
  }
  request<T>(
    op: string,
    args: unknown = {},
    token?: vscode.CancellationToken,
  ): Promise<T> {
    if (token?.isCancellationRequested)
      return Promise.reject(new vscode.CancellationError());
    const child = this.start();
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.stop(new Error("PGraph operation timed out after 120 seconds")),
        120_000,
      );
      const cancel = token?.onCancellationRequested(() =>
        this.stop(new vscode.CancellationError()),
      );
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        cleanup: () => {
          clearTimeout(timer);
          cancel?.dispose();
        },
      });
      child.send({ id, op, args }, (error) => {
        if (error) this.stop(error);
      });
    });
  }
  private stop(error: Error): void {
    const child = this.child;
    this.child = undefined;
    child?.kill();
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    this.pending.clear();
  }
  dispose(): void {
    this.stop(new Error("PGraph disposed"));
  }
}
