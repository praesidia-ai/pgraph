# PGraph v2 delivery tracker

Updated 2026-09-10. **0.6.0 is the current v2 preview, not the completed v2 release.**
The preview adds working local intelligence and editor workflows. The final release
must demonstrate that developers can find, change and verify code more effectively.

The [smart engine design](SMART_ENGINE_DESIGN.md) describes the architecture;
the [delivery investigation](DEVELOPER_DELIVERY_INVESTIGATION.md) records the initial
evidence. This tracker is the acceptance checklist and records the current status.

The [follow-up power research](V2_POWER_RESEARCH.md) adds a reproducible analysis
of selection losses, missing implementation excerpts and interface-dispatch gaps.
It describes the 0.2.0 baseline; selected recommendations are now delivered below.

## Delivered in the 0.6.0 preview

**Workspace Impact for Current Symbol** links supported HTTP/Azure communication
operations to indexed handlers, local code and candidate tests in detected projects.
The existing VS Code agent `impact` tool adds explicit workspace routing with an
origin project ID. One output budget preserves whole paths, source identities,
project failures and omissions. Root-bound MCP retains its local schema.

The [workspace impact investigation](WORKSPACE_IMPACT.md) and
[paired worker probe](../benchmarks/reports/v060-workspace-impact.json) distinguish
configuration declarations from potential executable paths. On the authored
three-service fixture, the retained 0.5.5 worker has two service arrows and local
impact only. The new worker traces `submit → pay → archive → persist` and finds
one candidate test. Stale/unindexed projects remain explicit. These are static
fixture results, not evidence of runtime delivery, compatibility or task savings.

The release also corrects cursor focus when a synthetic configuration observation
shares a line with a function. Reindex existing projects for extraction version 5.
Representative task outcomes, payload compatibility, real-workspace performance
and the distribution matrix remain open.

Validation: 100 tests across 17 files passed, followed by 14 targeted tests for
the cursor correction. Typechecking, lint and the real isolated VS Code host
passed, including workspace impact through both agent and native commands,
receiving-project source reads, stale project isolation and existing workflows.

## Delivered in the 0.5.5 preview

Historical review now classifies changes before applying its page limit, so early
routine edits cannot crowd out a known removal. Responses show selected-file and
change-kind counts and return a continuation tied to the same Git/index/policy
inputs. Output packing adjusts the next offset to the rows actually delivered and
uses binary search to reduce repeated tokenization. **Continue Historical Review**
exposes the next page in VS Code, retaining the original project and comparison.

The [paired limit investigation](HISTORICAL_REVIEW_PAGING.md) reproduces a missing
removed API in the retained 0.5.4 worker. The new worker returns the removal first
and exposes all 122 compared declarations across 14 budgeted pages with no duplicates.
A separate compiler verifies the fixture's removed export and incompatible argument.
This is authored diagnostic evidence; complete-task outcomes, all-consumer recall,
type compatibility and large-workspace performance remain open.

The [0.5.5 MCP protocol probe](../benchmarks/reports/tool-profiles-v055.json) retains
21 full-profile and six essential-profile tools. Discovery costs 3,609 versus
1,467 tokens, with identical evidence for three shared queries. The continuation
field adds 29 discovery tokens to each profile versus 0.5.4; no new agent tool is
added. Profile savings and the single-run packing latency are not whole-task savings.

Validation passed on macOS arm64 / Node 22.22.0: 92 tests across 16 files,
typechecking, lint and formatting. Tests include real CLI processes continuing the
same review through read-only indexes, stale identity rejection and selected-file
counts. The real isolated VS Code host passes the new continuation command on a
150-declaration edit alongside existing workspace, Git, source, check and recovery
workflows. The packaged worker must match the paired report's recorded hash.

## Delivered in the 0.5.4 preview

**Review Historical Impact** compares a selected Git baseline with working, staged
or committed declarations. It restores before/after consumer and candidate-test
paths, including callers lost when an API is removed from current source. Staged
and committed snapshots can differ from working source. Inferred move/rename
pairings, declared signature changes, snapshot hashes, omitted paths and unknown
areas remain explicit. Project and Workspace reviews retain each repository's
history and failures. All analysis runs locally without models or repository scripts.

