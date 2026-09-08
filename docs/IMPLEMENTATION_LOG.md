# Implementation checkpoints

The workspace began empty. The implementation reused no existing project and
initialized an npm-workspaces monorepo, strict TypeScript project references and
an independent engine API before building editor UI.

1. **Architecture, IR and SQLite:** selected compiler-backed TS identity and bundled
   SQLite; implemented provenance, migrations, indexed adjacency and atomic writes.
   Compiled the storage/indexing dependency graph and corrected API typing issues.
2. **Compiler and incremental indexing:** implemented discovery, hashing, symbol and
   relation extraction, dependency closure and stale-source checks. End-to-end tests
   found and fixed calls assigned to local variables being attributed to the variable
   instead of its enclosing callable. The first seven engine tests passed.
3. **Queries and context:** implemented source ranges, skeletons, impact, ranking,
   multiple-choice representation optimization and complete-output BPE checks.
   Small-fixture benchmarks exposed excess related signatures; selection was tightened
   while retaining required targets and reporting negative savings honestly.
4. **CLI and MCP:** ran actual CLI child processes and an SDK stdio handshake/query.
   Shared strict schemas and bounded dispatch now serve both adapters.
5. **VS Code/Copilot:** built the worker, sidebar, commands, registered tools and
   explicitly enabled semantic command. A real VS Code 1.122.1 extension host passed
   activation, indexing, tool invocation, context display, savings and no-change update.
   Live model transmission requires the user's provider authorization and was not faked.
6. **Frameworks and hardening:** added Next/Nest/monorepo fixtures, exports/JS/default
   arrows, property impact, semantic invalidation and malicious-input checks. Corrected
   framework precedence and introduced read-only query connections, live semantic
   hashes, no-follow source reads and uncapped file-dependency invalidation.
7. **Scale:** measured 1,000 and 10,000 generated files. The larger run exposed an
   unindexed FTS update and name-collation mismatch. Added schema migration 2 and
   regression checks; reran scale measurements. Large-context latency remains above
   the desired interactive target and is recorded, not hidden.
8. **Distribution and verification:** added documentation, threat model, MIT/third-party
   notices, CI/dependency/release workflows, npm archives and a local installable VSIX.
   Compilation, lint, source coverage, actual CLI/MCP and real extension-host workflows
   are separate checks. A clean offline installation of all 16 npm archives passed
   version, indexing, caller lookup and budgeted context checks outside the workspace.
   Final measured reports live in benchmarks/reports.
9. **Praesidia branding:** renamed the product to PGraph, including the library API,
   npm scope, CLI, MCP identity, Copilot tools, editor commands/settings and index
   paths. Added the generated connected-p logo and a monochrome editor adaptation.
   All 27 tests, the real renamed extension-host workflow and a clean offline
   installation of all 16 renamed package archives passed. Retrieval benchmark
   reports are regenerated after naming changes to match the current API.

10. **V2 workspace foundation:** fixed missing-Node recovery and separated indexing
    and query execution limits. Requests queue without using their execution timeout;
    queued cancellation leaves the active index running. Added per-configuration
    progress for mixed root/nested TypeScript projects and Index Workspace for all
    open local roots, with sequential indexing, per-root results, duplicate-run
    sharing and idle compiler-worker release. All 27 tests and an actual two-root
    VS Code extension-host workflow passed, including timeout/cancellation/restart
    checks. The researched workspace relationship layer and interactive explorer
    remain planned in docs/V2_PLAN.md; cross-service links are not inferred yet.

11. **V2 relationship explorer:** shipped the first local interactive service map
    and bounded symbol neighborhood browser. Persisted HTTP/Azure declarations from
    ES modules, CommonJS and v3 bindings, with explicit service/resource mappings,
    source hashes, root namespacing and ambiguous/unresolved edges. Verified compiler,
    matching and incremental regressions, actual VS Code webview/worker navigation,
    and browser rendering/interactions including hostile labels. Cross-root context
    packing, runtime delivery proof and complete framework coverage remain open.

The production acceptance gates in ROADMAP.md remain visible. A functional local
pre-release does not establish every framework pattern, representative task
correctness, platform behavior or enterprise provider policy.
