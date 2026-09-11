import { fork } from "node:child_process";

/** Isolated root-bound worker; all calls have deadlines and terminal failures. */
export function startWorker(worker, root) {
  const child = fork(worker, [root], {
    execArgv: [],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const pending = new Map();
  let serial = 0,
    stderr = "";
  child.stderr.on("data", (value) => {
    stderr = (stderr + value).slice(-3000);
  });
  const fail = (error) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
  };
  child.on("error", fail);
  child.on("exit", (code) => fail(Error(`Worker exited ${code}: ${stderr}`)));
  child.on("message", (message) => {
    if (message.progress) return;
    const p = pending.get(message.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(message.id);
    if (message.error) p.reject(Error(message.error));
    else p.resolve(message.result);
  });
  return {
    call(op, args = {}) {
      return new Promise((resolve, reject) => {
        const id = ++serial;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("Worker timeout"));
          child.kill();
        }, 60000);
        pending.set(id, { resolve, reject, timer });
        child.send({ id, op, args });
      });
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise((done) => {
        const timer = setTimeout(() => child.kill(), 3000);
        child.once("exit", () => {
          clearTimeout(timer);
          done();
        });
        if (child.connected) child.disconnect();
        else child.kill();
      });
    },
  };
}
