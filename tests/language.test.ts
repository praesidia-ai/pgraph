import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGraph } from "@praesidia/pgraph-core";
it("supports JavaScript, arrow/default exports, aliases, generics, enums and property impact", () => {
  const root = mkdtempSync(join(tmpdir(), "pgraph-language-"));
  writeFileSync(
    join(root, "package.json"),
    '{"name":"language","type":"module"}',
  );
  writeFileSync(
    join(root, "lib.ts"),
    `export interface Item { value: number }\nexport enum State { Ready, Done }\nexport class Base { value = 0; write(value: number) { this.value = value; } }\nexport class Child extends Base {}\nexport const transform = <T>(value: T): T => value;\nexport default (value: number) => transform(value);\n`,
  );
  writeFileSync(
    join(root, "barrel.ts"),
    `export { default as apply, transform } from './lib.js';`,
  );
  writeFileSync(
    join(root, "consumer.js"),
    `import { apply } from './barrel.js';\nexport function run() { return apply(42); }`,
  );
  const graph = PGraph.open(root);
  try {
    graph.index();
    expect(graph.symbol("run").language).toBe("javascript");
    expect(graph.callees("run").map((n) => n.name)).toContain("default");
    expect(graph.callees("default").map((n) => n.name)).toContain("transform");
    expect(graph.symbol("transform").signature).toContain("<T>");
    expect(graph.symbol("State").kind).toBe("enum");
    expect(graph.dependencies("Child").map((n) => n.name)).toContain("Base");
    expect(
      graph
        .impact("Base.value")
        .likelyChangeSurface.map((n) => n.node.qualifiedName),
    ).toContain("Base.write");
    expect(graph.skeletonFile("lib.ts")).toContain("transform");
  } finally {
    graph.close();
    rmSync(root, { recursive: true, force: true });
  }
});
