import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  runBenchmark,
  validateScenarios,
} from "../packages/graph-benchmark/dist/index.js";
await mkdir("benchmarks/reports", { recursive: true });
for (const [suite, root] of [
  ["auth", "examples/sample-typescript-app"],
  ["self", "."],
]) {
  const scenarios = validateScenarios(
    JSON.parse(await readFile(`benchmarks/${suite}.json`, "utf8")),
  );
  const report = runBenchmark(resolve(root), scenarios);
  await writeFile(
    `benchmarks/reports/${suite}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `${suite}: ${report.summary.weightedTokenReductionPercent}% reduction, all required symbols: ${report.summary.allRequiredSymbolsRetrieved}`,
  );
}
for (const name of ["scale", "scale-10000"]) {
  try {
    await copyFile(
      `benchmarks/results/${name}.json`,
      `benchmarks/reports/${name}.json`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
