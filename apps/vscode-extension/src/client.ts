import { fork, type ChildProcess } from "node:child_process";
import * as vscode from "vscode";
import { existsSync } from "node:fs";
import type { IndexProgress } from "@praesidia/pgraph-core";

export class NodeLaunchError extends Error {
  constructor(executable: string, cause: NodeJS.ErrnoException) {
    const reason =
      cause.code === "ENOENT"
        ? `VS Code cannot find Node.js (${executable}).`
        : `Cannot launch Node.js (${executable}): ${cause.message}.`;
    super(
      `${reason} On this computer, run node -p "process.execPath" in Terminal and paste the full output into PGraph: Node Path, then retry.`,
      { cause },
    );
    this.name = "NodeLaunchError";
  }
}

export class EngineClient implements vscode.Disposable {
  private child: ChildProcess | undefined;
  private sequence = 0;
  private activeId: number | undefined;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
      op: string;
      args: unknown;
      begin: () => void;
      onProgress?: (progress: IndexProgress) => void;
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
    if (!existsSync(this.root))
      throw new Error(
        `Repository folder no longer exists: ${this.root}. Reopen its current location in VS Code.`,
      );
    const nodePath = vscode.workspace
      .getConfiguration("pgraph")
      .get<string>("nodePath", "node");
    let child: ChildProcess;
    try {
      child = fork(this.workerPath, [this.root], {
        execPath: nodePath,
        execArgv: [],
        cwd: this.root,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
      });
    } catch (error) {
      throw new NodeLaunchError(nodePath, error as NodeJS.ErrnoException);
    }
    this.child = child;
    child.stderr?.on("data", (data: Buffer) =>
      this.output.appendLine(data.toString()),
    );
    child.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const m = message as {
        id: number;
        result?: unknown;
        error?: string;
        progress?: IndexProgress;
      };
      const pending = this.pending.get(m.id);
      if (!pending || m.id !== this.activeId || this.child !== child) return;
      if (m.progress) {
        this.output.appendLine(
          `[${new Date().toISOString()}] ${m.progress.message}`,
        );
        try {
          pending.onProgress?.(m.progress);
        } catch (error) {
          this.output.appendLine(`Progress display failed: ${String(error)}`);
        }
        return;
      }
      pending.cleanup();
      this.pending.delete(m.id);
      this.activeId = undefined;
      if (m.error) pending.reject(new Error(m.error));
      else pending.resolve(m.result);
      this.pump();
    });
    child.on("error", (error) => {
      if (this.child === child) this.stop(new NodeLaunchError(nodePath, error));
    });
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
    onProgress?: (progress: IndexProgress) => void,
  ): Promise<T> {
    if (token?.isCancellationRequested)
      return Promise.reject(new vscode.CancellationError());
    if (this.pending.size >= 128)
      return Promise.reject(
        new Error(
          "PGraph has too many queued requests; wait for indexing to finish.",
        ),
      );
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let started: number | undefined;
      const cancel = token?.onCancellationRequested(() => {
        if (this.activeId === id) this.stop(new vscode.CancellationError());
        else {
          const queued = this.pending.get(id);
          queued?.cleanup();
          this.pending.delete(id);
          reject(new vscode.CancellationError());
        }
      });
      this.pending.set(id, {
        op,
        args,
        onProgress,
        resolve: (value) => resolve(value as T),
        reject,
        begin: () => {
          const setting =
            op === "index" ? "indexTimeoutSeconds" : "queryTimeoutSeconds";
          const fallback = op === "index" ? 900 : 120;
          const configured = vscode.workspace
            .getConfiguration("pgraph")
            .get<number>(setting, fallback);
          const seconds =
            Number.isFinite(configured) && configured >= 1 && configured <= 7200
              ? configured
              : fallback;
          started = performance.now();
          this.output.appendLine(`Starting ${op}; timeout ${seconds}s.`);
          timer = setTimeout(
            () =>
              this.stop(
                new Error(
                  `PGraph ${op === "index" ? "indexing" : "query"} exceeded ${seconds} seconds. Increase PGraph: ${op === "index" ? "Index" : "Query"} Timeout Seconds, or narrow the repository scope.`,
                ),
              ),
            seconds * 1000,
          );
        },
        cleanup: () => {
          clearTimeout(timer);
          cancel?.dispose();
          if (started !== undefined)
            this.output.appendLine(
              `Finished ${op} request after ${Math.round((performance.now() - started) / 1000)}s.`,
            );
        },
      });
      // Only an executing request owns a timeout. Queued queries must not kill an index.
      this.pump();
    });
  }
  private pump(): void {
    if (this.activeId !== undefined) return;
    const next = this.pending.entries().next().value;
    if (!next) return;
    const [id, request] = next;
    this.activeId = id;
    try {
      const child = this.start();
      request.begin();
      child.send({ id, op: request.op, args: request.args }, (error) => {
        if (error && this.child === child && this.activeId === id)
          this.stop(error);
      });
    } catch (error) {
      this.stop(error instanceof Error ? error : new Error(String(error)));
    }
  }
  private stop(error: Error): void {
    const child = this.child;
    this.child = undefined;
    this.activeId = undefined;
    child?.kill();
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    this.pending.clear();
  }
  releaseIdle(): void {
    if (!this.pending.size && this.activeId === undefined)
      this.stop(new Error("Idle PGraph engine released"));
  }
  dispose(): void {
    this.stop(new Error("PGraph disposed"));
  }
}
