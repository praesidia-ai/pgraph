import { mkdir, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
await mkdir("artifacts", { recursive: true });
await copyFile("LICENSE", "apps/vscode-extension/LICENSE");
execFileSync(
  process.execPath,
  [
    resolve("node_modules/@vscode/vsce/vsce"),
    "package",
    "--no-dependencies",
    "--allow-missing-repository",
    "--out",
    resolve("artifacts/pgraph-0.1.0.vsix"),
  ],
  { cwd: resolve("apps/vscode-extension"), stdio: "inherit" },
);
