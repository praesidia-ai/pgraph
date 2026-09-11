# Roadmap and release gates

The active v2 direction and research are in [V2_PLAN.md](docs/V2_PLAN.md).
The [v2 delivery tracker](docs/V2_DELIVERY.md) distinguishes the installable 0.6.0
preview from the final release. The preview adds local/assisted evidence selection,
weighted text retrieval, source/cursor anchors, default-budget implementations and
conservative change review with candidate tests. It now also supplies partial source
excerpts, explained test paths, context receipts and selection diagnostics; see
[the agent guide](docs/AGENT_CONTEXT.md). Full contract compatibility, cross-service
causal traversal, complete runtime verification and real-task acceptance remain open.

The 0.4.0 [daily workflows](docs/DAILY_WORKFLOWS.md) add textual hunk mapping and
recorded package-check execution. Full historical/contract impact, individual-test
coverage and representative developer adoption remain open. The [research report](docs/DAILY_DEVELOPER_RESEARCH.md)
defines the recurring user problem and the pilot acceptance plan.

The 0.5.0 [workspace workflow](docs/WORKSPACE_GRAPH.md) adds explicit Project and
Workspace scopes and discovers direct child repositories in a non-Git container.
Daily reports and indexing operate per project and retain partial failures. This
does not close the separate cross-root semantic context/impact gate.

The 0.5.1 follow-up adds grouped workspace task context under one total token
budget and explicit project IDs for agent follow-ups. Source hashes, revisions,
errors and packing omissions remain visible; retrieval still needs real-task
validation and does not establish cross-service impact.

The 0.5.2 [source-resolution fix](docs/PROJECT_SOURCE_RESOLUTION.md) restores local
package graph connections through explicit TypeScript project references. A paired
old/new worker fixture demonstrates the restored callers and candidate test paths.
Natural-language selection still needs stronger task-level evidence.

The 0.5.4 [historical review](docs/HISTORICAL_IMPACT.md) compares Git snapshots and
recovers old consumers of deleted APIs, with declared signature changes and inferred
move/rename candidates. An independent compiler check verifies two broken fixture
changes. Real-task compatibility, cross-service impact and large-workspace latency
still require validation.

The 0.5.5 [historical paging fix](docs/HISTORICAL_REVIEW_PAGING.md) prevents known
removals from being lost behind the change limit and makes budget-omitted rows
reachable. Continuation is tied to the same input snapshot. This does not close
the broader compatibility or real-workspace performance gate.

The 0.6.0 [workspace impact workflow](docs/WORKSPACE_IMPACT.md) connects explicit
HTTP/Azure operations to indexed handlers and candidate tests across detected
projects. Complete paths, ambiguity, source identities and failures share a bounded
response. Runtime delivery, payload compatibility and real-task validation remain open.

The [user-gap investigation](docs/USER_GAP_RESEARCH.md) adds six first-person public
reports, current alternatives and ten gaps with closure criteria. Prioritize
unassisted first use, relevant current evidence, complete-task context cost and
voluntary reuse. The [pilot kit](docs/USER_PILOT.md) is ready; user results are not
yet collected. A six-tool optional MCP profile reduces discovery overhead, but its
measured schema savings do not establish whole-task savings or product adoption.

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
   monorepos. Local validation includes macOS and 1,000- and 10,000-file synthetic
   stress runs. The [0.3.0 measurements](docs/V2_DELIVERY.md) record
   1.39 seconds for one 10,000-file context query and 5.71 seconds for a leaf update.
   Queue-inclusive real-workspace latency remains unverified.
4. Expand framework fixtures for dynamic registration, project references,
   parameterized tests, runtime DI, database schemas and migration impact.
5. Establish maintainer identity, repository/security contact, distribution namespace
   and signed release process; review the threat model and residual limits.

## Next engineering work

Use the [ranked user gaps](docs/USER_GAP_RESEARCH.md#ten-gaps-with-closure-criteria)
to select and verify the next change. Activation failures and missing required
evidence take precedence over expanding the feature list. A future optional AI
layer must beat the same existing agent using the deterministic engine on accepted
tasks, including its extra latency, context and cost.

- Prioritize natural-language task retrieval without identifier hints and calibrate
  semantic/confidence signals against real task oracles.
- Add persistent affected-AST/symbol extraction caching across process restarts;
  partition large compiler projects and improve dependency closure bounds.
- Add stronger cache provenance,
  platform-specific descriptor-relative filesystem traversal and clean coordination.
- Extend the delivered service/symbol explorer with cross-root context packing,
  impact ranking, additional communication recognizers and measured layout tuning.
- Add per-task saved metrics, cancellable semantic batches with explicit evidence
  previews, and precise readiness status.
- Add SCIP ingestion, then language adapters based on demonstrated demand.

Future options: CI-generated sanitized artifacts, shared team indexes, alternate
stores, LSP/JetBrains consumers, embedding-assisted ranking, PR impact analysis.
The provider-independent library and graph-store/parser contracts remain the
extension boundaries. No central source database is part of this release.
