import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
await build({
  entryPoints: ["tests/extension-host.ts"],
  outfile: "apps/vscode-extension/dist/extension-tests.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
});
const fixture = await mkdtemp(join(tmpdir(), "pgraph-vscode-"));
const userData = await mkdtemp(join(tmpdir(), "pgraph-vscode-profile-"));
await cp("examples/sample-typescript-app", fixture, {
  recursive: true,
  filter: (p) => !p.includes(".pgraph"),
});
try {
  await runTests({
    extensionDevelopmentPath: resolve("apps/vscode-extension"),
    extensionTestsPath: resolve(
      "apps/vscode-extension/dist/extension-tests.cjs",
    ),
    ...(process.env.PGRAPH_VSCODE_PATH
      ? { vscodeExecutablePath: process.env.PGRAPH_VSCODE_PATH }
      : {}),
    launchArgs: [
      fixture,
      "--user-data-dir",
      userData,
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-extensions",
      "--no-sandbox",
      "--disable-gpu",
    ],
    extensionTestsEnv: { PGRAPH_TEST_NODE: process.execPath },
  });
} finally {
  await rm(fixture, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
}
