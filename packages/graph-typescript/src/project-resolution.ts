import ts from "typescript";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { safePath, slash } from "@praesidia/pgraph-shared";

const contains = (base: string, path: string) => {
  const rel = relative(base, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
};
const extension = (path: string): ts.Extension => {
  const suffix = path.slice(path.lastIndexOf("."));
  return (
    {
      ".ts": ts.Extension.Ts,
      ".tsx": ts.Extension.Tsx,
      ".mts": ts.Extension.Mts,
      ".cts": ts.Extension.Cts,
      ".js": ts.Extension.Js,
      ".jsx": ts.Extension.Jsx,
      ".mjs": ts.Extension.Mjs,
      ".cjs": ts.Extension.Cjs,
    } as Record<string, ts.Extension>
  )[suffix]!;
};

/** Resolve declared local project outputs to indexed source; never read a build artifact or follow a module link for source. */
export function projectSourceResolution(
  root: string,
  config: string,
  groups: ReadonlyMap<string, string[]>,
  indexed: ReadonlySet<string>,
  read: (path: string) => string | undefined,
  diagnostics: string[],
) {
  const outputs = new Map<string, string | null>();
  const packages = new Map<string, string | null>();
  const fileOptions = new Map<string, ts.CompilerOptions>();
  const seen = new Set<string>();
  const warn = (message: string) => {
    if (diagnostics.length < 20 && !diagnostics.includes(message))
      diagnostics.push(message);
  };
  const visit = (path: string) => {
    path = resolve(path);
    if (seen.has(path)) return;
    if (seen.size >= 128) {
      warn(
        "Project-reference source resolution stopped at 128 configurations.",
      );
      return;
    }
    seen.add(path);
    if (!contains(root, path)) {
      warn(
        "A project reference lies outside the indexed repository; source resolution skipped it.",
      );
      return;
    }
    const raw = ts.readConfigFile(path, read);
    if (raw.error) {
      warn(
        `Project-reference configuration unavailable: ${relative(root, path)}`,
      );
      return;
    }
    const parsed = ts.parseJsonConfigFileContent(
      raw.config,
      {
        useCaseSensitiveFileNames: true,
        readDirectory: () => [],
        readFile: read,
        fileExists: (file) => read(file) !== undefined,
      },
      dirname(path),
      undefined,
      path,
    );
    if (parsed.errors.some((e) => ![18002, 18003].includes(e.code))) {
      warn(`Project-reference configuration invalid: ${relative(root, path)}`);
      return;
    }
    for (const ref of parsed.projectReferences ?? [])
      visit(
        ref.path.endsWith(".json")
          ? ref.path
          : resolve(ref.path, "tsconfig.json"),
      );
    // Discovery owns source scope, including when a named build config is referenced.
    const paths =
      groups.get(path) ??
      [...groups]
        .filter(([key]) => key && dirname(key) === dirname(path))
        .flatMap(([, files]) => files);
    if (!paths.length) return;
    for (const file of paths)
      if (path === config || !fileOptions.has(file))
        fileOptions.set(file, {
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          allowJs: true,
          ...parsed.options,
        });
    if (
      parsed.options.outFile ||
      (!parsed.options.composite && !parsed.options.rootDir)
    ) {
      if (path !== config)
        warn(`No unambiguous project output mapping: ${relative(root, path)}`);
      return;
    }
    parsed.fileNames = paths.map(slash);
    // Composite's implicit rootDir is the config directory. An explicit rootDir is retained.
    parsed.options.rootDir = slash(parsed.options.rootDir ?? dirname(path));
    for (const file of paths) {
      if (/\.d\.[cm]?ts$/.test(file) || !contains(parsed.options.rootDir, file))
        continue;
      for (const output of ts.getOutputFileNames(parsed, slash(file), false)) {
        const out = resolve(output);
        if (out.endsWith(".map") || !contains(root, out)) continue;
        const previous = outputs.get(out);
        outputs.set(
          out,
          previous === undefined || previous === file ? file : null,
        );
      }
    }
    const packageText = read(resolve(dirname(path), "package.json"));
    if (!packageText) return;
    try {
      const name: unknown = JSON.parse(packageText).name;
      if (
        typeof name !== "string" ||
        !/^(?:@[a-z0-9_-][a-z0-9._-]*\/)?[a-z0-9_-][a-z0-9._-]*$/i.test(name)
      )
        return;
      const dir = dirname(path),
        previous = packages.get(name);
      packages.set(
        name,
        previous === undefined || previous === dir ? dir : null,
      );
    } catch {
      /* Invalid manifests are reported by normal indexing. */
    }
  };
  if (config) visit(config);
  const aliases = new Map<string, string>();
  for (const [name, dir] of packages) {
    if (!dir) {
      warn(`Ambiguous referenced package name: ${name}`);
      continue;
    }
    const alias = resolve(root, "node_modules", name);
    try {
      // A real installed package or a link to another checkout takes precedence.
      // Only link metadata is inspected; all content reads use the indexed root path.
      const entry = lstatSync(alias);
      if (!entry.isSymbolicLink() || realpathSync(alias) !== realpathSync(dir))
        continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
      if (existsSync(alias)) continue;
    }
    aliases.set(alias, dir);
  }
  const local = (path: string) => {
    const full = resolve(path);
    for (const [alias, dir] of aliases)
      if (contains(alias, full)) return resolve(dir, relative(alias, full));
    return full;
  };
  const redirectedFiles = new Set<string>();
  const virtualDirectories = new Set<string>();
  for (const file of [...outputs.keys(), ...aliases.keys()])
    for (let dir = dirname(file); contains(root, dir); dir = dirname(dir)) {
      virtualDirectories.add(dir);
      if (dir === root) break;
    }
  return {
    redirectedFiles,
    install(host: ts.CompilerHost) {
      if (!outputs.size) return;
      const resolutionHost: ts.ModuleResolutionHost = {
        readFile: (path) => read(local(path)),
        fileExists: (path) => {
          const target = local(path);
          return !!outputs.get(target) || read(target) !== undefined;
        },
        directoryExists: (path) => {
          const full = resolve(path);
          if (virtualDirectories.has(local(full))) return true;
          try {
            return (
              host.directoryExists?.(
                safePath(root, relative(root, local(path))),
              ) ?? false
            );
          } catch {
            return false;
          }
        },
        realpath: (path) => local(path),
        getCurrentDirectory: () => root,
      };
      host.resolveModuleNameLiterals = (
        literals,
        containingFile,
        redirected,
        options,
        source,
      ) =>
        literals.map((literal) => {
          const effectiveOptions =
            fileOptions.get(resolve(containingFile)) ?? options;
          const result = ts.resolveModuleName(
            literal.text,
            containingFile,
            effectiveOptions,
            resolutionHost,
            undefined,
            redirected,
            ts.getModeForUsageLocation(source, literal, effectiveOptions),
          );
          const resolved = result.resolvedModule;
          if (!resolved) return result;
          const target = local(resolved.resolvedFileName);
          const file =
            outputs.get(target) ?? (indexed.has(target) ? target : undefined);
          if (!file || !indexed.has(file)) return result;
          if (file !== resolved.resolvedFileName) redirectedFiles.add(file);
          return {
            ...result,
            resolvedModule: {
              ...resolved,
              resolvedFileName: file,
              extension: extension(file),
              isExternalLibraryImport: false,
              packageId: undefined,
            },
          };
        });
    },
  };
}
