import { communications } from "./communications.js";
export { declarationShapes } from "./declaration-shapes.js";
import { projectSourceResolution } from "./project-resolution.js";
import ts from "typescript";
import { dirname, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import type {
  FileRecord,
  IndexProgress,
  GraphEdge,
  GraphNode,
  LanguageAdapter,
  NodeKind,
  ParsedFile,
  EdgeType,
} from "@praesidia/pgraph-ir";
import { compilerProvenance, symbolId } from "@praesidia/pgraph-ir";
import { hash, readLocal, slash, loadConfig } from "@praesidia/pgraph-shared";
import {
  decorators,
  frameworkEnrichers,
  type FrameworkEnricher,
} from "./frameworks.js";
export { frameworkEnrichers, type FrameworkEnricher } from "./frameworks.js";

function declarationKind(node: ts.Node): NodeKind | undefined {
  if (
    ts.isExportAssignment(node) &&
    (ts.isArrowFunction(node.expression) ||
      ts.isFunctionExpression(node.expression))
  )
    return "function";
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isFunctionDeclaration(node)) return "function";
  if (
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node)
  )
    return "method";
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isPropertyDeclaration(node) || ts.isEnumMember(node))
    return "property";
  if (
    ts.isPropertySignature(node) &&
    (!ts.isTypeLiteralNode(node.parent) ||
      ts.isTypeAliasDeclaration(node.parent.parent))
  )
    return "property";
  if (
    ts.isParameter(node) &&
    ts.isConstructorDeclaration(node.parent) &&
    modifiers(node).some((m) =>
      [
        ts.SyntaxKind.PublicKeyword,
        ts.SyntaxKind.PrivateKeyword,
        ts.SyntaxKind.ProtectedKeyword,
        ts.SyntaxKind.ReadonlyKeyword,
      ].includes(m.kind),
    )
  )
    return "property";
  if (ts.isModuleDeclaration(node)) return "namespace";
  if (ts.isVariableDeclaration(node)) {
    if (
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    )
      return "function";
    return ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Const
      ? "constant"
      : "variable";
  }
  return undefined;
}
function declarationName(node: ts.Node): string {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (
    "name" in node &&
    node.name &&
    typeof node.name === "object" &&
    "getText" in node.name
  )
    return (node.name as ts.Node).getText().replace(/^['"]|['"]$/g, "");
  return "default";
}
function modifiers(node: ts.Node): readonly ts.Modifier[] {
  return ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
}
function isExported(node: ts.Node): boolean {
  if (ts.isExportAssignment(node)) return true;
  return (
    modifiers(node).some(
      (m) =>
        m.kind === ts.SyntaxKind.ExportKeyword ||
        m.kind === ts.SyntaxKind.DefaultKeyword,
    ) ||
    (ts.isVariableDeclaration(node) &&
      ts.isVariableDeclarationList(node.parent) &&
      isExported(node.parent.parent))
  );
}
function signature(node: ts.Node, checker: ts.TypeChecker): string {
  if (ts.isModuleDeclaration(node) && node.body)
    return node
      .getSourceFile()
      .text.slice(node.getStart(), node.body.getStart())
      .trim();
  const fn = ts.isExportAssignment(node)
    ? node.expression
    : ts.isVariableDeclaration(node) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) ||
          ts.isFunctionExpression(node.initializer))
      ? node.initializer
      : node;
  if (
    ts.isFunctionLike(fn) &&
    !ts.isConstructorTypeNode(fn) &&
    !ts.isFunctionTypeNode(fn)
  ) {
    const sig = checker.getSignatureFromDeclaration(fn);
    if (sig) {
      const mods = modifiers(node)
        .map((m) => m.getText())
        .join(" ");
      const prefix = ts.isFunctionDeclaration(node) ? "function " : "";
      const rendered = checker.signatureToString(
        sig,
        fn,
        ts.TypeFormatFlags.NoTruncation,
        ts.SignatureKind.Call,
      );
      const decoration = decorators(node)
        .map((d) => `@${d}`)
        .join(" ");
      return `${decoration ? `${decoration} ` : ""}${mods ? `${mods} ` : ""}${prefix}${declarationName(node)}${ts.isConstructorDeclaration(node) ? rendered.replace(/\):[^]*$/, ")") : rendered};`;
    }
  }
  if (ts.isClassLike(node) || ts.isInterfaceDeclaration(node)) {
    const end = node.members.pos;
    return node
      .getSourceFile()
      .text.slice(node.getStart(), end)
      .replace(/\{\s*$/, "")
      .trim();
  }
  if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
    const prefix = modifiers(node)
      .map((m) => m.getText())
      .join(" ");
    return `${prefix ? `${prefix} ` : ""}${declarationName(node)}: ${checker.typeToString(checker.getTypeAtLocation(node), node, ts.TypeFormatFlags.NoTruncation)};`;
  }
  return node.getText();
}

