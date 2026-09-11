import ts from "typescript";

export interface StaticValue {
  address?: string;
  setting?: string;
  fallback?: string;
}
export function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (let i = 0; i < 16; i++) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current)
    )
      current = current.expression;
    else break;
  }
  return current;
}
/** Bounded symbolic reads only. Never evaluates a call or reads environment values. */
export function staticExpressions(checker: ts.TypeChecker) {
  const stableObjects = new WeakMap<ts.Expression, boolean>();
  const objectIsStable = (expression: ts.Expression): boolean => {
    const cached = stableObjects.get(expression);
    if (cached !== undefined) return cached;
    let symbol = checker.getSymbolAtLocation(expression);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
    if (!declaration || !symbol) return false;
    let safe = true,
      visited = 0;
    const same = (node: ts.Node) => {
      let other = checker.getSymbolAtLocation(node);
      if (other?.flags && other.flags & ts.SymbolFlags.Alias)
        other = checker.getAliasedSymbol(other);
      return other === symbol;
    };
    const walk = (node: ts.Node): void => {
      if (!safe) return;
      if (++visited > 100000) {
        safe = false;
        return;
      }
      if (
        ts.isIdentifier(node) &&
        same(node) &&
        node !== declaration.name &&
        node !== expression
      ) {
        let target: ts.Node = node;
        while (
          (ts.isPropertyAccessExpression(target.parent) ||
            ts.isElementAccessExpression(target.parent)) &&
          target.parent.expression === target
        )
          target = target.parent;
        const rawReference = target === node;
        while (
          ts.isParenthesizedExpression(target.parent) ||
          ts.isAsExpression(target.parent) ||
          ts.isTypeAssertionExpression(target.parent) ||
          ts.isNonNullExpression(target.parent) ||
          ts.isSatisfiesExpression(target.parent)
        )
          target = target.parent;
        const parent = target.parent;
        if (
          (ts.isBinaryExpression(parent) &&
            parent.left === target &&
            parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
          ts.isDeleteExpression(parent) ||
          ((ts.isPrefixUnaryExpression(parent) ||
            ts.isPostfixUnaryExpression(parent)) &&
            [
              ts.SyntaxKind.PlusPlusToken,
              ts.SyntaxKind.MinusMinusToken,
            ].includes(parent.operator))
        )
          safe = false;
        // Unknown calls/aliases can mutate the same object. Object spreads copy it.
        if (
          rawReference &&
          ((ts.isCallExpression(parent) &&
            parent.arguments.some((argument) => argument === target)) ||
            (ts.isVariableDeclaration(parent) && parent.initializer === target))
        )
          safe = false;
      }
      ts.forEachChild(node, walk);
    };
    walk(declaration.getSourceFile());
    stableObjects.set(expression, safe);
    return safe;
  };
  const constant = (expression: ts.Expression): ts.Expression | undefined => {
    let symbol = ts.isShorthandPropertyAssignment(expression.parent)
      ? checker.getShorthandAssignmentValueSymbol(expression.parent)
      : checker.getSymbolAtLocation(expression);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
    return declaration &&
      ts.isIdentifier(declaration.name) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      declaration.parent.flags & ts.NodeFlags.Const
      ? declaration.initializer
      : undefined;
  };
  const object = (
    expression: ts.Expression | undefined,
    depth = 0,
    budget = { remaining: 512 },
  ): Map<string, ts.Expression> | undefined => {
    if (!expression || depth > 8 || --budget.remaining < 0) return;
    const node = unwrap(expression);
    if (ts.isIdentifier(node))
      return objectIsStable(node)
        ? object(constant(node), depth + 1, budget)
        : undefined;
    if (!ts.isObjectLiteralExpression(node) || node.properties.length > 64)
      return;
    const entries = new Map<string, ts.Expression>();
    for (const item of node.properties) {
      if (ts.isSpreadAssignment(item)) {
        const spread = object(item.expression, depth + 1, budget);
        if (!spread) return;
        for (const [key, value] of spread) entries.set(key, value);
      } else if (
        item.name &&
        (ts.isIdentifier(item.name) || ts.isStringLiteralLike(item.name))
      ) {
        if (ts.isPropertyAssignment(item))
          entries.set(item.name.text, item.initializer);
        else if (ts.isShorthandPropertyAssignment(item))
          entries.set(item.name.text, item.name);
        else return; // Accessors and object methods require separate modeling.
      } else return;
      if (entries.size > 256) return;
    }
    return entries;
  };
  const environment = (
    expression: ts.Expression,
    depth: number,
  ): string | undefined => {
    if (
      !ts.isPropertyAccessExpression(expression) &&
      !ts.isElementAccessExpression(expression)
    )
      return;
    const base = unwrap(expression.expression);
    if (
      !ts.isPropertyAccessExpression(base) ||
      base.name.text !== "env" ||
      !ts.isIdentifier(base.expression) ||
      base.expression.text !== "process"
    )
      return;
    if (
      checker
        .getSymbolAtLocation(base.expression)
        ?.declarations?.some((d) => !d.getSourceFile().isDeclarationFile)
    )
      return;
    const setting = ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : value(expression.argumentExpression, depth + 1).address;
    return setting && /^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/.test(setting)
      ? setting
      : undefined;
  };
  const value = (
    expression: ts.Expression | undefined,
    depth = 0,
  ): StaticValue => {
    if (!expression || depth > 8) return {};
    const node = unwrap(expression);
    if (ts.isStringLiteralLike(node))
      return { address: node.text.slice(0, 500) };
    const setting = environment(node, depth);
    if (setting) return { setting };
    if (ts.isIdentifier(node)) return value(constant(node), depth + 1);
    if (ts.isPropertyAccessExpression(node))
      return value(
        object(node.expression, depth + 1)?.get(node.name.text),
        depth + 1,
      );
    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(
        node.operatorToken.kind,
      )
    ) {
      const first = value(node.left, depth + 1),
        second = value(node.right, depth + 1);
      if (first.setting && second.address !== undefined && !second.setting)
        return { ...first, fallback: second.address };
      if (first.address !== undefined && !first.setting)
        return node.operatorToken.kind ===
          ts.SyntaxKind.QuestionQuestionToken || first.address
          ? first
          : second;
      return {};
    }
    if (
      ts.isTemplateExpression(node) &&
      node.head.text === "" &&
      node.templateSpans.length === 1
    ) {
      const span = node.templateSpans[0]!,
        base = value(span.expression, depth + 1),
        suffix = span.literal.text;
      if (base.setting)
        return { setting: base.setting, address: suffix.slice(0, 500) };
      if (base.address !== undefined)
        return { address: (base.address + suffix).slice(0, 500) };
    }
    return {};
  };
  return {
    value,
    object,
    constant,
    property: (expression: ts.Expression | undefined, key: string) =>
      object(expression)?.get(key),
  };
}
