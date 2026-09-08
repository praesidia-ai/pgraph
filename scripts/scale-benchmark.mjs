import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGraph } from "../packages/graph-core/dist/index.js";
const files = Number(process.argv[2] ?? 1000);
if (!Number.isSafeInteger(files) || files < 10 || files > 20000)
  throw new Error("Choose 10–20000 synthetic source files");
const root = await mkdtemp(join(tmpdir(), "pgraph-scale-"));
try {
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "synthetic-scale", type: "module" }),
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
      },
    }),
  );
  for (let i = 0; i < files; i++)
    await writeFile(
      join(root, "src", `module${i}.ts`),
      `${i ? `import { normalize${i - 1} } from './module${i - 1}.js';` : ""}
export interface Record${i} { id: string; amount: number; active: boolean }
export function normalize${i}(input: Record${i}): Record${i} {
  if (!input.id.trim()) throw new Error('Missing record identifier');
  if (!Number.isFinite(input.amount)) throw new Error('Invalid amount');
  const record = { ...input, amount: Math.round(input.amount * 100) / 100 };
  return ${i ? `normalize${i - 1}(record)` : "record"};
}
export function summarize${i}(records: Record${i}[]): number {
  return records.filter(record => record.active).reduce((total, record) => total + normalize${i}(record).amount, 0);
}
`,
    );
  const graph = PGraph.open(root);
  try {
    const initial = graph.index();
    const unchanged = graph.index();
    const target = join(root, "src", `module${files - 1}.ts`);
    const { readFile } = await import("node:fs/promises");
    await writeFile(
      target,
      (await readFile(target, "utf8")).replace("Math.round", "Math.floor"),
    );
    const incremental = graph.index();
    const times = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      graph.callers(`normalize${files - 1}`);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const context = graph.context({
      task: `Change normalize${files - 1} amount validation`,
      maxTokens: 1500,
    });
    console.log(
      JSON.stringify(
        {
          kind: "synthetic-scale-not-correctness-evaluation",
          sourceFiles: files,
          initial,
          unchanged,
          incremental,
          queryP50Ms: times[50],
          queryP95Ms: times[95],
          contextMs: context.metrics.latencyMs,
          contextTokens: context.metrics.contextTokens,
          rssBytes: process.memoryUsage().rss,
        },
        null,
        2,
      ),
    );
  } finally {
    graph.close();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
