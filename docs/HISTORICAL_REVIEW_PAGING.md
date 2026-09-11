# Keep important changes reachable in a bounded review

The 0.5.5 preview fixes a reproduced review failure: a removed API disappeared
behind a 100-change limit after many routine edits. A small token budget reduced
the visible list further, with no continuation operation. This is a correctness
and navigation problem for both developers and agents, not a reason to increase
every response budget.

The reproduction started with 120 body edits and one removed API. The 0.5.4
library returned 100 changes with `truncated: true` but no removal. A 2,000-token
tool response retained nine of those rows. Packing a cached analysis took 1,540 ms
in that local exploratory run, versus 945 ms for historical analysis itself.

## What changed

PGraph classifies the bounded comparison before choosing a page. Removals come
first, followed by declared signature changes, inferred move/rename candidates,
body/source modifications and additions. This is a navigation order, not a severity
assessment: a body modification can still be the most important behavioral change.

Each response includes counts by change kind and a `page` containing the review
identity, offset, returned count, total compared changes and optional next offset.
`filesSelected` versus `totalFiles` makes the selected changed-file scope visible.
Totals cover modeled declarations within that selection, not all possible impact.
Unknown files, comparison bounds, dynamic paths and consumer truncation still matter.

Only the selected page receives consumer expansion. At most 100 declaration rows
are expanded per query, and output packing can return fewer. Packing preserves a
contiguous prefix of the priority order and adjusts the next offset to the rows
actually returned. Binary search for a fitting prefix avoids repeatedly tokenizing
nearly the entire oversized response. Consumer-path omissions remain explicit.

## Continue as a developer

Install the 0.5.5 preview and run **PGraph: Review Historical Impact**. A report with
more declaration rows tells you to run **PGraph: Continue Historical Review**, also
available in Daily Workflow. For multiple projects with pending pages, choose the
project to continue. The next page uses that project's captured root, comparison
mode and reference; it does not borrow another repository's HEAD.

Continuation is retained for the current extension session. Starting a new review
replaces its pending pages. A closed project must be reopened and reviewed again.
Cancellation and normal query timeouts still apply. The command shows another page;
it does not silently fetch every remaining declaration or run repository scripts.

## Continue as an agent or CLI user

Use the existing `workflow` tool with `action: "change_impact"`. If
`page.nextOffset` exists, repeat the same mode/base/file/limit selection and send
that value as `offset`, together with `page.reviewId` as `reviewId`. The token budget
may change between pages. Do not increment by 100 or by the requested token budget.

```sh
pgraph workflow change_impact --mode staged --tokens 2000
# Copy both values from the response; keep the same comparison options.
pgraph workflow change_impact --mode staged --tokens 2000 \
  --offset RETURNED_NEXT_OFFSET --review-id RETURNED_REVIEW_ID
```

An offset without its review identity is rejected. Changes to the selected Git
snapshots, index revision, working-source fingerprint, policy or file selection
invalidate the continuation. Reindex stale working source, restart at offset zero
without a review ID, and replace the previous review evidence. Do not concatenate
pages from different identities.

No next offset means no more declaration rows within this bounded comparison. It
does not mean every consumer was returned or the change is safe. For omitted
consumer paths, use a narrower file query or larger budget and inspect wider
dependencies/checks. Changing file scope starts a new review.

## Paired evidence

The [retained-worker comparison](../benchmarks/reports/v055-historical-review-limits.json)
uses identical Git fixtures with 120 body edits, one removed export and one declared
parameter change. A separate TypeScript 5.9.3 process confirms the baseline compiles
and the edited fixture produces TS2305 and TS2345. Application tests and models are
not executed.

At a 2,000-token output budget, the 0.5.4 worker exposes eight declarations in its
first result, omits the removed API and offers no continuation. The 0.5.5 worker
places the removal first and exposes all 122 compared declarations across 14 pages,
with no skipped or duplicate rows. Both are authored development fixtures, not
held-out company tasks or evidence of complete compatibility analysis.

| Observation                                                | Retained 0.5.4 |  0.5.5 |
| ---------------------------------------------------------- | -------------: | -----: |
| First page elapsed                                         |       1,514 ms | 713 ms |
| Identical cached repeat elapsed                            |         840 ms | 171 ms |
| Unique compared declarations exposed through offered pages |              8 |    122 |
| Offered pages consumed                                     |              1 |     14 |
| Request/response tokens for those pages                    |          1,918 | 27,975 |

These are single-run timings on macOS arm64 / Node 22.22.0. The last row compares
different amounts of evidence; it is not a token-efficiency ratio or billing claim.

The report records first-call and cached-repeat latency, every request/response,
compiler diagnostics, fixture sources/hashes and both build identities. Traffic
counts request name/input plus returned text using `cl100k_base`, excluding indexing,
discovery schemas, IPC, compiler execution and the duplicate repeat. Reading all
pages costs more total tokens than stopping at an incomplete first page. Compare
task outcomes before treating reduced first-page latency as a delivery improvement.

```sh
npm run build
node benchmarks/probes/historical-review-limits.mjs /tmp/pgraph-review-limits.json
```

Keep `artifacts/pgraph-0.5.4.vsix` for the baseline. The probe records the current
build's version and worker hash; rerunning it on a later build is a new observation.

## Remaining limits

The engine currently reconstructs snapshot graphs for a new page; only repeating
the most recent identical page reuses its completed result. Large-repository paging
latency is unmeasured. The changed-file limit and the 5,000 combined-declaration
comparison bound still apply. Declaration pagination does not page through skipped
files or unmodeled code. The [historical analysis guide](HISTORICAL_IMPACT.md)
documents snapshot extraction and consumer bounds.

Regression coverage checks priority before limits, exact continuation after budget
packing, complete library pagination, stale identities and selected-file counts.
The isolated VS Code test adds 150 declarations to a fixture review, invokes the
registered continuation command and checks the same review identity and disjoint
visible declarations. The broader [v2 outcome gates](V2_DELIVERY.md) remain open.
