import { bpeCounter, type WorkspaceImpactResult } from "@praesidia/pgraph-core";

/** Keep complete paths and their identities under one serialized response budget. */
export function packWorkspaceImpact(
  input: WorkspaceImpactResult,
  maxTokens: number,
): string {
  if (!Number.isInteger(maxTokens) || maxTokens < 128 || maxTokens > 32000)
    throw new Error(
      "Workspace impact budget must be between 128 and 32000 tokens",
    );
  const result = {
    ...input,
    paths: [] as WorkspaceImpactResult["paths"],
    tests: [] as WorkspaceImpactResult["tests"],
    tokenBudget: maxTokens,
    tokenizer: bpeCounter.name,
    omitted: { paths: input.paths.length, tests: input.tests.length },
  };
  const render = () => {
    const used = new Set([
      input.origin,
      ...result.paths.flatMap((path) =>
        path.steps.flatMap((step) => [step.from, step.to]),
      ),
      ...result.tests.flatMap((test) => [
        test.target,
        test.test,
        ...test.steps.flatMap((step) => [step.from, step.to]),
      ]),
    ]);
    return JSON.stringify({
      ...result,
      truncated:
        input.truncated || result.omitted.paths > 0 || result.omitted.tests > 0,
      symbols: input.symbols.filter((symbol) => used.has(symbol.key)),
    });
  };
  const minimum = bpeCounter.count(render());
  if (minimum > maxTokens)
    return JSON.stringify({
      error: `Workspace impact metadata needs ${minimum} tokens. Increase maxTokens or open fewer projects.`,
      truncated: true,
    });
  for (const path of input.paths) {
    result.paths.push(path);
    result.omitted.paths--;
    if (bpeCounter.count(render()) > maxTokens) {
      result.paths.pop();
      result.omitted.paths++;
    }
  }
  for (const test of input.tests) {
    result.tests.push(test);
    result.omitted.tests--;
    if (bpeCounter.count(render()) > maxTokens) {
      result.tests.pop();
      result.omitted.tests++;
    }
  }
  return render();
}