The [historical-impact investigation](HISTORICAL_IMPACT.md) and
[paired worker report](../benchmarks/reports/v054-historical-impact.json) compare the
retained 0.5.3 VSIX with 0.5.4 on three authored fixtures. A separate TypeScript
process verifies baseline success and edited-source failures TS2307 (deleted API)
and TS2345 (changed parameter), with a passing comment-only control. Historical
evidence recovers the old caller/test path and the declared parameter change.
Richer evidence costs more traffic tokens for the two broken cases: 357→639 and
699→720; the comment control costs 677→347. These are bounded tool/fixture
measurements, not completed agent tasks, runtime tests or billing savings.

Validation: 90 tests across 16 files, typechecking and lint passed, together with
the real isolated VS Code host's historical command and existing workspace/source/
Git/verification workflows on macOS arm64 / Node 22.22.0. The
[current MCP probe](../benchmarks/reports/tool-profiles-v054.json) measures 3,580
full-profile versus 1,438 essential-profile discovery tokens (59.8% smaller), with
identical results on three shared queries. Broader compatibility, workspace
performance, real task outcomes and distribution gates remain open.

## Delivered in the 0.5.3 preview

Task context now filters declaration kinds before retrieval limits, credits term
coverage, handles English inflections and avoids expanding unrelated consumers of
shared helpers. Declared interface bridges remain possible implementations; distant
test paths receive less weight. A library diagnostic hook identifies exact selection
losses without enlarging ordinary tool responses.

The [selection investigation](SELECTION_QUALITY.md) and
[frozen-graph comparison](../benchmarks/reports/v053-selection-quality.json) show
5/15 to 9/15 required targets selected and 3/10 to 6/10 complete-target searches on
the known self-repository diagnostic. Only 3/15 targets receive source or excerpts;
six still fail the shortlist. Five additional authored sample-app cases pass in
both versions. This does not close the broader retrieval, task-outcome or token
savings gates. Validation: 81 tests across 15 files, typechecking, lint and formatting
passed. The real isolated VS Code host also passed, including natural-language
implementation retrieval through the bundled worker, both workspace layouts,
project-specific follow-up reads, Git failure isolation and existing workflows.

## Delivered in the 0.5.2 preview

Local TypeScript project references now resolve declared package outputs to indexed
source. Package exports, re-exports, class methods and per-project path aliases
retain graph connections without relying on a completed build or stale generated
declarations. Separate installed packages take precedence; external references and
ambiguous outputs are not guessed. Each source file's graph is published by its own
compiler configuration. Older extraction is detected by freshness checks and agent
tools request reindexing before querying.

The [source-resolution investigation](PROJECT_SOURCE_RESOLUTION.md) records the
reproduction, TypeScript sources, boundaries and upgrade instructions. The
[paired worker probe](../benchmarks/reports/v052-project-references.json) compares
the retained 0.5.1 VSIX with the current worker on identical synthetic source. It
demonstrates restored callers/callees/static test paths, not a completed agent task
or token savings. Broad task retrieval and runtime/cross-service impact remain open.

Validation passed on macOS arm64 / Node 22.22.0: 76 tests across 14 files,
typechecking and lint, plus the real isolated VS Code host. The editor fixture
checks an agent following a call into an unbuilt local referenced package alongside
the existing workspace, source, Git, verification and timeout workflows. Cross-platform
release validation and representative company-task outcomes remain open.

The [0.5.2 self-repository diagnostic](../benchmarks/reports/v052-research-funnel.json)
selects 5/15 required natural-language targets across 3/10 complete tasks;
identifier-assisted requests select 15/15. All ten missing natural-language targets
were observed in retrieval traversal, before candidate filters and final packing.
The subsequent 0.5.3 investigation above identifies their precise rejection stages. The
[0.5.1 snapshot](../benchmarks/reports/v051-research-funnel.json) also selected 5/15,
with 2/10 complete tasks; source and engine changed, so this is not a controlled
ranking comparison. Broader retrieval remains open; the frozen comparison above
isolates the subsequent selection changes.

## Delivered in the 0.5.1 preview

The 0.5.1 follow-up adds editor and agent workspace task context: independent
project retrieval is packed under one total output budget, with root identities,
revisions, observation times and verified source hashes. Other agent tools accept
an explicit project ID for follow-up reads, and reject unknown/closed roots.
Partial failures remain visible; cursor anchors and receipts require one project.
This closes basic context aggregation, not cross-service causal traversal, atomic
workspace snapshots, broad natural-language recall or developer outcome gates.

