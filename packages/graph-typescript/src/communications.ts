import ts from "typescript";
import type {
  CommunicationEndpoint,
  FileRecord,
  GraphNode,
} from "@praesidia/pgraph-ir";

type Value = { address?: string; setting?: string };
const literal = (node: ts.Node | undefined): string | undefined =>
  node && ts.isStringLiteralLike(node) ? node.text.slice(0, 500) : undefined;
function env(node: ts.Node | undefined): string | undefined {
  if (!node) return;
  if (
    ts.isPropertyAccessExpression(node) &&
    node.expression.getText() === "process.env"
  )
    return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    node.expression.getText() === "process.env"
  )
    return literal(node.argumentExpression);
  return;
}
function value(node: ts.Node | undefined): Value {
  const address = literal(node);
  if (address !== undefined) return { address };
  const setting = env(node);
  if (setting) return { setting };
  if (
    node &&
    ts.isTemplateExpression(node) &&
    node.head.text === "" &&
    node.templateSpans.length === 1
  ) {
    const span = node.templateSpans[0]!;
    if (env(span.expression))
      return {
        setting: env(span.expression),
        address: span.literal.text.slice(0, 500),
      };
  }
  return {};
}
const property = (
  node: ts.Node | undefined,
  key: string,
): ts.Expression | undefined =>
  node && ts.isObjectLiteralExpression(node)
    ? node.properties.flatMap((p) =>
        ts.isPropertyAssignment(p) &&
        p.name.getText().replace(/^['"]|['"]$/g, "") === key
          ? [p.initializer]
          : [],
      )[0]
    : undefined;
export function cleanAddress(address: string | undefined): string | undefined {
  if (address === undefined) return;
  if (/^https?:\/\//i.test(address)) {
    try {
      const u = new URL(address);
      if (u.username || u.password) return;
      return u.origin + u.pathname;
    } catch {
      return;
    }
  }
  return address.includes("=") || address.includes(";")
    ? undefined
    : address.split(/[?#]/)[0]?.slice(0, 500);
}

/** Imported API identities are resolved through local symbols; repository code is never run. */
export function communications(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  record: FileRecord,
  nodes: GraphNode[],
): { endpoints: CommunicationEndpoint[]; truncated: boolean } {
  const imports = new Map<ts.Symbol, string>();
  const instances = new Map<
    ts.Symbol,
    { kind: string; resource?: string; setting?: string }
  >();
  const endpoints: CommunicationEndpoint[] = [];
  let truncated = false;
  const sym = (node: ts.Node) => checker.getSymbolAtLocation(node);
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const module = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause?.isTypeOnly) continue;
    if (clause?.name) {
      const s = sym(clause.name);
      if (s) imports.set(s, `${module}:default`);
    }
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const item of bindings.elements) {
        const s = sym(item.name);
        if (s && !item.isTypeOnly)
          imports.set(
            s,
            `${module}:${item.propertyName?.text ?? item.name.text}`,
          );
      }
    if (bindings && ts.isNamespaceImport(bindings)) {
      const s = sym(bindings.name);
      if (s) imports.set(s, `${module}:*`);
    }
  }
  for (const statement of source.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const)
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (
        !call ||
        !ts.isCallExpression(call) ||
        !ts.isIdentifier(call.expression) ||
        call.expression.text !== "require"
      )
        continue;
      if (
        sym(call.expression)?.declarations?.some(
          (d) => !d.getSourceFile().isDeclarationFile,
        )
      )
        continue;
      const module = literal(call.arguments[0]);
      if (!module) continue;
      if (ts.isIdentifier(declaration.name)) {
        const id = sym(declaration.name);
        if (id)
          imports.set(
            id,
            `${module}:${["axios", "express"].includes(module) ? "default" : "*"}`,
          );
      } else if (ts.isObjectBindingPattern(declaration.name)) {
        for (const binding of declaration.name.elements) {
          const id = sym(binding.name);
          if (id && !binding.dotDotDotToken)
            imports.set(
              id,
              `${module}:${binding.propertyName?.getText() ?? binding.name.getText()}`,
            );
        }
      }
    }
  }
  const imported = (node: ts.Expression): string | undefined => {
    const s = sym(node);
    if (s && imports.has(s)) return imports.get(s);
    if (ts.isPropertyAccessExpression(node)) {
      const base = sym(node.expression);
      const name = base && imports.get(base);
      if (name?.endsWith(":*")) return name.slice(0, -1) + node.name.text;
    }
    return;
  };
  const object = (node: ts.Expression) => {
    const s = sym(node);
    return s ? instances.get(s) : undefined;
  };
  const add = (
    ast: ts.Node,
    protocol: CommunicationEndpoint["protocol"],
    direction: CommunicationEndpoint["direction"],
    details: Partial<CommunicationEndpoint>,
    extractor: string,
  ) => {
    if (endpoints.length >= 200) {
      truncated = true;
      return;
    }
    const start = ast.getStart(source),
      end = ast.getEnd();
    const owner =
      nodes
        .filter(
          (n) =>
            n.location &&
            n.location.startOffset <= start &&
            n.location.endOffset >= end,
        )
        .sort(
          (a, b) =>
            a.location!.endOffset -
            a.location!.startOffset -
            (b.location!.endOffset - b.location!.startOffset),
        )[0] ?? nodes[0]!;
    endpoints.push({
      id: `${record.path}:${start}:${endpoints.length}`,
      protocol,
      direction,
      ...details,
      address: cleanAddress(details.address),
      location: {
        file: record.path,
        startOffset: start,
        endOffset: end,
        startLine: source.getLineAndCharacterOfPosition(start).line + 1,
        endLine:
          source.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line +
          1,
      },
      symbolId: owner.id,
      provenance: {
        source: extractor,
        evidence: "heuristic",
        confidence: 0.85,
        sourceHash: record.hash,
      },
    });
  };
  const methods = (options: ts.Expression | undefined): string[] => {
    if (
      !options ||
      !ts.isObjectLiteralExpression(options) ||
      options.properties.some(ts.isSpreadAssignment)
    )
      return ["?"];
    const m = property(options, "methods");
    if (!m) return ["*"];
    return ts.isArrayLiteralExpression(m)
      ? m.elements
          .map(literal)
          .filter((x): x is string => !!x)
          .map((x) => x.toUpperCase())
      : ["?"];
  };
  const visit = (ast: ts.Node): void => {
    if (
      ts.isVariableDeclaration(ast) &&
      ts.isIdentifier(ast.name) &&
      ast.initializer &&
      ast.parent.flags & ts.NodeFlags.Const
    ) {
      const init = ast.initializer;
      const s = sym(ast.name);
      if (s && (ts.isCallExpression(init) || ts.isNewExpression(init))) {
        const api = imported(init.expression);
        const arg = init.arguments?.[0];
        if (api === "express:default") instances.set(s, { kind: "express" });
        if (api === "@azure/service-bus:ServiceBusClient") {
          const v = value(arg);
          const namespace =
            v.address &&
            /^[a-z0-9.-]+\.servicebus\.windows\.net$/i.test(v.address)
              ? v.address.toLowerCase()
              : undefined;
          instances.set(s, {
            kind: "service-bus",
            resource: namespace,
            setting: v.setting,
          });
        }
        if (api === "@azure/eventgrid:EventGridPublisherClient") {
          const v = value(arg);
          instances.set(s, {
            kind: "event-grid",
            resource: cleanAddress(v.address),
            setting: v.setting,
          });
        }
      }
    }
    if (ts.isCallExpression(ast)) {
      const expression = ast.expression;
      const api = imported(expression);
      if (
        ts.isIdentifier(expression) &&
        expression.text === "fetch" &&
        (!sym(expression)?.declarations?.length ||
          sym(expression)!.declarations!.every(
            (d) => d.getSourceFile().isDeclarationFile,
          ))
      ) {
        add(
          ast,
          "http",
          "request",
          {
            ...value(ast.arguments[0]),
            method:
              ast.arguments[1] &&
              (!ts.isObjectLiteralExpression(ast.arguments[1]) ||
                ast.arguments[1].properties.some(ts.isSpreadAssignment))
                ? "?"
                : property(ast.arguments[1], "method")
                  ? (literal(
                      property(ast.arguments[1], "method"),
                    )?.toUpperCase() ?? "?")
                  : "GET",
          },
          "global-fetch",
        );
      }
      if (api === "axios:default")
        add(
          ast,
          "http",
          "request",
          {
            ...value(ast.arguments[0]),
            method:
              literal(property(ast.arguments[1], "method"))?.toUpperCase() ??
              "?",
          },
          "axios",
        );
      if (ts.isPropertyAccessExpression(expression)) {
        const receiver = imported(expression.expression);
        const method = expression.name.text;
        const instance = object(expression.expression);
        if (
          receiver === "axios:default" &&
          ["get", "post", "put", "patch", "delete", "head", "options"].includes(
            method,
          )
        )
          add(
            ast,
            "http",
            "request",
            { ...value(ast.arguments[0]), method: method.toUpperCase() },
            "axios",
          );
        if (
          instance?.kind === "express" &&
          ast.arguments.length >= 2 &&
          [
            "get",
            "post",
            "put",
            "patch",
            "delete",
            "head",
            "options",
            "all",
          ].includes(method)
        )
          add(
            ast,
            "http",
            "provide",
            {
              address: literal(ast.arguments[0]),
              method: method === "all" ? "*" : method.toUpperCase(),
            },
            "express-route",
          );
        if (receiver === "@azure/functions:app") {
          const options = ast.arguments[1];
          if (method === "http")
            for (const m of methods(options))
              add(
                ast,
                "http",
                "provide",
                {
                  address:
                    !options ||
                    !ts.isObjectLiteralExpression(options) ||
                    options.properties.some(ts.isSpreadAssignment)
                      ? undefined
                      : (literal(property(options, "route")) ??
                        (property(options, "route")
                          ? undefined
                          : literal(ast.arguments[0]))),
                  method: m,
                },
                "azure-http",
              );
          const protocol = ["serviceBusQueue", "serviceBusTopic"].includes(
            method,
          )
            ? "service-bus"
            : method === "storageQueue"
              ? "storage-queue"
              : method === "eventGrid"
                ? "event-grid"
                : undefined;
          if (protocol)
            add(
              ast,
              protocol,
              "subscribe",
              {
                address:
                  literal(property(options, "queueName")) ??
                  literal(property(options, "topicName")) ??
                  (protocol === "event-grid" ? "*" : undefined),
                setting: literal(property(options, "connection")),
                channelKind: property(options, "queueName")
                  ? "queue"
                  : property(options, "topicName")
                    ? "topic"
                    : undefined,
              },
              "azure-trigger",
            );
        }
        if (receiver === "@azure/functions:output") {
          const options = ast.arguments[0];
          const protocol = ["serviceBusQueue", "serviceBusTopic"].includes(
            method,
          )
            ? "service-bus"
            : method === "storageQueue"
              ? "storage-queue"
              : method === "eventGrid"
                ? "event-grid"
                : undefined;
          if (protocol)
            add(
              ast,
              protocol,
              "publish",
              {
                address:
                  literal(property(options, "queueName")) ??
                  literal(property(options, "topicName")) ??
                  (protocol === "event-grid" ? "*" : undefined),
                channelKind: property(options, "queueName")
                  ? "queue"
                  : property(options, "topicName")
                    ? "topic"
                    : undefined,
                setting:
                  literal(property(options, "connection")) ??
                  literal(property(options, "topicEndpointUri")),
              },
              "azure-output-binding",
            );
        }
        if (
          instance?.kind === "service-bus" &&
          ["createSender", "createReceiver"].includes(method)
        )
          add(
            ast,
            "service-bus",
            method === "createSender" ? "publish" : "subscribe",
            {
              address: literal(ast.arguments[0]),
              resource: instance.resource,
              setting: instance.setting,
              channelKind:
                method === "createReceiver"
                  ? ast.arguments[1] && ts.isStringLiteralLike(ast.arguments[1])
                    ? "topic"
                    : "queue"
                  : undefined,
            },
            "azure-service-bus-client-declaration",
          );
        if (instance?.kind === "event-grid" && method === "send")
          add(
            ast,
            "event-grid",
            "publish",
            {
              address: "*",
              resource: instance.resource,
              setting: instance.setting,
            },
            "azure-event-grid-client",
          );
      }
    }
    ts.forEachChild(ast, visit);
  };
  visit(source);
  return { endpoints, truncated };
}
