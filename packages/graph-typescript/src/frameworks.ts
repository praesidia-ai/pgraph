import ts from "typescript";
import type { GraphNode, NodeKind } from "@praesidia/pgraph-ir";

export interface FrameworkHint {
  framework: string;
  kind?: NodeKind;
  entryPoint?: boolean;
  tags?: string[];
  route?: string;
}
export interface FrameworkEnricher {
  name: string;
  recognize(
    node: ts.Node,
    graphNode: GraphNode,
    file: string,
  ): FrameworkHint | undefined;
}
export function decorators(node: ts.Node): string[] {
  return ts.canHaveDecorators(node)
    ? (ts.getDecorators(node) ?? []).map((d) => d.expression.getText())
    : [];
}

export const frameworkEnrichers: FrameworkEnricher[] = [
  {
    name: "nestjs",
    recognize(node) {
      const ds = decorators(node);
      const joined = ds.join(" ");
      if (ds.some((d) => /^Controller\b/.test(d)))
        return { framework: "nestjs", kind: "controller", entryPoint: true };
      if (ds.some((d) => /^Injectable\b/.test(d)))
        return { framework: "nestjs", kind: "service" };
      const route = ds.find((d) =>
        /^(Get|Post|Put|Patch|Delete|Head|Options|All)\b/.test(d),
      );
      if (route) return { framework: "nestjs", entryPoint: true, route };
      if (/\b(EventPattern|MessagePattern|OnEvent)\b/.test(joined))
        return { framework: "nestjs", kind: "event_handler", entryPoint: true };
      if (/\b(Processor|Process)\b/.test(joined))
        return { framework: "nestjs", kind: "queue_handler", entryPoint: true };
      if (/\b(Module|UseGuards|UseInterceptors|UseFilters)\b/.test(joined))
        return { framework: "nestjs", tags: ds };
      return undefined;
    },
  },
  {
    name: "nextjs",
    recognize(_node, g, file) {
      if (
        /(^|\/)app\/.*\b(route|page|layout)\.[jt]sx?$/.test(file) ||
        /(^|\/)app\/(route|page|layout)\.[jt]sx?$/.test(file)
      ) {
        if (
          g.metadata.defaultExport ||
          (/\/route\.[jt]s$/.test(file) &&
            g.metadata.exported &&
            /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(g.name))
        )
          return {
            framework: "nextjs-app",
            entryPoint: true,
            route: file.replace(/\.(tsx?|jsx?)$/, ""),
          };
      }
      if (/(^|\/)pages\//.test(file) && g.metadata.defaultExport)
        return { framework: "nextjs-pages", entryPoint: true, route: file };
      if (
        ts.isFunctionLike(_node) &&
        "body" in _node &&
        _node.body?.getText().match(/^\{\s*['"]use server['"]/)
      )
        return {
          framework: "nextjs",
          entryPoint: true,
          tags: ["server-action"],
        };
      return undefined;
    },
  },
  {
    name: "react",
    recognize(_node, g, file) {
      if (g.kind === "function" && /^use[A-Z]/.test(g.name))
        return { framework: "react", tags: ["hook"] };
      if (
        g.kind === "function" &&
        /^[A-Z]/.test(g.name) &&
        /\.[jt]sx$/.test(file)
      )
        return { framework: "react", tags: ["component"] };
      if (
        ts.isVariableDeclaration(_node) &&
        _node.initializer &&
        /\b(createContext|createProvider)\s*\(/.test(
          _node.initializer.getText(),
        )
      )
        return { framework: "react", tags: ["context"] };
      return undefined;
    },
  },
  {
    name: "database",
    recognize(node) {
      if (decorators(node).some((d) => /^(Entity|Table|Schema)\b/.test(d)))
        return { framework: "orm", kind: "database_model" };
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        /\b(pgTable|mysqlTable|sqliteTable|defineTable)\s*\(/.test(
          node.initializer.getText(),
        )
      )
        return { framework: "drizzle", kind: "database_table" };
      return undefined;
    },
  },
];
