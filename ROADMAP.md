# Roadmap and release gates

## Implemented 0.1 foundation

Local Graph IR/SQLite, TypeScript compiler extraction, cross-file queries,
incremental updates, source ranges/skeletons, bounded impact, BPE context optimization,
CLI, stdio MCP, actual VS Code extension-host workflow, registered Copilot tools,
opt-in per-symbol semantic enrichment, benchmark tooling, security tests and docs.

## Gates before calling this a production MVP

1. Run paired real coding tasks through permitted agents on representative medium
   and large repositories. Require at least 50% repository-context token reduction,
   at least 40% fewer exploratory reads/calls and correctness at least baseline.
   Current retrieval benchmarks measure recall, not that correctness claim.
2. Validate a live Copilot semantic request under the target company's account and
   policy. Automated host tests exercise tool invocation; they do not simulate a
   successful paid-model authorization or request.
3. Exercise Windows/Linux/macOS release artifacts and real tens-of-thousands-file
   monorepos. Local validation includes macOS and 1,000- and 10,000-file synthetic stress runs. The latter takes about 1.9 seconds for context generation and 7 seconds for a leaf update in the latest recorded run, above the interactive targets.
4. Expand framework fixtures for dynamic registration, project references,
   parameterized tests, runtime DI, database schemas and migration impact.
5. Establish maintainer identity, repository/security contact, distribution namespace
   and signed release process; review the threat model and residual limits.

## Next engineering work

- Prioritize natural-language task retrieval without identifier hints and calibrate
  semantic/confidence signals against real task oracles.
- Add persistent affected-AST/symbol extraction caching across process restarts;
  partition large compiler projects and improve dependency closure bounds.
- Add stronger cache provenance,
  platform-specific descriptor-relative filesystem traversal and clean coordination.
- Add a graph/table browser in the editor, per-task saved metrics, cancellable
  semantic batches with explicit evidence previews, and precise readiness status.
- Add SCIP ingestion, then language adapters based on demonstrated demand.

Future options: CI-generated sanitized artifacts, shared team indexes, alternate
stores, LSP/JetBrains consumers, embedding-assisted ranking, PR impact analysis.
The provider-independent library and graph-store/parser contracts remain the
extension boundaries. No central source database is part of this release.
