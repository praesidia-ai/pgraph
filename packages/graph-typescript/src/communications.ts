import ts from "typescript";
import { staticExpressions, unwrap } from "./static-expressions.js";
import type {
  CommunicationEndpoint,
  FileRecord,
  GraphNode,
} from "@praesidia/pgraph-ir";

const literal = (node: ts.Node | undefined): string | undefined =>
  node && ts.isStringLiteralLike(node) ? node.text.slice(0, 500) : undefined;
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
  resolveTarget?: (node: ts.Node) => GraphNode | undefined,
  registerHandler?: (
    node: ts.ArrowFunction | ts.FunctionExpression,
  ) => GraphNode,
): { endpoints: CommunicationEndpoint[]; truncated: boolean } {
  const { value, property, object: objectOptions } = staticExpressions(checker);
  const textValue = (node: ts.Expression | undefined) => {
    const result = value(node);
    return result.setting ? undefined : result.address;
  };
  const channel = (
    node: ts.Expression | undefined,
    azure = false,
  ): Pick<
    CommunicationEndpoint,
    "address" | "addressSetting" | "addressFallback"
  > => {
    const result = value(node);
    const placeholder =
      azure && result.address?.match(/^%([a-zA-Z_][a-zA-Z0-9_]{0,99})%$/);
    return result.setting
      ? {
          addressSetting: result.setting,
          addressFallback:
            result.fallback && /^[a-zA-Z0-9._/-]{1,200}$/.test(result.fallback)
              ? result.fallback
              : undefined,
        }
      : placeholder
        ? { addressSetting: placeholder[1] }
        : { address: result.address };
  };
  const requestValue = (node: ts.Expression | undefined) => {
    const result = value(node);
    return { address: result.address, setting: result.setting };
  };
  const imports = new Map<ts.Symbol, string>();
  const instances = new Map<
    ts.Symbol,
    {
      kind: string;
      resource?: string;
      setting?: string;
      address?: string;
      channelKind?: "queue" | "topic";
      addressSetting?: string;
      addressFallback?: string;
    }
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
  const object = (
    node: ts.Expression,
    depth = 0,
  ):
    | {
        kind: string;
        resource?: string;
        setting?: string;
        address?: string;
        channelKind?: "queue" | "topic";
        addressSetting?: string;
        addressFallback?: string;
      }
    | undefined => {
    if (depth > 5) return;
    const s = sym(node);
    if (!s) return;
    if (instances.has(s)) return instances.get(s);
    const declaration = s.declarations?.find(ts.isVariableDeclaration);
    if (
      !declaration?.initializer ||
      !ts.isIdentifier(declaration.name) ||
      !(declaration.parent.flags & ts.NodeFlags.Const)
    )
      return;
    const init = unwrap(declaration.initializer);
    if (ts.isIdentifier(init)) return object(init, depth + 1);
    if (!ts.isCallExpression(init) && !ts.isNewExpression(init)) return;
    const api = imported(init.expression);
    let instance: ReturnType<typeof object>;
    if (api === "express:default") instance = { kind: "express" };
    if (api === "@azure/service-bus:ServiceBusClient") {
      const v = value(init.arguments?.[0]);
      instance = {
        kind: "service-bus",
        setting: v.setting,
        resource:
          v.address &&
          /^[a-z0-9.-]+\.servicebus\.windows\.net$/i.test(v.address)
            ? v.address.toLowerCase()
            : undefined,
      };
    }
    if (api === "@azure/eventgrid:EventGridPublisherClient") {
      const v = value(init.arguments?.[0]);
      instance = {
        kind: "event-grid",
        setting: v.setting,
        resource: cleanAddress(v.address),
      };
    }
    if (ts.isPropertyAccessExpression(init.expression)) {
      const base = object(init.expression.expression, depth + 1);
      const method = init.expression.name.text;
      if (
        base?.kind === "service-bus" &&
        ["createSender", "createReceiver"].includes(method)
      )
        instance = {
          ...base,
          kind:
            method === "createSender"
              ? "service-bus-sender"
              : "service-bus-receiver",
          ...channel(init.arguments?.[0]),
          channelKind:
            method === "createReceiver"
              ? literal(init.arguments?.[1])
                ? "topic"
                : "queue"
              : undefined,
        };
      if (imported(init.expression.expression) === "@azure/functions:output") {
        const options = init.arguments?.[0];
        const protocol = ["serviceBusQueue", "serviceBusTopic"].includes(method)
          ? "service-bus"
          : method === "storageQueue"
            ? "storage-queue"
            : method === "eventGrid"
              ? "event-grid"
              : undefined;
        if (protocol && objectOptions(options))
          instance = {
            kind: `binding:${protocol}`,
            ...(protocol === "event-grid"
              ? { address: "*" }
              : channel(
                  property(options, "queueName") ??
                    property(options, "topicName"),
                  true,
                )),
            setting:
              textValue(property(options, "connection")) ??
              textValue(property(options, "topicEndpointUri")),
            channelKind: property(options, "queueName")
              ? "queue"
              : property(options, "topicName")
                ? "topic"
                : undefined,
          };
      }
    }
    if (instance) instances.set(s, instance);
    return instance;
  };
  const handlerContexts = new Set<ts.Symbol>();
  const handlers = (
    expressions: readonly ts.Expression[],
    azureContext = false,
  ): NonNullable<CommunicationEndpoint["execution"]> => {
    const symbols: string[] = [];
    let unresolved: string | undefined;
    for (const original of expressions.slice(0, 8)) {
      const expression = unwrap(original);
      if (azureContext) {
        let symbol = ts.isShorthandPropertyAssignment(expression.parent)
          ? checker.getShorthandAssignmentValueSymbol(expression.parent)
          : sym(expression);
        if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias)
          symbol = checker.getAliasedSymbol(symbol);
        const declared =
          ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)
            ? expression
            : symbol?.declarations?.[0];
        const callback =
          declared && ts.isVariableDeclaration(declared)
            ? declared.initializer
            : declared;
        if (
          callback &&
          ts.isFunctionLike(callback) &&
          callback.parameters[1] &&
          callback.getSourceFile() === source
        ) {
          const context = sym(callback.parameters[1].name);
          if (context) handlerContexts.add(context);
        }
      }
      const target =
        ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)
          ? expression.getSourceFile() === source
            ? registerHandler?.(expression)
            : undefined
          : resolveTarget?.(expression);
      if (
        target &&
        ["function", "method", "event_handler", "queue_handler"].includes(
          target.kind,
        )
      )
        symbols.push(target.id);
      else
        unresolved = "Handler is dynamic, external or not an indexed callable";
    }
    if (!expressions.length || expressions.length > 8)
      unresolved =
        "Handler selection is unavailable or exceeds eight candidates";
    return {
      kind: "handler",
      symbols: [...new Set(symbols)],
      ...(unresolved ? { unresolved } : {}),
    };
  };
  const configuredHandler = (options: ts.Expression | undefined) => {
    const expression = objectOptions(options)
      ? property(options, "handler")
      : undefined;
    return handlers(expression ? [expression] : [], true);
  };
  // Collect callback ownership/context before visiting function bodies declared earlier.
  const prepare = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      imported(node.expression.expression) === "@azure/functions:app" &&
      [
        "http",
        "serviceBusQueue",
        "serviceBusTopic",
        "storageQueue",
        "eventGrid",
      ].includes(node.expression.name.text)
    )
      configuredHandler(node.arguments[1]);
    ts.forEachChild(node, prepare);
  };
  prepare(source);
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
    let callable: ts.Node | undefined = ast.parent;
    while (callable && !ts.isFunctionLike(callable)) callable = callable.parent;
    const declaration =
      callable &&
      ts.isVariableDeclaration(callable.parent) &&
      callable.parent.initializer === callable
        ? callable.parent
        : callable;
    const owner =
      nodes
        .filter(
          (n) =>
            n.location &&
            declaration &&
            n.location.startOffset === declaration.getStart(source) &&
            n.location.endOffset === declaration.getEnd() &&
            [
              "function",
              "method",
              "constructor",
              "event_handler",
              "queue_handler",
              "test",
              "hook",
              "component",
            ].includes(n.kind) &&
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
      execution: details.execution ?? {
        kind: "call",
        symbols: owner.kind === "file" ? [] : [owner.id],
        ...(owner.kind === "file"
          ? { unresolved: "Operation is outside an indexed callable" }
          : {}),
      },
      provenance: {
        source: extractor,
        evidence: "heuristic",
        confidence: 0.85,
        sourceHash: record.hash,
      },
    });
  };
  const methods = (options: ts.Expression | undefined): string[] => {
    if (!objectOptions(options)) return ["?"];
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
            ...requestValue(ast.arguments[0]),
            method:
              ast.arguments[1] && !objectOptions(ast.arguments[1])
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
            ...requestValue(ast.arguments[0]),
            method:
              textValue(property(ast.arguments[1], "method"))?.toUpperCase() ??
              "?",
          },
          "axios",
        );
      if (ts.isPropertyAccessExpression(expression)) {
        const receiver = imported(expression.expression);
        const method = expression.name.text;
        const instance = object(expression.expression);
        if (
          method === "set" &&
          ts.isPropertyAccessExpression(expression.expression) &&
          expression.expression.name.text === "extraOutputs"
        ) {
          const context = sym(expression.expression.expression);
          const parameter = context?.declarations?.find(ts.isParameter);
          const annotation = parameter?.type;
          const typeSymbol =
            annotation && ts.isTypeReferenceNode(annotation)
              ? checker.getSymbolAtLocation(annotation.typeName)
              : undefined;
          const importedContext = typeSymbol?.declarations?.some(
            (declaration) =>
              ts.isImportSpecifier(declaration) &&
              (declaration.propertyName?.text ?? declaration.name.text) ===
                "InvocationContext" &&
              ts.isImportDeclaration(declaration.parent.parent.parent) &&
              literal(declaration.parent.parent.parent.moduleSpecifier) ===
                "@azure/functions",
          );
          const binding = ast.arguments[0] && object(ast.arguments[0]);
          if (
            context &&
            (handlerContexts.has(context) || importedContext) &&
            binding?.kind.startsWith("binding:")
          )
            add(
              ast,
              binding.kind.slice(8) as CommunicationEndpoint["protocol"],
              "publish",
              {
                address: binding.address,
                addressSetting: binding.addressSetting,
                addressFallback: binding.addressFallback,
                setting: binding.setting,
                channelKind: binding.channelKind,
              },
              "azure-extra-output-write",
            );
        }
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
            { ...requestValue(ast.arguments[0]), method: method.toUpperCase() },
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
              address: textValue(ast.arguments[0]),
              method: method === "all" ? "*" : method.toUpperCase(),
              execution: handlers(ast.arguments.slice(1)),
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
                  address: !objectOptions(options)
                    ? undefined
                    : (textValue(property(options, "route")) ??
                      (property(options, "route")
                        ? undefined
                        : literal(ast.arguments[0]))),
                  method: m,
                  execution: configuredHandler(options),
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
                ...(protocol === "event-grid"
                  ? { address: "*" }
                  : channel(
                      property(options, "queueName") ??
                        property(options, "topicName"),
                      true,
                    )),
                setting: textValue(property(options, "connection")),
                channelKind: property(options, "queueName")
                  ? "queue"
                  : property(options, "topicName")
                    ? "topic"
                    : undefined,
                execution: configuredHandler(options),
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
                ...(protocol === "event-grid"
                  ? { address: "*" }
                  : channel(
                      property(options, "queueName") ??
                        property(options, "topicName"),
                      true,
                    )),
                channelKind: property(options, "queueName")
                  ? "queue"
                  : property(options, "topicName")
                    ? "topic"
                    : undefined,
                setting:
                  textValue(property(options, "connection")) ??
                  textValue(property(options, "topicEndpointUri")),
                execution: {
                  kind: "declaration",
                  symbols: [],
                  unresolved:
                    "Output binding configuration is not an observed write operation",
                },
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
              ...channel(ast.arguments[0]),
              resource: instance.resource,
              setting: instance.setting,
              channelKind:
                method === "createReceiver"
                  ? ast.arguments[1] && ts.isStringLiteralLike(ast.arguments[1])
                    ? "topic"
                    : "queue"
                  : undefined,
              execution: {
                kind: "declaration",
                symbols: [],
                unresolved:
                  "Client creation is not a send operation or handler registration",
              },
            },
            "azure-service-bus-client-declaration",
          );
        if (
          instance?.kind === "service-bus-sender" &&
          ["sendMessages", "scheduleMessages"].includes(method)
        )
          add(
            ast,
            "service-bus",
            "publish",
            {
              address: instance.address,
              addressSetting: instance.addressSetting,
              addressFallback: instance.addressFallback,
              resource: instance.resource,
              setting: instance.setting,
            },
            method === "scheduleMessages"
              ? "azure-service-bus-schedule"
              : "azure-service-bus-send",
          );
        if (
          instance?.kind === "service-bus-receiver" &&
          method === "subscribe"
        ) {
          const options = ast.arguments[0];
          const handler = objectOptions(options)
            ? property(options, "processMessage")
            : undefined;
          add(
            ast,
            "service-bus",
            "subscribe",
            {
              address: instance.address,
              addressSetting: instance.addressSetting,
              addressFallback: instance.addressFallback,
              resource: instance.resource,
              setting: instance.setting,
              channelKind: instance.channelKind,
              execution: handlers(handler ? [handler] : []),
            },
            "azure-service-bus-subscribe",
          );
        }
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
