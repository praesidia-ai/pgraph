import { mkdir, readdir, copyFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
await mkdir("artifacts", { recursive: true });
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run through npm run package:workspaces");
for (const name of await readdir("packages")) {
  const manifest = JSON.parse(
    await readFile(join("packages", name, "package.json"), "utf8"),
  );
  await copyFile("LICENSE", join("packages", name, "LICENSE"));
  execFileSync(
    process.execPath,
    [
      npm,
      "pack",
      `--workspace=${manifest.name}`,
      "--pack-destination",
      resolve("artifacts"),
    ],
    { stdio: "inherit" },
  );
}
