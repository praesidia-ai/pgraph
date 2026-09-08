# Recorded benchmark results

Repository-context retrieval was measured from the current PGraph implementation on 2026-09-08 with Node 24.16.0 on macOS arm64. The synthetic scale section retains earlier implementation measurements. These are retrieval/scale measurements, not paired coding-agent correctness trials. Re-run with the commands in docs/benchmarks.md; exact source fingerprints are in each retrieval JSON report.

## Repository-context retrieval

| Suite             | Tasks | Baseline tokens | Supplied tokens | Weighted reduction | Required-symbol recall |
| ----------------- | ----: | --------------: | --------------: | -----------------: | ---------------------- |
| [auth](auth.json) |     3 |           2,320 |           1,203 |             48.15% | All required symbols   |
| [self](self.json) |    10 |         116,334 |           6,035 |             94.81% | All required symbols   |

The self suite supplies identifier hints and uses declared file-open traces. The tiny authentication suite shows why savings must be measured: metadata overhead makes results depend on task and file size. Correctness and completion fields remain null.

| Task                | Baseline tokens | Graph tokens | Reduction | Recall |
| ------------------- | --------------: | -----------: | --------: | -----: |
| auth/auth-lockout   |           1,184 |          533 |    54.98% |   100% |
| auth/token-location |             488 |          217 |    55.53% |   100% |
| auth/login-bug      |             648 |          453 |    30.09% |   100% |
| self/locate         |           6,662 |          781 |    88.28% |   100% |
| self/flow           |          13,148 |          665 |    94.94% |   100% |
| self/architecture   |          18,461 |          408 |    97.79% |   100% |
| self/impact         |          13,547 |          807 |    94.04% |   100% |
| self/debug          |          10,854 |          519 |    95.22% |   100% |
| self/single         |           6,662 |          404 |    93.94% |   100% |
| self/multi          |           9,346 |          338 |    96.38% |   100% |
| self/monorepo       |          13,148 |          726 |    94.48% |   100% |
| self/tests          |          10,854 |          697 |    93.58% |   100% |
| self/refactor       |          13,652 |          690 |    94.95% |   100% |

## Synthetic scale

| Metric             | 1,000 files (early schema-1 run) | 10,000 files (schema-2 run) |
| ------------------ | -------------------------------: | --------------------------: |
| Nodes              |                            8,002 |                      80,002 |
| Edges              |                           30,997 |                     309,997 |
| Initial index      |                          9.405 s |                    45.595 s |
| Unchanged scan     |            0.127 s / 0 extracted |       2.096 s / 0 extracted |
| Leaf update        |            0.674 s / 1 extracted |       7.050 s / 1 extracted |
| Caller query p50   |                         1.716 ms |                    0.074 ms |
| Caller query p95   |                         5.381 ms |                    0.411 ms |
| Context generation |                           430 ms |                     1929 ms |
| Context tokens     |                              677 |                         687 |

Raw reports: [1,000 files](scale.json), [10,000 files](scale-10000.json). Runs occurred under development load and are not directly controlled performance comparisons. The larger dataset contains 10,001 indexed files including its package manifest. RSS is a point-in-time process measurement, not peak memory.

The 10,000-file context and leaf-update times exceed the desired interactive targets. Initial indexing and adjacency queries are functional at this scale; the results do not establish performance on representative large monorepos.

## Validation scope

Typecheck, lint, formatting and 27 unit/integration tests passed. Tests launch real CLI processes and an MCP stdio client. A separate real VS Code 1.122.1 extension-host workflow passed indexing, tool invocation, context display, metrics and incremental update. Source coverage from the 26-test run before the final case-sensitivity regression check was 91.33% lines / 86.29% branches; the HTML report can be regenerated with npm run test:coverage.

Live Copilot semantic transmission, enterprise policy, Windows/Linux local execution and paired task correctness were not verified in this environment. CI workflows cover the supported OS/Node matrix when run on the eventual repository host.
