import { mkdir, copyFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
await mkdir("artifacts", { recursive: true });
await copyFile("LICENSE", "apps/vscode-extension/LICENSE");
const manifest = JSON.parse(
  await readFile("apps/vscode-extension/package.json", "utf8"),
);
execFileSync(
  process.execPath,
  [
    resolve("node_modules/@vscode/vsce/vsce"),
    "package",
    "--pre-release",
    "--no-dependencies",
    "--allow-missing-repository",
    "--out",
    resolve(`artifacts/pgraph-${manifest.version}.vsix`),
  ],
  { cwd: resolve("apps/vscode-extension"), stdio: "inherit" },
);
