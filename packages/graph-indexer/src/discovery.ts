import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { default as ignoreImport, type Ignore } from "ignore";
import picomatch from "picomatch";
import {
  hash,
  readLocal,
  safePath,
  type Config,
} from "@praesidia/pgraph-shared";
import type { FileRecord } from "@praesidia/pgraph-ir";

const hardDirectories = new Set([
  "node_modules",
  ".git",
  ".pgraph",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  ".yarn",
  "vendor",
  "generated",
  "__generated__",
]);
const sensitive =
  /(^|\/)(\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|credentials(?:\..*)?|secrets?(?:\..*)?)$/i;
const createIgnore = ignoreImport as unknown as () => Ignore;
export interface Discovery {
  sources: FileRecord[];
  manifests: FileRecord[];
  configHash: string;
  diagnostics: string[];
}
export function discover(root: string, config: Config): Discovery {
  const sources: FileRecord[] = [];
  const manifests: FileRecord[] = [];
  const configuration: string[] = [];
  const diagnostics: string[] = [];
  const include = picomatch(config.include, { dot: true });
  const exclude = picomatch(config.exclude, { dot: true });
  let totalBytes = 0;
  let visited = 0;
  const walk = (
    dir: string,
    rules: { base: string; matcher: Ignore }[],
  ): void => {
    if (++visited > config.limits.maxFiles * 4)
      throw new Error("Repository discovery limit exceeded");
    const ignorePath = dir ? `${dir}/.gitignore` : ".gitignore";
    if (existsSync(resolve(root, ignorePath))) {
      const text = readLocal(root, ignorePath, 100_000);
      configuration.push(`${ignorePath}:${hash(text)}`);
      rules = [...rules, { base: dir, matcher: createIgnore().add(text) }];
    }
    const entries = readdirSync(safePath(root, dir), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (
        entry.isSymbolicLink() ||
        sensitive.test(path) ||
        hardDirectories.has(entry.name)
      )
        continue;
      if (
        rules.some((rule) =>
          rule.matcher.ignores(
            `${rule.base ? path.slice(rule.base.length + 1) : path}${entry.isDirectory() ? "/" : ""}`,
          ),
        )
      )
        continue;
      if (exclude(path) || exclude(`${path}/`)) continue;
      if (entry.isDirectory()) {
        walk(path, rules);
        continue;
      }
      if (!entry.isFile()) continue;
      const isConfig =
        /^(?:tsconfig[^/]*|jsconfig|package)\.json$/.test(entry.name) ||
        entry.name === ".pgraph.json" ||
        entry.name === "function.json" ||
        entry.name === "host.json";
      const isSource =
        /\.[cm]?[jt]sx?$/.test(path) &&
        !/\.min\.js$/.test(path) &&
        !/\.generated\.[jt]s$/.test(path);
      if (!isConfig && (!isSource || !include(path))) continue;
      const bytes = statSync(safePath(root, path)).size;
      if (bytes > config.limits.maxFileBytes) {
        diagnostics.push(`Excluded oversized file: ${path}`);
        continue;
      }
      totalBytes += bytes;
      if (totalBytes > config.limits.maxTotalBytes)
        throw new Error("Repository byte limit exceeded");
      const content = readLocal(root, path, config.limits.maxFileBytes);
      const digest = hash(content);
      if (isConfig) configuration.push(`${path}:${digest}`);
      if (
        isSource ||
        ["package.json", "function.json", "host.json"].includes(entry.name)
      ) {
        const record: FileRecord = {
          path,
          hash: digest,
          bytes,
          lines: content.split("\n").length,
          language: isSource
            ? /\.[cm]?jsx?$/.test(path)
              ? "javascript"
              : "typescript"
            : "json",
          indexedAt: new Date().toISOString(),
        };
        (isSource ? sources : manifests).push(record);
        if (sources.length + manifests.length > config.limits.maxFiles)
          throw new Error("Repository file limit exceeded");
      }
    }
  };
  walk("", []);
  return {
    sources,
    manifests,
    configHash: hash(JSON.stringify(config) + configuration.sort().join("\n")),
    diagnostics,
  };
}