Validation: the 70-test suite across 13 files passed, alongside typechecking,
lint and formatting. The real isolated VS Code host passed registered workspace
context and project-specific source reads, same-name symbols in separate roots,
stale-project isolation and invalid-project/cursor rejection, plus existing editor
workflows. This does not establish end-to-end agent task improvement or real-workspace
performance. The [MCP profile probe](../benchmarks/reports/tool-profiles-v051.json)
records current discovery costs; the root-bound MCP adapter omits editor-only
project routing instead of enlarging its schemas for an unavailable capability.

## Delivered in the 0.5.0 preview

Project and Workspace scopes now support ordinary open folders and a non-Git
parent containing direct child repositories. Workspace indexing, the service map
and daily reports use separate project roots. Reports preserve partial failures;
project pinning, check choices and saved investigations retain repository identity.
Non-Git folders and missing HEAD receive specific recovery messages. No initial
commit or parent Git repository is created automatically.

The [workspace guide](WORKSPACE_GRAPH.md) specifies discovery limits, grouped query
behavior and cursor/agent scope. The reported `frontier` layout was inspected
read-only: discovery found 31 child repositories and excluded the parent. No source
or index files in that workspace were changed during the investigation.

Validation: 67 tests across 12 files, typechecking and lint passed. The real
isolated VS Code host passed the container/multiple-project workflow, per-project
Git failure isolation, source bookmarks and persistent project pinning, alongside
the existing indexing, query, check execution and timeout tests.

## User-gap research follow-up

The [user-gap report](USER_GAP_RESEARCH.md) examines six direct public complaints,
current alternatives, ten prioritized gaps and the evidence required to close them.
The [first-use guide](FIRST_VALUE.md) and [pilot kit](USER_PILOT.md) support a
measurable activation and task-outcome pilot. No participants have been recruited
and no retention or commercial outcome is established.

The source-built MCP server now offers `--tool-profile essential` (six tools;
the full 21-tool profile remains the default) and preserves strict argument
validation through the MCP SDK. The
[protocol probe](../benchmarks/reports/tool-profiles.json) measures a 60.1% smaller
tools/list payload, with identical evidence for three shared queries. This closes
an optional discovery-cost control gap, not the whole-task savings gate. The
existing 0.4.0 VSIX's editor capabilities are unchanged by this MCP source update.
The updated source passes 63 tests across 11 files, typechecking, lint and formatting.
Real MCP stdio checks cover both profiles, identical shared evidence, unavailable
tool rejection and strict argument validation. The VS Code user tool-set example
has been checked against contributed tool names; live agent selection remains open.

## Delivered in the 0.4.0 preview

Eleven additions address repeated investigation and verification work: live index
health, literal source search, stack-frame mapping, file consumers, dependency
cycles, changed-declaration hunk mapping, staged/branch comparisons, static test-gap
candidates, package-check discovery, deliberate recorded check execution and saved
investigations. A daily launcher, shortcut, status-bar action and readable reports
make these available to developers. One additional `workflow` tool exposes the nine
read-only evidence actions to agents without exposing process execution.

The [workflow guide](DAILY_WORKFLOWS.md) specifies commands and limitations. The
[cited research report](DAILY_DEVELOPER_RESEARCH.md) identifies the user problem,
explains each capability and defines an adoption pilot. Local validation includes
61 unit/integration tests across 11 files and real isolated VS Code execution of
a fixture check, receipt readback, saved-task resumption and workflow tool invocation.

Hunk mapping narrows current declarations; it does not reconstruct removed symbols
or compare contracts. Check records attest an observed process exit and supported
input hashes; they do not establish individual test coverage, environment identity
or full CI completion. Broad natural-language retrieval, cross-root task context
and representative developer outcomes remain open v2 gates.

## Delivered in the 0.3.0 preview

- Bounded source excerpts selected by query text or cursor, with actual lines,
  hash checks and partial-source warnings; context can include them automatically.
- Budget reservations for a primary target and a related candidate test, plus
  more compact Markdown and opt-in bounded selection diagnostics.
- Declared implementation-member edges and candidate test paths, explicitly
  distinguishing possible interface dispatch from direct static paths.
- Context receipts in long-lived workers: unchanged entries can be reused when
  the caller retains them, with full fallback after eviction/restart and freshness
  checks before reuse. No model call is needed.
- Supported text lockfile invalidation and editor auto-index events.

See [the agent guide](AGENT_CONTEXT.md) for the receipt merge contract, changed
`tests` tool response, measured tradeoffs and exact limits. This implementation
passed **48 tests across 10 files**, typechecking, lint and the actual isolated
VS Code host workflow, including receipt/excerpt tools and lockfile auto-indexing.

