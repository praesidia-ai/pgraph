import { defineConfig } from "vitest/config";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      readdirSync("packages").map((name) => [
        JSON.parse(readFileSync(resolve("packages", name, "package.json"), "utf8")).name,
        resolve("packages", name, "src/index.ts"),
      ]),
    ),
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/main.ts"],
      reporter: ["text", "json-summary", "html"],
    },
  },
});
