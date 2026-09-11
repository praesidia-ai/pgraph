# More useful context with fewer repeated reads

The **0.3.0 v2 preview** extends PGraph's deterministic engine. None of these
features calls a model. An existing coding agent can use the same tools through
MCP or VS Code; developers can use the CLI, library and editor context command.

**0.5.1 workspace update:** VS Code Workspace scope now retrieves task context from
all detected projects under one total output budget. Use each result's `project`
ID with symbol/file follow-ups. Cursor anchors and receipts require one project.
The [workspace contract](WORKSPACE_GRAPH.md#workspace-context-for-developers-and-agents)
explains identities, freshness, partial failures and packing limits. CLI/MCP remain
bound to one root; cross-service impact is not established by this aggregation.

## Delivered improvements

**0.6.0 workspace impact:** in VS Code, call the existing `impact` tool with
`workspace: true` and an origin `project` ID. It links supported HTTP/Azure sites
to handlers and local code across detected projects. Complete paths, source hashes,
project failures and omissions share one output budget. Use returned project/symbol
IDs for follow-ups. [The workspace impact contract](WORKSPACE_IMPACT.md) explains
candidate semantics, cancellation, freshness and depth limits. MCP remains local.

**0.5.5 review continuation:** historical results prioritize removed declarations
before page limits and provide scoped change counts. Keep the same query selection
and send `page.nextOffset` as `offset` with `page.reviewId` to retrieve more rows.
Changed inputs require a fresh review. The [paired limit investigation](HISTORICAL_REVIEW_PAGING.md)
shows why a truncated first page is not sufficient evidence for a large change.

**0.5.4 historical impact:** `workflow` with `action: "change_impact"` reconstructs
old/current consumers for selected Git changes. Use it for removed APIs or declared
signature changes, keeping snapshot identities and unknown areas with the evidence.
The [paired compiler/worker fixture](HISTORICAL_IMPACT.md#reproduction-and-results)
demonstrates recovered paths; richer evidence can cost more tokens. It does not
establish compatibility or whole-task savings.

**0.5.3 task selection:** declaration filtering before search limits, English
inflections, term coverage and direction-preserving traversal improve local retrieval.
The [frozen comparison](SELECTION_QUALITY.md) still leaves six required targets out
of the shortlist. Source/excerpt recall and completed agent tasks remain open gates.

**0.5.2 source resolution:** callers, callees and candidate test paths can cross
declared local TypeScript project references through public package exports, even
before building. Reindex after upgrading. See [the resolution contract](PROJECT_SOURCE_RESOLUTION.md).

- **Targeted excerpts:** retrieve a bounded source window around a cursor or
  matching query text inside a large declaration. Every result includes actual
  lines, a source hash, omitted-line counts and a partial-source warning. Context
  packing considers these excerpts automatically, including at ordinary budgets.
- **Better evidence selection:** retain a primary target, give its implementation
  a budget reservation, and reserve a related test for change/debug/test tasks
  when available and affordable. Exact anchors receive additional consideration.
  Markdown removes duplicate identity/location fields; structured JSON retains them.
- **Explained test paths:** follow callers/references and declared interface-member
  relationships to candidate tests. Results carry paths, limits and a possible
  dispatch label. An unrelated method with the same name is not an implementation.
- **Context receipts:** a client retaining an earlier response can request reuse
  of unchanged symbol entries. The engine sends reused IDs and current metadata
  instead of repeating those entries, but only when the delta is smaller.
- **Selection diagnostics:** opt-in `explain` reports candidate/shortlist counts
  and a bounded sample of omitted IDs with reasons. This helps diagnose retrieval
  without paying the explanation overhead on every request.
- **Dependency freshness:** changes to supported text lockfiles invalidate
  extraction. The editor watches npm, pnpm, Yarn and text Bun lockfiles when
  automatic indexing is enabled.

These are bounded heuristics. The primary target may still be incorrect for an
ambiguous task. An explicit file/line focus or resolved symbol ID provides a
stronger anchor. Full implementation bodies and tests cannot always fit a small
budget; a selected signature alone does not establish implementation sufficiency.

## Suggested agent workflow

Start with `context` and a 1,500–2,000 token budget. Describe the task and include
an actual symbol or editor focus when known. Inspect source representations,
selection reasons, uncertainty and truncation. For missing detail, request
`excerpt` with a query/cursor, `slice` for a complete small declaration, or
`file_slice` for an explicit range. `tests` explains candidate paths; executing
tests remains the responsibility of the host's separately available tools.

CLI examples:

```sh
pgraph context "Change Handler.reconcile chargeback reconciliation" --tokens 2000
pgraph excerpt Handler.reconcile --query "chargeback reconciliation" --max-lines 20 --tokens 800
pgraph tests SqlLedger.save --depth 4 --tokens 2500
pgraph context "Find tests for SqlLedger.save" --tokens 2000 --explain
```

Use repository-relative `--root` or an absolute root as appropriate. Source windows
are contiguous line selections, **not data/control-flow slices**. They may omit a
guard, initialization or surrounding branch. Read the missing surrounding source
before making a change that depends on it.

## Receipt protocol

This JSON tool request returns a `contextId` and the ordinary context package:

```json
{
  "task": "Change SqlLedger.save balance validation",
  "maxTokens": 2000,
  "format": "json"
}
```

On a follow-up, send the same fields and `previousContextId` set to the returned
24-character receipt. Do this **only while the client still retains that context**.
The library accepts the receipt in `options.previousContextId`.

If the result has `reuseFrom`, reconstruct its symbol set from newly supplied
`symbols` plus exactly the `reusedSymbols` IDs from the retained context. Replace
relationships, tests, constraints and warnings with the newly returned fields.
Discard prior symbols not named in either list. Associate the reconstructed full
result with the new `contextId`. A result without `reuseFrom` is a full replacement.
If client history has been compacted or lost, omit the receipt and fetch full context.

The cache holds at most 32 full results per engine process. Unknown or evicted
receipts and worker restarts fall back to full context. Receipts are isolated by
evidence mode, and selected source is checked for freshness before reuse. Reindex
after edits; changed entries are supplied again when selected. Equality includes
representation, location, score and reasons, so different tasks may reuse little
even when source is unchanged. This conservative protocol is not arbitrary task
memory or model understanding. CLI invocations do not share a process and expose
no receipt flag; long-lived MCP/editor workers and library clients can reuse them.

## Compatibility and limits

The `tests` tool now returns `{ target, tests, truncated, warnings }`. Each test has
`node`, `path` and `potentialDispatch`; it previously returned a flat node array.
Library `testsFor()` retains its direct-only behavior; use `testPaths()` for the
new result. Default traversal depth is four, capped at eight, with bounded vertices
and neighbors. `impact` also follows declared member relationships and marks
possible dispatch in `likelyChangeSurface`. Its default depth remains three.

An explicit `implements` declaration proves membership, not the runtime receiver
at a call site. Interface paths can include tests using another implementation;
they are candidates, not execution coverage. Structural typing without an explicit
declaration, reflection and runtime dependency injection remain incomplete.

`explain` returns at most five omission records that fit the budget. Some reasons
combine score/parent/shortlist filtering; it is a diagnostic sample, not an exhaustive
rank trace. Normal context does not include this extra diagnostic payload.

Lockfile changes trigger broader re-extraction on the next index. Supported names:
`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`.
The binary `bun.lockb` format is not included. Dependency installation itself is
never performed by PGraph.

## What the measurements establish

The [controlled report](../benchmarks/reports/v3-agent-context.json) compares the
retained 0.2.0 VSIX with 0.3.0 workers on identical generated files. Three repeated
JSON context calls for a small-method change cost **2,052 → 1,517** request/response
BPE tokens (**26.1% less**). Including every declared tool schema once per session
changes the totals to **4,532 → 4,286** (**5.4% less**). The target source marker is
present in both versions throughout. Receipt hashes depend on the
temporary root, so small BPE-count variations occur between runs.

The large-method case costs **492 → 688** traffic tokens: the old result omitted
the required implementation detail, while the preview supplies a relevant excerpt.
Lower token counts alone are therefore insufficient. Schema overhead grows from
2,480 to 2,769 tokens under this declared serialization.

This deliberately repetitive fixture favors reuse. It does not measure completed
agent tasks, hidden reasoning, billing, repeated conversation processing, or host
prompt caching. Actual schema encoding/exposure depends on the host. The report
records hashes, source checks and limits; its source markers are not acceptance
tests for a code change. Reproduce after building:

```sh
node benchmarks/probes/agent-context.mjs /tmp/pgraph-agent-context.json artifacts/pgraph-0.2.0.vsix
```

The [current retrieval diagnostic](../benchmarks/reports/v3-research-funnel.json)
retrieves 6/15 inherited required symbols for natural-language tasks (3/10 tasks
complete) and 15/15 with identifiers. Two natural-language targets now include full
source; the historical 0.2.0 report retrieved 7/15, with none represented as full
source. Both engine and self-repository corpus changed, so this is not a controlled
ranking comparison. The probes are known development queries, not held-out trials.
Broad task search remains an open quality gate.

The remaining v2 gates are tracked in [V2_DELIVERY.md](V2_DELIVERY.md). The next
major gains require precise diff impact, cross-root context and verification
results, followed by paired complete tasks on representative repositories.