The [controlled worker comparison](../benchmarks/reports/v3-agent-context.json)
measures 26.1% fewer request/response tokens for three repeated small-method context
calls, or 5.4% including all declared schemas once. The large-method response costs
more and supplies source detail that the baseline omitted. These are scripted
protocol checks, not complete agent tasks or a billing claim.

The [historical 0.3.0 self-repository diagnostic](../benchmarks/reports/v3-research-funnel.json)
retrieves 6/15 natural-language targets (3/10 complete tasks), including two full
source representations; identifier-assisted recall is 15/15. The historical 0.2.0
counts were 7/15, 4/10 and zero full-source representations. The corpus also changed,
so these are not paired ranking measurements. Natural-language retrieval remains
unproven; source usefulness and receipt savings do not close that gate.

The [0.3.0 10,000-file synthetic run](../benchmarks/reports/v3-scale-10000.json)
measured 34.06 s initial indexing, 5.08 s unchanged indexing, 5.71 s after one leaf
edit and 1.39 s for one context query. Caller-query p95 was 0.19 ms; point-in-time
RSS was 363 MB. These single-run measurements vary and do not establish performance
improvement over 0.2.0, queue-inclusive latency or peak memory.

## Delivered in the 0.2.0 preview

- Local mode is the default for context/feature queries and excludes cached AI
  concepts and constraints. Assisted mode can include existing inferred facts;
  neither query mode makes model calls. The VS Code machine setting takes precedence
  over agent arguments. Regression tests cover switching modes and context caching.
- Search uses separate identity, signature, documentation and effect fields with
  weighted FTS ranking and English stemming. Extraction indexes bounded JSDoc,
  identifiers, short literals and exceptions; no source is sent to a model.
- Context includes stable symbol IDs and selection reasons, accepts a source/cursor
  anchor, and considers short implementation bodies at ordinary token budgets.
  The focused symbol is retained even under a small budget, or the query requests
  a larger budget. Traversal is bounded and reports limits. Final serialized output
  remains budgeted.
- **PGraph: Context for Current Symbol** is available from the command palette,
  sidebar and source editor context menu. It validates the indexed source before
  resolving the cursor. Unsaved or stale source must be saved/reindexed.
- **PGraph: Review My Changes** refreshes the selected repository and reports
  conservative current-file impact, candidate tests, suggested checks and unknown
  areas. CLI/MCP expose the corresponding read-only `review_changes` tool.
- Schema 3 migration rebuilds the search index. Reindexing refreshes extracted
  evidence. Read-only clients request an indexing/migration step rather than silently
  running a migration.
- Outgoing traversal uses a source/type index. Weighted search uses FTS native rank
  ordering to avoid unnecessarily sorting all matches before applying the limit.

Change review compares the current working tree (including staged changes) with
HEAD and includes untracked non-ignored files. It does **not** determine exactly
which declarations changed: it examines declarations in changed files. Deleted and
renamed symbols require a baseline graph; unsupported files are unknown. Candidate
tests are suggestions and have not been executed by this command. There is no
cross-service impact in this first review implementation.

## Final v2 acceptance gates

| Gate                                                   | Current status                                                           | Evidence required to close it                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Local intelligence works independently of AI           | Preview implemented                                                      | Retain isolation, freshness, budgets and query correctness across supported platforms                                |
| Task retrieval works without implementation-name hints | Improved; open                                                           | Held-out, independently reviewed task evidence on multiple real repositories; investigate missing/irrelevant context |
| Actual changes have explained impact                   | Historical declaration/consumer evidence implemented; compatibility open | Type-compatibility checks, broader removals/renames, explicit unknowns and representative task validation            |
| Context and impact cross service boundaries            | Bounded static handler paths implemented; real-task validation open      | Representative cross-service tasks, payload compatibility and evidence beyond configured synthetic mappings          |
| Verification is connected to the change                | Static candidates and scoped process receipts implemented                | Compare with required wider checks; validate runtime-input scope and avoid confusing candidates with coverage        |
| Performance is suitable for the target workspace       | Synthetic measurements only                                              | Queue-inclusive query latency, save-to-ready time and peak memory on the intended Azure Functions/services workspace |
| Agent assistance improves delivery                     | Tools exist; task outcomes unproven                                      | Paired complete tasks with the same host agent/model, acceptance tests and all follow-up reads counted               |
| Release artifact is ready for distribution             | Local preview packaging                                                  | OS/Node matrix, extension smoke tests, upgrade/migration checks and distribution/release identity requirements       |

