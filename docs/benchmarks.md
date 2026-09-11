# Benchmark methodology

PGraph measures **repository-context tokens**, not hidden model reasoning,
prompt-cache billing, provider output tokens or Copilot's internal tool usage.
The counter is the locally bundled `cl100k_base` BPE tokenizer. Results for a
different model tokenizer are estimates unless the host supplies its counter.

## Reproduce

```sh
npm ci --ignore-scripts
npm run build
node scripts/record-benchmarks.mjs
npm run benchmark:scale -- 1000
npm run benchmark:scale -- 10000
```

`benchmarks/auth.json` contains three small authentication tasks.
`benchmarks/self.json` contains ten categories against this actual monorepo: locate,
feature flow, architecture, impact, debugging, single-file change, multi-file change,
monorepo resolution, test discovery and refactoring. These are **identifier-assisted
retrieval scenarios**. They are not representative blind coding-agent trials.

Each scenario declares a file-open baseline, exploratory search-call count, token
budget and required-symbol oracle. The harness reads those exact baseline files,
counts their source lines and BPE tokens, then calls `graph.context`. It records
selected symbols, supplied implementation lines, files supplying source snippets,
tool calls, latency, missing required symbols and a repository-content fingerprint.

The baseline is a declared exploration trace, not a recorded autonomous agent run.
The graph side reports one retrieval tool call and **only this retrieval stage**.
Subsequent implementation reads, edits, tests and agent turns must be added in a
paired trial; zero source-file opens in a signature-only result does not mean zero
reads for the completed coding task. Internally PGraph reads files for hashing
and token estimation; those are not agent-exposed source reads.

Required-symbol recall checks retrieval coverage. `taskCorrectness` and
`taskCompletion` are deliberately `null`. Even 100% recall does not prove that the
context is sufficient to safely implement a change. Some small-file tasks can
cost more with graph metadata than with direct reads; the harness reports negative
reductions instead of suppressing them.

## Recorded results

The 0.3.0 [controlled agent-context probe](../benchmarks/probes/agent-context.mjs)
compares the retained 0.2.0 VSIX with the current built worker on identical generated
files. It counts request and response traffic and separately adds all declared tool
schemas once. Three repeated calls deliberately exercise receipts; this is not an
autonomous task trial. Results include source-marker checks so a cheaper answer
that omits required detail is visible. See the [report](../benchmarks/reports/v3-agent-context.json)
and [interpretation](AGENT_CONTEXT.md). Small run-to-run count differences arise
from receipts containing hashes of temporary roots.

```sh
node benchmarks/probes/agent-context.mjs /tmp/agent-context.json artifacts/pgraph-0.2.0.vsix
```

See [RESULTS.md](../benchmarks/reports/RESULTS.md) for the latest measured table and
links to machine-readable reports. Timing varies with hardware, OS caching,
compiler graph shape and concurrent processes. These are single local runs, not
statistical service-level guarantees.

The synthetic scale generator creates typed modules with real import/call edges,
validation functions and aggregation functions. It measures initial/unchanged/leaf
indexing, caller-query percentiles and one context query. It does not claim coding
correctness or repository-context reduction for realistic application tasks.

The 10,000-file result exposed a full-text update bottleneck. Schema migration 2
ties FTS row IDs to graph node row IDs, avoiding an unindexed full-text scan on every
node replacement. Query name collation now matches the name index. These fixes are
covered by migration and >2,000-dependent-file invalidation regression tests.

## Production KPI acceptance protocol

The [retrieval and dispatch diagnostic](../benchmarks/probes/retrieval-funnel.mjs)
compares natural-language, larger-budget, known-target-anchor and identifier-assisted
requests on one in-memory corpus. It records which expected nodes search returned,
which were observed during retrieval traversal, and their final representations.
It also indexes a small interface-injection fixture to inspect missing impact/test
paths. Run after building:

```sh
node benchmarks/probes/retrieval-funnel.mjs /tmp/pgraph-research-funnel.json
```

The [recorded report](../benchmarks/reports/v2-research-funnel.json) and
[research interpretation](V2_POWER_RESEARCH.md) explain limitations. The anchor
control uses oracle knowledge and is not an automatic-search benchmark. Search
observation alone cannot identify a later filtering/ranking/budget rejection. The
fixture tests are indexed but not executed. Name recall and source representation
counts do not establish implementation sufficiency or successful coding outcomes.

### Completed-task evaluation

Before claiming >=50% reduction at unchanged correctness:

1. Select versioned medium/large public or company-authorized repositories and
   tasks across the ten categories, with independently specified acceptance tests.
2. Randomize baseline versus graph-assisted runs under the same permitted agent,
   model/version, instructions, starting commit, tools and time limits. Record
   actual search/read/context/edit/test tool traces and exposed source text.
3. Count **all** repository context supplied during each completed task, including
   follow-up slices. Count actual file reads/exploratory calls, completion, latency
   and acceptance-test outcomes. Record failures and abstentions in both arms.
4. Compare paired correctness and completion first; then aggregate token/read/call
   reductions with per-task distributions and uncertainty. Investigate regressions.
5. Require >=50% context reduction, >=40% fewer file reads, >=40% fewer exploratory
   calls and correctness >= baseline before public KPI claims. Keep provider-internal
   token quantities outside the report unless the provider actually exposes them.

Those paired agent trials and live enterprise Copilot semantic authorization have
not been performed by this local implementation run. They remain explicit gates.