export class TypeScriptAdapter implements LanguageAdapter {
  readonly name = "typescript-compiler";
  readonly extensions = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mts",
    ".cts",
    ".mjs",
    ".cjs",
  ];
  private sourceCache = new Map<
    string,
    { hash: string; source: ts.SourceFile }
  >();
  constructor(
    private readonly enrichers: FrameworkEnricher[] = frameworkEnrichers,
  ) {}

  parse(
    root: string,
    files: FileRecord[],
    changed: Set<string>,
    onProgress?: (progress: IndexProgress) => void,
  ): ParsedFile[] {
    const maxFileBytes = loadConfig(root).limits.maxFileBytes;
    const records = new Map(files.map((f) => [resolve(root, f.path), f]));
    const groups = new Map<string, string[]>();
    for (const file of files) {
      let dir = dirname(resolve(root, file.path));
      let config = "";
      while (dir.startsWith(root)) {
        for (const name of ["tsconfig.json", "jsconfig.json"]) {
          if (existsSync(resolve(dir, name))) {
            config = resolve(dir, name);
            break;
          }
        }
        if (config || dir === root) break;
        dir = dirname(dir);
      }
      const group = groups.get(config) ?? [];
      group.push(resolve(root, file.path));
      groups.set(config, group);
    }
    const output = new Map<string, ParsedFile>();
    const activeGroups = [...groups].filter(([, paths]) =>
      paths.some((path) => changed.has(records.get(path)!.path)),
    );
    let completedGroups = 0;
    for (const [config, rootNames] of activeGroups) {
      const label = config
        ? slash(relative(root, config))
        : "default configuration";
      onProgress?.({
        phase: "analyze",
        message: `Project ${completedGroups + 1}/${activeGroups.length}: ${label} (${rootNames.length} files)`,
        completed: completedGroups,
        total: activeGroups.length,
      });
      const libraryRoot = dirname(ts.getDefaultLibFilePath({}));
      const supportReads = new Map<string, string | undefined>();
      let supportBytes = 0;
      let snapshotError: Error | undefined;
      const allowedRead = (file: string): string | undefined => {
        if (supportReads.has(file)) return supportReads.get(file);
        try {
          if (
            slash(resolve(file)).startsWith(
              `${slash(resolve(libraryRoot))}/lib.`,
            ) &&
            file.endsWith(".d.ts")
          ) {
            const text = ts.sys.readFile(file);
            supportReads.set(file, text);
            return text;
          }
          if (
            !records.has(resolve(file)) &&
            !file.endsWith(".json") &&
            !(
              /\/node_modules\//.test(slash(file)) && /\.d\.[cm]?ts$/.test(file)
            )
          )
            return undefined;
          const text = readLocal(
            root,
            slash(relative(root, file)),
            records.has(resolve(file)) ? maxFileBytes : 2_000_000,
          );
          const record = records.get(resolve(file));
          if (record && hash(text) !== record.hash) {
            snapshotError = new Error(
              `Source changed during compiler read: ${record.path}; retry indexing`,
            );
            return undefined;
          }
          if (!records.has(resolve(file))) {
            supportBytes += Buffer.byteLength(text);
            if (supportBytes > 50_000_000) {
              snapshotError = new Error("Compiler support files exceed 50 MB");
              return undefined;
            }
          }
          supportReads.set(file, text);
          return text;
        } catch {
          return undefined;
        }
      };
      let options: ts.CompilerOptions = {
        allowJs: true,
        checkJs: true,
        jsx: ts.JsxEmit.Preserve,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        skipLibCheck: true,
      };
      const configDiagnostics: string[] = [];
      if (config) {
        const read = ts.readConfigFile(config, allowedRead);
        if (read.error)
          throw new Error(
            ts.flattenDiagnosticMessageText(read.error.messageText, " "),
          );
        const parsed = ts.parseJsonConfigFileContent(
          read.config,
          {
            useCaseSensitiveFileNames: true,
            readDirectory: () => [],
            readFile: allowedRead,
            fileExists: (p) => allowedRead(p) !== undefined,
          },
          dirname(config),
        );
        // No-input diagnostics are expected: discovery, not tsconfig includes, owns scope.
        const errors = parsed.errors.filter(
          (d) => d.code !== 18003 && d.code !== 18002,
        );
        if (errors.length)
          throw new Error(
            errors
              .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
              .join("\n"),
          );
        options = {
          ...options,
          ...parsed.options,
          noEmit: true,
          allowJs: true,
        };
      }
      const host = ts.createCompilerHost(options, true);
      host.readFile = allowedRead;
      host.fileExists = (path) => allowedRead(path) !== undefined;
      host.realpath = (path) => path;
      host.getSourceFile = (file, languageVersion) => {
        const text = allowedRead(file);
        if (text === undefined) return undefined;
        const digest = hash(text);
        const cached = this.sourceCache.get(file);
        if (cached?.hash === digest) return cached.source;
        const source = ts.createSourceFile(file, text, languageVersion, true);
        this.sourceCache.set(file, { hash: digest, source });
        return source;
      };
      const sourceResolution = projectSourceResolution(
        root,
        config,
        groups,
        new Set(records.keys()),
        allowedRead,
        configDiagnostics,
      );
      sourceResolution.install(host);
      const program = ts.createProgram({ rootNames, options, host });
      if (snapshotError) throw snapshotError;
      const checker = program.getTypeChecker();
      const declarations = new Map<ts.Node, GraphNode>();
      const byFile = new Map<
        string,
        { source: ts.SourceFile; nodes: GraphNode[]; edges: GraphEdge[] }
      >();
      const ownedFiles = new Set(rootNames);
      const testCallbacks = new Map<ts.Node, GraphNode>();

      for (const source of program.getSourceFiles()) {
        const record = records.get(resolve(source.fileName));
        if (!record) continue;
        const language = /\.[cm]?jsx?$/.test(record.path)
          ? "javascript"
          : "typescript";
        const location = (node: ts.Node) => ({
          file: record.path,
          startLine:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          endLine:
            source.getLineAndCharacterOfPosition(
              Math.max(node.getStart(source), node.getEnd() - 1),
            ).line + 1,
          startOffset: node.getStart(source),
          endOffset: node.getEnd(),
        });
        const fileNode: GraphNode = {
          id: symbolId(language, record.path, "<file>"),
          kind: "file",
          name: record.path.split("/").at(-1)!,
          qualifiedName: record.path,
          language,
          location: {
            file: record.path,
            startLine: 1,
            endLine: record.lines,
            startOffset: 0,
            endOffset: source.text.length,
          },
          metadata: {},
          provenance: { ...compilerProvenance, sourceHash: record.hash },
        };
        const nodes = [fileNode];
        const edges: GraphEdge[] = [];
        const counts = new Map<string, number>();
        declarations.set(source, fileNode);
        const add = (
          ast: ts.Node,
          kind: NodeKind,
          name: string,
          parent: GraphNode,
        ): GraphNode => {
          const qualified =
            parent.kind === "file" ? name : `${parent.qualifiedName}.${name}`;
          const count = counts.get(qualified) ?? 0;
          counts.set(qualified, count + 1);
          const g: GraphNode = {
            id: symbolId(
              language,
              record.path,
              `${qualified}${count ? `~${count}` : ""}`,
            ),
            kind,
            name,
            qualifiedName: qualified,
            language,
            location: location(ast),
            signature:
              kind === "test"
                ? `test(${JSON.stringify(name)})`
                : signature(ast, checker),
            visibility: modifiers(ast).some(
              (m) => m.kind === ts.SyntaxKind.PrivateKeyword,
            )
              ? "private"
              : modifiers(ast).some(
                    (m) => m.kind === ts.SyntaxKind.ProtectedKeyword,
                  )
                ? "protected"
                : "public",
            metadata: {
              exported: isExported(ast),
              defaultExport:
                ts.isExportAssignment(ast) ||
                modifiers(ast).some(
                  (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
                ),
              decorators: decorators(ast),
              documentation: ts
                .getJSDocCommentsAndTags(ast)
                .map((comment) => comment.getText(source))
                .join("\n")
                .slice(0, 4000),
            },
            provenance: { ...compilerProvenance, sourceHash: record.hash },
          };
          for (const enricher of this.enrichers) {
            const hint = enricher.recognize(ast, g, record.path);
            if (hint) {
              g.metadata = {
                ...g.metadata,
                ...hint,
                framework: g.metadata.framework ?? hint.framework,
                frameworks: [
                  ...((g.metadata.frameworks ?? []) as string[]),
                  hint.framework,
                ],
                frameworkEvidence: "heuristic",
              };
              if (hint.kind) {
                g.kind = hint.kind;
                g.provenance = {
                  ...g.provenance,
                  source: `framework:${enricher.name}`,
                  confidence: 0.85,
                  evidence: "heuristic",
                };
              }
            }
          }
          nodes.push(g);
          declarations.set(ast, g);
          edges.push({
            from: parent.id,
            to: g.id,
            type: "CONTAINS",
            ownerFile: record.path,
            ...compilerProvenance,
            metadata: {},
          });
          if (isExported(ast))
            edges.push({
              from: fileNode.id,
              to: g.id,
              type: "EXPORTS",
              ownerFile: record.path,
              ...compilerProvenance,
              metadata: {},
            });
          return g;
        };
        const walk = (ast: ts.Node, parent: GraphNode): void => {
          let owner = parent;
          const kind = declarationKind(ast);
          if (
            kind &&
            !(ts.isVariableDeclaration(ast) && !ts.isIdentifier(ast.name))
          )
            owner = add(
              ast,
              kind,
              declarationName(ast),
              ts.isParameter(ast) && parent.kind === "constructor"
                ? (declarations.get(ast.parent.parent) ?? parent)
                : parent,
            );
          if (
            ts.isCallExpression(ast) &&
            /^(test|it)(\.(only|skip|todo))?$/.test(ast.expression.getText()) &&
            ast.arguments[0] &&
            ts.isStringLiteralLike(ast.arguments[0])
          ) {
            owner = add(ast, "test", ast.arguments[0].text, parent);
            const callback = ast.arguments.find(
              (a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a),
            );
            if (callback) testCallbacks.set(callback, owner);
          }
          ts.forEachChild(ast, (child) => walk(child, owner));
        };
        source.forEachChild((node) => walk(node, fileNode));
        byFile.set(source.fileName, { source, nodes, edges });
      }
      const targetOf = (node: ts.Node): GraphNode | undefined => {
        let sym = ts.isShorthandPropertyAssignment(node.parent)
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
        if (sym && sym.flags & ts.SymbolFlags.Alias) {
          try {
            sym = checker.getAliasedSymbol(sym);
          } catch {
            return undefined;
          }
        }
        const ds = sym?.getDeclarations() ?? [];
        const ordered = [...ds].sort(
          (a, b) =>
            Number("body" in b && !!b.body) - Number("body" in a && !!a.body),
        );
        for (const declaration of ordered) {
          const target = declarations.get(declaration);
          if (target) return target;
        }
        return undefined;
      };
      for (const [file, { source, nodes, edges }] of byFile) {
        const record = records.get(resolve(file))!;
        if (
          !ownedFiles.has(resolve(file)) ||
          !changed.has(record.path) ||
          output.has(record.path)
        )
          continue;
        const fileNode = nodes[0]!;
        const addEdge = (
          from: GraphNode,
          to: GraphNode,
          type: EdgeType,
          ast: ts.Node,
          heuristic = false,
        ): void => {
          if (from.id === to.id && type !== "CALLS") return;
          edges.push({
            from: from.id,
            to: to.id,
            type,
            ownerFile: record.path,
            ...compilerProvenance,
            ...(heuristic
              ? {
                  source: "framework-pattern",
                  confidence: 0.75,
                  evidence: "heuristic" as const,
                }
              : {}),
            sourceHash: record.hash,
            metadata: {
              ...(to.location &&
              sourceResolution.redirectedFiles.has(
                resolve(root, to.location.file),
              )
                ? { resolution: "referenced project source" }
                : {}),
              line:
                source.getLineAndCharacterOfPosition(ast.getStart()).line + 1,
            },
          });
        };
        const synthetic = (
          name: string,
          kind: NodeKind,
          ast: ts.Node,
        ): GraphNode => {
          const id = symbolId(
            fileNode.language,
            record.path,
            `<${kind}:${name}>`,
          );
          const existing = nodes.find((n) => n.id === id);
          if (existing) return existing;
          const g: GraphNode = {
            id,
            kind,
            name,
            qualifiedName: name,
            language: fileNode.language,
            location: {
              ...fileNode.location!,
              startLine:
                source.getLineAndCharacterOfPosition(ast.getStart()).line + 1,
              endLine:
                source.getLineAndCharacterOfPosition(ast.getEnd() - 1).line + 1,
              startOffset: ast.getStart(),
              endOffset: ast.getEnd(),
            },
            signature: `${kind} ${name}`,
            metadata: { entryPoint: kind === "route" },
            provenance: {
              source: "framework-pattern",
              confidence: 0.75,
              evidence: "heuristic",
              sourceHash: record.hash,
            },
          };
          nodes.push(g);
          addEdge(fileNode, g, "CONTAINS", ast, true);
          return g;
        };
        const topology = communications(
          source,
          checker,
          record,
          nodes,
          targetOf,
          (callback) => {
            const existing = declarations.get(callback);
            if (existing) return existing;
            const node = synthetic(
              `handler@${callback.getStart(source)}`,
              "function",
              callback,
            );
            node.metadata.entryPoint = true;
            node.metadata.communicationHandler = true;
            node.signature = signature(callback, checker);
            declarations.set(callback, node);
            return node;
          },
        );
        const walk = (ast: ts.Node, parent: GraphNode): void => {
          const declaration = declarations.get(ast);
          const owner =
            (declaration && !["variable", "constant"].includes(declaration.kind)
              ? declaration
              : undefined) ??
            testCallbacks.get(ast) ??
            parent;
          if (
            ts.isIdentifier(ast) ||
            (ts.isStringLiteralLike(ast) && ast.text.length <= 120)
          ) {
            const terms = (owner.metadata.searchTerms ??= []) as string[];
            const term = ast.text;
            if (terms.length < 128 && !terms.includes(term)) terms.push(term);
          }
          if (declaration?.metadata.route) {
            const route = synthetic(
              String(declaration.metadata.route),
              "route",
              ast,
            );
            addEdge(route, declaration, "CALLS", ast, true);
            addEdge(declaration, route, "ROUTED_FROM", ast, true);
          }
          if (ts.isImportDeclaration(ast) || ts.isExportDeclaration(ast)) {
            const spec = ast.moduleSpecifier;
            if (spec) {
              const target = targetOf(spec);
              if (target) {
                addEdge(
                  fileNode,
                  target,
                  ts.isImportDeclaration(ast) ? "IMPORTS" : "EXPORTS",
                  ast,
                );
              }
            }
          }
          if (ts.isCallExpression(ast) || ts.isNewExpression(ast)) {
            let target: GraphNode | undefined;
            const sig = checker.getResolvedSignature(ast);
            if (sig?.declaration) target = declarations.get(sig.declaration);
            target ??= targetOf(
              ts.isPropertyAccessExpression(ast.expression)
                ? ast.expression.name
                : ast.expression,
            );
            if (target) {
              addEdge(
                owner,
                target,
                ts.isNewExpression(ast) ? "CREATES" : "CALLS",
                ast,
              );
              if (owner.kind === "test")
                addEdge(target, owner, "TESTED_BY", ast);
            }
            const expression = ast.expression.getText();
            const route = expression.match(
              /\.(get|post|put|patch|delete|options|head|all)$/i,
            );
            const first = ast.arguments?.[0];
            if (
              route &&
              first &&
              ts.isStringLiteralLike(first) &&
              !/\b(fetch|axios|http|https|client)\./.test(expression)
            ) {
              const r = synthetic(
                `${route[1]!.toUpperCase()} ${first.text}`,
                "route",
                ast,
              );
              for (const arg of ast.arguments?.slice(1) ?? []) {
                const handler = declarations.get(arg) ?? targetOf(arg);
                if (handler) {
                  addEdge(r, handler, "CALLS", ast, true);
                  addEdge(handler, r, "ROUTED_FROM", ast, true);
                } else if (
                  ts.isArrowFunction(arg) ||
                  ts.isFunctionExpression(arg)
                ) {
                  testCallbacks.set(arg, r);
                }
              }
            }
            const db = expression.match(
              /\b(?:prisma|db)\.([\w$]+)\.(find\w*|create\w*|update\w*|delete\w*|upsert|count|aggregate)$/,
            );
            if (db) {
              const model = synthetic(db[1]!, "database_model", ast);
              const op = db[2]!;
              addEdge(
                owner,
                model,
                op.startsWith("create")
                  ? "CREATES"
                  : op.startsWith("update") || op === "upsert"
                    ? "UPDATES"
                    : op.startsWith("delete")
                      ? "DELETES"
                      : "READS",
                ast,
                true,
              );
            }
            if (
              /\.(emit|publish|on|subscribe|add)\b$/.test(expression) &&
              first &&
              ts.isStringLiteralLike(first)
            ) {
              const queue = /queue/i.test(expression);
              const event = synthetic(
                first.text,
                queue ? "queue" : "event",
                ast,
              );
              addEdge(
                owner,
                event,
                /\.(on|subscribe)$/.test(expression) ? "CONSUMES" : "EMITS",
                ast,
                true,
              );
            }
          }
          if (
            ts.isPropertyAccessExpression(ast) &&
            /^process\.env\./.test(ast.getText())
          )
            addEdge(
              owner,
              synthetic(ast.name.text, "configuration", ast),
              "CONFIGURED_BY",
              ast,
              true,
            );
          if (ts.isHeritageClause(ast))
            for (const type of ast.types) {
              const target = targetOf(type.expression);
              if (target) {
                addEdge(
                  owner,
                  target,
                  ast.token === ts.SyntaxKind.ExtendsKeyword
                    ? "EXTENDS"
                    : "IMPLEMENTS",
                  ast,
                );
                // Declaration membership, not proof of a runtime receiver.
                if (ast.token === ts.SyntaxKind.ImplementsKeyword) {
                  const instance = checker.getTypeAtLocation(ast.parent);
                  const contract = checker.getTypeAtLocation(type);
                  for (const member of checker.getPropertiesOfType(contract)) {
                    const implementation = checker.getPropertyOfType(
                      instance,
                      member.name,
                    );
                    const from = implementation?.declarations
                      ?.map((d) => declarations.get(d))
                      .find(Boolean);
                    const to = member.declarations
                      ?.map((d) => declarations.get(d))
                      .find(Boolean);
                    if (from && to && from.id !== to.id)
                      addEdge(from, to, "IMPLEMENTS", ast);
                  }
                }
              }
            }
          if (ts.isTypeReferenceNode(ast)) {
            const target = targetOf(ast.typeName);
            if (target) {
              let cursor: ts.Node = ast;
              while (
                cursor.parent !== source &&
                !ts.isParameter(cursor) &&
                !ts.isFunctionLike(cursor.parent) &&
                cursor.parent
              )
                cursor = cursor.parent;
              addEdge(
                owner,
                target,
                ts.isParameter(cursor)
                  ? "ACCEPTS"
                  : ts.isFunctionLike(cursor.parent)
                    ? "RETURNS"
                    : "REFERENCES",
                ast,
              );
            }
          }
          if (
            ts.isIdentifier(ast) &&
            !(
              "name" in ast.parent &&
              ast.parent.name === ast &&
              declarations.has(ast.parent)
            )
          ) {
            const target = targetOf(ast);
            if (target) {
              addEdge(owner, target, "REFERENCES", ast);
              if (owner.kind === "test")
                addEdge(target, owner, "TESTED_BY", ast);
              if (target.kind === "property") {
                const expression = ts.isPropertyAccessExpression(ast.parent)
                  ? ast.parent
                  : ast;
                const p = expression.parent;
                const writing =
                  (ts.isBinaryExpression(p) &&
                    p.left === expression &&
                    p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
                    p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
                  ((ts.isPrefixUnaryExpression(p) ||
                    ts.isPostfixUnaryExpression(p)) &&
                    (p.operator === ts.SyntaxKind.PlusPlusToken ||
                      p.operator === ts.SyntaxKind.MinusMinusToken));
                addEdge(owner, target, writing ? "WRITES" : "READS", ast);
              }
            }
          }
          if (ts.isThrowStatement(ast)) {
            const exceptions = (owner.metadata.exceptions ?? []) as string[];
            if (exceptions.length < 20)
              exceptions.push(ast.expression.getText().slice(0, 300));
            owner.metadata.exceptions = exceptions;
          }
          ts.forEachChild(ast, (child) => walk(child, owner));
        };
        source.forEachChild((node) => walk(node, fileNode));
        fileNode.metadata.communications = topology.endpoints;
        fileNode.metadata.communicationsTruncated = topology.truncated;
        const syntax = program
          .getSyntacticDiagnostics(source)
          .map(
            (d) =>
              `${record.path}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
          );
        output.set(record.path, {
          file: record,
          nodes,
          edges,
          diagnostics: [...configDiagnostics, ...syntax],
        });
      }
      completedGroups++;
      onProgress?.({
        phase: "analyze",
        message: `Finished project ${completedGroups}/${activeGroups.length}: ${label}`,
        completed: completedGroups,
        total: activeGroups.length,
      });
    }
    // Drop ASTs for removed repository files, retaining standard library reuse.
    for (const path of this.sourceCache.keys())
      if (path.startsWith(root) && !records.has(path))
        this.sourceCache.delete(path);
    for (const file of changed)
      if (!output.has(file))
        throw new Error(`Compiler did not extract discovered file: ${file}`);
    return [...output.values()];
  }
}
