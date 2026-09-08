import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  openSync,
  closeSync,
  fstatSync,
  constants,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

export const hash = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
export const slash = (path: string): string => path.split(sep).join("/");
export const words = (value: string): string[] =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
export function bounded(
  value: number,
  min: number,
  max: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  return value;
}

/** Reject traversal and all symlink components, including the final file. */
export function safePath(root: string, path: string, mustExist = true): string {
  const base = realpathSync(root);
  const full = resolve(base, path);
  const rel = relative(base, full);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("Path escapes repository root");
  let cursor = base;
  for (const segment of rel.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    if (existsSync(cursor)) {
      if (lstatSync(cursor).isSymbolicLink())
        throw new Error("Symlinks are not permitted");
    } else {
      // existsSync is false for dangling symlinks.
      try {
        if (lstatSync(cursor).isSymbolicLink())
          throw new Error("Symlinks are not permitted");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (mustExist) throw new Error(`Missing repository path: ${path}`);
    }
  }
  return full;
}
export function readLocal(
  root: string,
  path: string,
  maxBytes = 2_000_000,
): string {
  const full = safePath(root, path);
  const fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes)
      throw new Error(
        `Not a regular file or exceeds ${maxBytes} bytes: ${path}`,
      );
    const verified = safePath(root, path);
    const current = lstatSync(verified);
    if (current.dev !== stat.dev || current.ino !== stat.ino)
      throw new Error("File changed during secure read");
    const result = readFileSync(fd, "utf8");
    if (Buffer.byteLength(result) > maxBytes)
      throw new Error("File grew beyond the read limit");
    return result;
  } finally {
    closeSync(fd);
  }
}

export const configSchema = z
  .object({
    include: z.array(z.string().max(500)).max(200).default(["**/*"]),
    exclude: z.array(z.string().max(500)).max(200).default([]),
    limits: z
      .object({
        maxFiles: z.number().int().min(1).max(200_000).default(50_000),
        maxFileBytes: z
          .number()
          .int()
          .min(100)
          .max(10_000_000)
          .default(2_000_000),
        maxTotalBytes: z
          .number()
          .int()
          .min(1000)
          .max(2_000_000_000)
          .default(200_000_000),
      })
      .default({}),
    context: z
      .object({
        defaultTokenBudget: z.number().int().min(128).max(32_000).default(2000),
        weights: z
          .record(
            z.enum([
              "name",
              "path",
              "signature",
              "proximity",
              "entry",
              "tests",
              "public",
              "concept",
              "git",
            ]),
            z.number().min(0).max(10),
          )
          .default({}),
      })
      .default({}),
    semantic: z
      .object({
        enabled: z.boolean().default(false),
        provider: z.literal("vscode-copilot").default("vscode-copilot"),
      })
      .default({}),
    git: z
      .object({
        enabled: z.boolean().default(false),
        maxCommits: z.number().int().min(1).max(1000).default(100),
      })
      .default({}),
    diagnostics: z.boolean().default(false),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;
export function loadConfig(root: string): Config {
  const path = safePath(root, ".pgraph.json", false);
  return configSchema.parse(
    existsSync(path)
      ? JSON.parse(readLocal(root, ".pgraph.json", 100_000))
      : {},
  );
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
