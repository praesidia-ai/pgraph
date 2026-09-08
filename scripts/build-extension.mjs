import { build } from "esbuild";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import {
  toolDefinitions,
  toolJsonSchema,
} from "../packages/graph-tools/dist/index.js";
const base = new URL("../apps/vscode-extension/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("package.json", base), "utf8"),
);
manifest.contributes.languageModelTools = toolDefinitions.map((t) => ({
  name: `pgraph_${t.name}`,
  displayName: `PGraph ${t.name}`,
  toolReferenceName: `pgraph_${t.name}`,
  canBeReferencedInPrompt: true,
  modelDescription: t.description,
  userDescription: t.description,
  inputSchema: toolJsonSchema(t.name),
}));
await writeFile(
  new URL("package.json", base),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  new URL("tools.json", base),
  JSON.stringify(
    toolDefinitions.map((t) => ({ name: t.name, description: t.description })),
    null,
    2,
  ) + "\n",
);
await mkdir(new URL("dist/", base), { recursive: true });
await build({
  entryPoints: ["apps/vscode-extension/src/extension.ts"],
  outfile: "apps/vscode-extension/dist/extension.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["vscode"],
  sourcemap: true,
});
await build({
  entryPoints: ["apps/vscode-extension/src/worker.ts"],
  outfile: "apps/vscode-extension/dist/worker.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["typescript"],
  sourcemap: true,
});
// TypeScript locates its standard libraries relative to its own module.
await mkdir(new URL("dist/node_modules/typescript/", base), {
  recursive: true,
});
const { cp } = await import("node:fs/promises");
await cp(
  new URL("../node_modules/typescript/lib/", import.meta.url),
  new URL("dist/node_modules/typescript/lib/", base),
  { recursive: true },
);
await copyFile(
  new URL("../node_modules/typescript/package.json", import.meta.url),
  new URL("dist/node_modules/typescript/package.json", base),
);
await copyFile(
  new URL("../node_modules/typescript/LICENSE.txt", import.meta.url),
  new URL("dist/node_modules/typescript/LICENSE.txt", base),
);
