import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";

export const projectIdentity = (path: string): string =>
  createHash("sha256").update(realpathSync(path)).digest("hex").slice(0, 24);

export interface ProjectRoot {
  project: string;
  name: string;
  path: string;
  container: string;
}
export function containsPath(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    !isAbsolute(rel) &&
    rel !== ".." &&
    !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  );
}
/** A Git root stays intact. A non-Git container may expose direct child repositories. */
export function discoverProjects(folders: { name: string; path: string }[]) {
  const projects: ProjectRoot[] = [],
    warnings: string[] = [];
  const seen = new Set<string>();
  const add = (project: Omit<ProjectRoot, "project">) => {
    try {
      const canonical = realpathSync(project.path);
      if (seen.has(canonical)) return;
      seen.add(canonical);
      if (projects.length >= 64) {
        warnings.push("Project limit reached (64); open a smaller workspace.");
        return;
      }
      projects.push({ ...project, project: projectIdentity(canonical) });
    } catch {
      warnings.push(`${project.name}: folder cannot be read.`);
    }
  };
  for (const folder of folders.slice(0, 64)) {
    try {
      const root = { ...folder, container: folder.path };
      if (existsSync(join(folder.path, ".git"))) {
        add(root);
        continue;
      }
      const entries = readdirSync(folder.path, { withFileTypes: true })
        .filter(
          (d) =>
            d.isDirectory() &&
            !d.name.startsWith(".") &&
            !["node_modules", "dist", "build", "coverage", "vendor"].includes(
              d.name,
            ),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
      if (entries.length > 256)
        warnings.push(
          `${folder.name}: only the first 256 direct child folders were checked.`,
        );
      const children = entries
        .slice(0, 256)
        .filter((d) => existsSync(join(folder.path, d.name, ".git")));
      if (!children.length) add(root);
      else
        for (const child of children)
          add({
            name: `${folder.name}/${child.name}`,
            path: join(folder.path, child.name),
            container: folder.path,
          });
    } catch {
      warnings.push(
        `${folder.name}: project discovery failed; reopen the folder or check access.`,
      );
    }
  }
  if (folders.length > 64)
    warnings.push("Only the first 64 open folders were inspected.");
  return { projects, warnings: [...new Set(warnings)] };
}