Do not mark final v2 complete from a graph screenshot, an artifact version, a passing
unit suite, or token reduction alone. The product outcome is time to a correct,
verified change, with completion and missed-impact/rework rates reported alongside it.
The existing production KPI gates in [ROADMAP.md](../ROADMAP.md) still apply.

## Next implementation slices

Selection diagnostics, partial source excerpts and declared member relationships
are implemented, with a synthetic interface-injection acceptance fixture. Precise
receiver flow and complete control/data-flow slices remain open. These foundations
strengthen the following slices without closing their gates.

1. **Precise change analysis.** Historical declaration/consumer snapshots are
   implemented. Validate supported type-compatibility rules and harder import,
   overload and configuration changes on independently chosen tasks. Preserve
   explicit unknowns where historical evidence is incomplete.
2. **Workspace task queries.** Static operation/handler paths are implemented.
   Validate recognizer coverage on actual Azure patterns, measure omitted paths,
   and add payload/schema links for a small set of explicit compatibility rules.
3. **Verification workflow.** Integrate one test runner and typecheck/build tasks;
   show which checks ran for which source revision. Candidate selection must not
   silently replace required CI checks.
4. **Stronger behavior analysis.** Add bounded local value-flow and guard/effect
   summaries, then compose supported call paths. Dynamic/unmodeled boundaries stay
   unknown. Evaluate each recognizer on positive and negative fixtures.
5. **Smarter agent use.** Provide missing-evidence/expansion operations and task
   state so the existing agent can investigate hypotheses, plan, inspect the actual
   patch and react to verification results. Add internal AI only if it improves
   outcomes beyond the same agent using the deterministic engine.

These are dependency-ordered deliverables, not calendar promises. Collect real task
examples and acceptance criteria before expanding generic ranking or framework rules.

## Validation and reproducible evidence

The historical 0.2.0 implementation passed typechecking, linting, **41 tests across 9 files**
and a real isolated VS Code extension-host run. The added cases cover
documentation/inflection/error retrieval, default-budget source bodies, semantic
cache exclusion, ambiguous cursor anchors, stale source, staged/untracked/deleted
files and nested Git roots. The actual editor workflow exercises cursor context,
the local-mode override and change-review commands.

The [original retrieval probe](../benchmarks/reports/natural-language-probe.json)
and [preview retrieval probe](../benchmarks/reports/v2-natural-language-probe.json)
record prompts, expected/selected symbols, runtime and source fingerprints. They are
development diagnostics: the engine and this self-repository corpus changed, the
queries were inspected during development, and their inherited expected-symbol
oracles are not independently validated. They are not held-out task-success trials.

That 0.2.0 probe retrieved **7/15 required symbols across natural-language tasks,
with 4/10 tasks meeting full recall**; the earlier baseline was 6/15 and 3/10.
Identifier-assisted tasks still retrieve 15/15 across 10/10 tasks. The limited
natural-language result is a reason to keep this gate open, not evidence that the
engine understands arbitrary development requests. Cursor anchors provide a
separate, directly tested way to specify the target without guessing its name.

The [1,000-file report](../benchmarks/reports/v2-scale-1000.json) and
[10,000-file report](../benchmarks/reports/v2-scale-10000.json) measure synthetic
scale only. On macOS arm64 / Node 22.22.0, the final 10,000-file run measured
31.08 s initial indexing, 1.98 s unchanged indexing, 4.46 s after one leaf edit,
and 965 ms for one context query. Caller-query p95 was 0.20 ms across 100 queries.
These are different operations: the caller result is not context-query p95.

An [earlier development run](../benchmarks/reports/v2-scale-10000-before-query-fix.json)
took 17.43 s for context. Profiling reproduced lower but variable times and exposed
an edge-type scan; the source/type index and native FTS ranking address that work.
These runs do not establish a stable speedup ratio. Queue-inclusive latency, varied
queries and peak memory still need representative-workspace measurement; reported
RSS is only a point-in-time reading.

```sh
npm run build
npm run check
npm run format:check
npm run test:extension
node benchmarks/probes/natural-language.mjs /tmp/pgraph-v2-probe.json
npm run benchmark:scale -- 1000
npm run package:extension
```

The local installable artifact is `artifacts/pgraph-0.6.0.vsix`, marked pre-release.
Install it using **Extensions: Install from VSIX**, then run **PGraph: Index
Repository** before querying an older index. Publishing and installation in the
developer's normal profile are separate actions from building the preview.
