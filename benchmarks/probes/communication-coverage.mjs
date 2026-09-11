import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { TypeScriptAdapter } from "../../packages/graph-typescript/dist/index.js";
import { discover } from "../../packages/graph-indexer/dist/discovery.js";
import { hash, loadConfig } from "../../packages/shared/dist/index.js";

// Explicit read-only compiler survey. Does not open a graph DB, index, execute code,
// read local.settings.json, or publish source text. Detailed paths stay in the local report.
const root = realpathSync(resolve(process.argv[2] ?? "."));
const output = resolve(
  process.argv[3] ?? join(tmpdir(), "pgraph-communication-coverage.json"),
);
const roots = existsSync(join(root, ".git"))
  ? [root]
  : readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && existsSync(join(root, entry.name, ".git")),
      )
      .map((entry) => join(root, entry.name))
      .sort()
      .slice(0, 64);
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  engineVersion: JSON.parse(readFileSync("package.json", "utf8")).version,
  extractorSha256: hash(
    readFileSync("packages/graph-typescript/dist/communications.js"),
  ),
  method:
    "Read-only source discovery and compiler extraction in direct child Git roots with Azure runtime dependencies. Includes utility/load-test scripts. Counts syntax candidates, not runtime or exhaustive recall. No graph index or source is written.",
  rootsDiscovered: roots.length,
  projects: [],
  limitations: [
    "Only supported TS/JS discovery and selected Azure dependency roots.",
    "Syntax candidates can include unreachable or unrelated operations; manual verification is required.",
    "No deployment, payload compatibility or complete task outcome measurement.",
  ],
};
const count = (map, key) => (map[key] = (map[key] ?? 0) + 1);
for (const [index, projectRoot] of roots.entries()) {
  const manifest = join(projectRoot, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  const deps = Object.keys({
    ...pkg.dependencies,
    ...pkg.devDependencies,
  }).filter((name) =>
    ["@azure/functions", "@azure/service-bus", "@azure/eventgrid"].includes(
      name,
    ),
  );
  if (!deps.length) continue;
  const started = performance.now(),
    snapshot = discover(projectRoot, loadConfig(projectRoot));
  const candidates = [],
    shapes = {};
  const sources = snapshot.sources.filter(
    (file) =>
      !/(^|\/)(?:tests?|__tests__|__mocks__|test-suites)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(
        file.path,
      ),
  );
  for (const file of sources) {
    const source = ts.createSourceFile(
      file.path,
      readFileSync(join(projectRoot, file.path), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const apps = new Set();
    for (const statement of source.statements)
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "@azure/functions" &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)
      )
        for (const binding of statement.importClause.namedBindings.elements)
          if ((binding.propertyName?.text ?? binding.name.text) === "app")
            apps.add(binding.name.text);
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const receiver = node.expression.expression,
          method = node.expression.name.text;
        const registration =
          ts.isIdentifier(receiver) &&
          apps.has(receiver.text) &&
          [
            "http",
            "serviceBusQueue",
            "serviceBusTopic",
            "storageQueue",
            "eventGrid",
          ].includes(method);
        if (
          registration ||
          [
            "sendMessages",
            "createSender",
            "createReceiver",
            "scheduleMessages",
          ].includes(method)
        ) {
          const key = registration ? `app.${method}` : method;
          count(shapes, `${key} receiver:${ts.SyntaxKind[receiver.kind]}`);
          const details = {
            file: file.path,
            line:
              source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            offset: node.getStart(),
            kind: key,
            receiverKind: ts.SyntaxKind[receiver.kind],
          };
          if (registration) {
            const options = node.arguments[1];
            details.optionsKind = options
              ? ts.SyntaxKind[options.kind]
              : "missing";
            if (options && ts.isObjectLiteralExpression(options))
              details.properties = Object.fromEntries(
                options.properties
                  .filter(ts.isPropertyAssignment)
                  .map((p) => [
                    p.name.getText(),
                    ts.SyntaxKind[p.initializer.kind],
                  ]),
              );
          }
          candidates.push(details);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  process.stdout.write(
    `Survey ${index + 1}/${roots.length}: ${sources.length} non-test source files; ${candidates.length} syntax sites\n`,
  );
  const changed = new Set(candidates.map((site) => site.file));
  const parsed = new TypeScriptAdapter().parse(
    projectRoot,
    snapshot.sources,
    changed,
  );
  const endpoints = parsed.flatMap((file) =>
    file.nodes.flatMap((node) =>
      node.kind === "file" ? (node.metadata.communications ?? []) : [],
    ),
  );
  const sites = candidates.map((site) => {
    const matches = endpoints.filter(
      (endpoint) =>
        endpoint.location.file === site.file &&
        endpoint.location.startOffset === site.offset,
    );
    return {
      ...site,
      extracted: matches.length,
      hasAddress: matches.some((e) => e.address !== undefined),
      hasChannelSetting: matches.some((e) => e.addressSetting),
      hasResourceIdentity: matches.some((e) => e.resource || e.setting),
      linkedExecution: matches.some((e) => e.execution?.symbols.length),
      unresolved: [
        ...new Set(
          matches.flatMap((e) =>
            e.execution?.unresolved ? [e.execution.unresolved] : [],
          ),
        ),
      ],
    };
  });
  report.projects.push({
    project: hash(projectRoot).slice(0, 24),
    directory: relative(root, projectRoot) || ".",
    dependencies: deps,
    sourceFiles: sources.length,
    sourceFingerprint: hash(
      sources
        .map((file) => `${file.path}:${file.hash}`)
        .sort()
        .join("\n"),
    ),
    configuredServices: loadConfig(projectRoot).topology.services.length,
    syntaxSites: sites.length,
    extractedSites: sites.filter((site) => site.extracted).length,
    linkedExecutionSites: sites.filter((site) => site.linkedExecution).length,
    queryMilliseconds: Math.round(performance.now() - started),
    shapes,
    sites,
  });
}
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(
  JSON.stringify({
    output,
    rootsDiscovered: report.rootsDiscovered,
    azureProjects: report.projects.length,
    sourceFiles: report.projects.reduce((n, p) => n + p.sourceFiles, 0),
    syntaxSites: report.projects.reduce((n, p) => n + p.syntaxSites, 0),
    extractedSites: report.projects.reduce((n, p) => n + p.extractedSites, 0),
    linkedExecutionSites: report.projects.reduce(
      (n, p) => n + p.linkedExecutionSites,
      0,
    ),
  }) + "\n",
);
