# Analysis coverage and limitations

The TypeScript compiler owns symbol identity; framework recognizers are pluggable
and emit heuristic provenance. This is a static repository index, not a runtime tracer.

| Area                 | Implemented                                                                                                                      | Practical limits                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Languages            | TS, TSX, JS, JSX, MTS/CTS/MJS/CJS                                                                                                | No Python/Java/Go/etc. adapter yet                                                                                     |
| Declarations         | Classes, interfaces, types, enums, functions/arrows, methods, constructors, properties, variables, namespaces                    | Destructured binding expansion and some anonymous/object patterns are incomplete                                       |
| Resolution           | Compiler import/re-export aliases, default/named callable exports, calls, new expressions, heritage, typed references            | Dynamic imports/dispatch/reflection may remain unresolved; external library symbols are not persisted                  |
| Monorepos            | Nearest tsconfig/jsconfig, inherited options, paths, package membership/dependencies                                             | Package graph lookup is bounded to 500 packages; project-reference build outputs may be needed for some configurations |
| Next.js              | App route HTTP exports, default pages/layouts; Pages Router defaults; server-action directive hints                              | Runtime rewrites, middleware composition and computed routes incomplete                                                |
| React                | Capitalized JSX functions, use-prefixed hooks, context factories                                                                 | Heuristics do not prove React component identity                                                                       |
| Nest                 | Controller/Injectable/Module, HTTP decorators, EventPattern/MessagePattern/OnEvent, Processor/Process and guard/interceptor tags | DI resolution, custom decorators, middleware ordering and full routing prefixes incomplete                             |
| Express/Fastify      | Literal HTTP-method route calls, referenced and inline handlers                                                                  | Custom routers/builders, chained registration and options-object routes incomplete                                     |
| Tests                | test/it calls with literal names, call/reference relationships; direct test discovery                                            | Parameterized tests, fixture indirection and Playwright test extensions are partial                                    |
| Database             | Prisma/db model operations, Entity/Table/Schema decorator hints, Drizzle table factories                                         | Schema/migration languages, query builders and Sequelize-specific behavior are partial                                 |
| Events/queues/config | Literal emit/publish/on/subscribe/add patterns, queue naming, process.env keys                                                   | Dynamic topic names and broker topology unknown                                                                        |
| Git                  | Optional bounded frequency/co-change/last-commit metadata; frequency ranking                                                     | No author storage; symbol-level co-change attribution is deferred                                                      |
| Semantic             | Explicit per-symbol Copilot command, validated concepts/constraints, separate hash-invalidated facts                             | No automatic whole-repo model batch; no proof of inferred factual accuracy                                             |
| Skeletons            | Signatures, modifiers, type declarations, class heritage and members                                                             | Not guaranteed compilable source; some declarations preserve source text/literals                                      |
| Impact               | Bounded incoming-use closure and direct outgoing effects                                                                         | Potential change surface, not proof that every listed symbol breaks                                                    |

Source and config changes are checked by SHA-256. Changed-file extraction uses the
old reverse dependency closure. An unaffected file's stored nodes remain intact.
Cold compiler programs still load/parse dependencies for resolution; `parsed` reports
files re-extracted/persisted, not every AST loaded internally. New files and config
changes intentionally broaden extraction. All changed graph facts commit together.

The source cache, SQLite index, stored signatures and semantic memory are persistent
or reused where appropriate. Context responses use a bounded in-memory revision
cache; context-result caching is not persisted across CLI processes. A 50 MB cap
limits compiler support reads per program, while discovery has configured totals.

No representative ten-thousand-file real-repository or paid-model correctness trial
has been completed here. Synthetic scale results and local self-repository retrieval
results are explicitly labelled and do not substitute for those acceptance gates.
