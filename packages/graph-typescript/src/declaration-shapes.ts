import ts from "typescript";
import { hash } from "@praesidia/pgraph-shared";

/** Exact source fingerprints; name-only matches are candidates, not symbol identity. */
export function declarationShapes(file: string, source: string) {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const options = {
    noLib: true,
    noResolve: true,
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
  };
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === file ? parsed : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    fileExists: (name) => name === file,
    readFile: (name) => (name === file ? source : undefined),
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const diagnostics = ts
    .createProgram([file], options, host)
    .getSyntacticDiagnostics(parsed);
  if (diagnostics.length)
    throw new Error(
      `Syntax diagnostics in ${file}; declaration comparison is unknown`,
    );
  const shapes = new Map<
    string,
    { hash: string; renamed?: string; header?: string }
  >();
  const walk = (node: ts.Node): void => {
    const start = node.getStart(parsed),
      end = node.getEnd();
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isExportAssignment(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node)
    ) {
      const name = "name" in node ? node.name : undefined;
      const initializer =
        "initializer" in node
          ? (node.initializer as ts.Node | undefined)
          : undefined;
      const value = ts.isExportAssignment(node) ? node.expression : initializer;
      const callable =
        value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
          ? value
          : node;
      const body =
        "body" in callable ? (callable.body as ts.Node | undefined) : undefined;
      const headerEnd = body
        ? body.getStart(parsed)
        : ts.isClassDeclaration(node)
          ? node.members.pos
          : initializer
            ? initializer.getStart(parsed)
            : end;
      const headerText = source.slice(start, headerEnd);
      const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        true,
        ts.LanguageVariant.Standard,
        headerText,
      );
      const headerTokens: string[] = [];
      while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken)
        headerTokens.push(scanner.getTokenText());
      shapes.set(`${start}:${end}`, {
        hash: hash(source.slice(start, end)),
        renamed:
          name && (ts.isIdentifier(name) || ts.isStringLiteral(name))
            ? hash(
                source.slice(start, name.getStart(parsed)) +
                  "<declaration-name>" +
                  source.slice(name.getEnd(), end),
              )
            : undefined,
        header: JSON.stringify(headerTokens),
      });
    }
    ts.forEachChild(node, walk);
  };
  walk(parsed);
  return shapes;
}
