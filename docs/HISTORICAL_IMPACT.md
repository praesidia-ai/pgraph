# Historical change impact in 0.5.5

Updated 2026-09-10. This preview addresses a concrete blind spot: after deleting an
API, a graph of current source can no longer explain its old callers. Developers
reviewing a removal need those callers before deciding what else to change or test.
The [existing user-gap research](USER_GAP_RESEARCH.md) motivates trustworthy change
evidence; it does not establish demand or adoption for this particular command.

PGraph now builds a bounded graph of the selected Git baseline and compares its
declarations with the selected after snapshot. It returns before/after signatures,
file hashes and static consumer/test paths. This requires no AI account or model
call. It is a foundation for impact review, with compatibility and real-task
validation still open in [the v2 tracker](V2_DELIVERY.md).

## Use it in one project or a workspace

Install `artifacts/pgraph-0.5.5.vsix`, then run **PGraph: Index Repository** for one
project or **Index Workspace** for detected projects. Run **PGraph: Review Historical
Impact**, also available in **Daily Workflow**, and select a comparison:

| Mode      | Before                                        | After                                                   | Working source requirement                           |
| --------- | --------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| `working` | HEAD                                          | Saved, indexed working source, including staged changes | Must match the current index; save and reindex first |
| `staged`  | HEAD                                          | Git index blobs                                         | Can differ from working source                       |
| `branch`  | Merge base of the supplied reference and HEAD | Committed HEAD                                          | Can differ from working source                       |

All modes need an existing PGraph index with the supported extraction version and
a Git working tree with an initial commit. Branch mode asks for a reference that
exists in that project. In Workspace scope, projects are reviewed sequentially
against their own Git history. Failures stay beside the affected project; successful
projects retain their reports. This does not connect impact across repositories.
The notification supports cancellation and the configured query timeout applies.

A non-Git parent such as `frontier/` is a container for direct child repositories.
Use **Choose Scope** to pin a Project or select Workspace; do not create a parent
Git repository to satisfy HEAD lookup. See [discovery and scope](WORKSPACE_GRAPH.md).

The CLI and MCP server operate on their configured root. Agents in VS Code can
route the existing `pgraph_workflow` tool with a returned project ID. No additional
tool schema is needed:

```json
{
  "action": "change_impact",
  "mode": "staged",
  "file": "src/price.ts",
  "maxTokens": 2000
}
```

```sh
pgraph workflow change_impact --mode working --tokens 3000
pgraph workflow change_impact --mode staged --file src/price.ts --tokens 2000
pgraph workflow change_impact --mode branch --base main --tokens 3000
```

`main` is only an example. `file` is an optional exact project-relative path and
narrows changed-file output before `limit` is applied. It does not restrict all
baseline indexing to that file: callers can be in other files. The library entry
point is `graph.historicalChanges({ mode, base, file, maxFiles })`.

In 0.5.5, removals and declared signature changes are prioritized before page
limits. **Continue Historical Review** reaches additional declarations in the editor.
Agents pass `page.nextOffset` as `offset` with `page.reviewId`, keeping the same
comparison options. The library accepts these options too. See [continuation,
counts and the reproduced limit failure](HISTORICAL_REVIEW_PAGING.md).

## Read the evidence correctly

Each row distinguishes an addition, removal, source modification or declared
signature change. Signatures include declaration headers, visibility, export flags
and declaration kinds. A changed signature is not a TypeScript assignability result
or proof of breakage. Compiler-rendered signatures may also vary because of inferred
types or missing installed dependencies; that difference is reported separately.

Unique unchanged source at a different location can produce `move-candidate`.
A unique match after replacing only the declaration name can produce
`rename-candidate`. Both are inferred pairings. Neither proves identity or preserved
import compatibility; ambiguous matches remain separate additions/removals or
explicit unknowns. Overloads and duplicate identities are not guessed into pairs.

Consumers carry `before`, `after` or `both` evidence and a path of symbols, source
locations, relationships and traversal directions. Before consumers also report
whether their declaration source is unchanged, changed or absent/unresolved in the
after snapshot. Unchanged caller source does not imply that the call is still valid.
Declared interface paths remain possible dispatch. Listed tests are candidates,
and this command does not run them.

`beforeHash` and `afterHash` identify entire source files, not individual declaration
bodies. Snapshot identities distinguish the selected Git listing or working-input
fingerprint; `revision` records the current PGraph index. Snapshot identities are
local evidence and do not attest installed dependencies, runtime configuration or CI.

Inspect `unknown`, `warnings` and `truncated`, even when `changes` is empty.
Unsupported/excluded files, syntax errors, missing declarations and text outside
modeled declarations remain unknown. Module initialization, changed imports and
unmodeled class effects can matter independently of a function signature.

## Local analysis and bounds

Git provides tree entries, object IDs and original blob contents without checking
out another branch. PGraph uses NUL-delimited listings and object-ID batch reads,
consistent with the documented [tree format](https://git-scm.com/docs/git-ls-tree)
and [batch object protocol](https://git-scm.com/docs/git-cat-file). It does not request
checkout filters, execute repository scripts or fetch missing objects.

Historical source/configuration is materialized in a private temporary directory,
indexed with an in-memory database and removed on ordinary success or failure.
Abrupt process termination can leave an OS temporary directory. Source is never
checked out over the developer's working files. Symlinks/submodules are skipped;
conflicted supported index entries, unsafe paths and bounds failures stop the
snapshot read. Files must be supported UTF-8 inputs.

Historical indexing applies current include rules and the union of current and
historical exclusions, while respecting historical ignore files. Installed packages
and external project sources are not copied. Local tracked TypeScript references can
resolve within the snapshot; missing external types/references can reduce evidence.

Snapshot materialization is capped at 5,000 eligible source/configuration files and
100 MB, or lower configured limits; configured per-file limits also apply. A
supported blob that exceeds these bounds produces an explicit error. Git metadata
listings are bounded too. These limits apply before all configured discovery
exclusions are evaluated, so a large tracked input can prevent historical analysis
even if normal indexing ignores it.

Changed-file selection caps at 100 files, comparison at 5,000 combined declarations,
and consumer expansion at 100 changes per page. Consumer traversal is bounded to three edges, 60 seen
nodes and eight reported consumers per snapshot. Diagnostics and unknown lists
also have bounds. Wider impact can remain outside these limits.

Packing keeps declaration/snapshot evidence and caveats before extra consumer
paths. Omitted paths or rows set truncation. If the required evidence and caveats
cannot fit, the tool asks for a file filter or larger budget instead of returning
an apparently complete answer. Editor reports use a per-project budget; the separate
workspace task-context operation has one combined budget.

The most recent completed page is cached per open PGraph instance. Repeat reads
recheck Git listings, current selection and policy; working reviews also check source
freshness. Longer analysis revalidates these inputs before publishing the result.
Snapshots are not atomic with concurrent edits: an observed mismatch requests a
retry. First-use latency includes baseline extraction and can be substantially
greater than an ordinary indexed query. Large real-workspace latency is unmeasured.

## Reproduction and results

The [paired worker report](../benchmarks/reports/v054-historical-impact.json) compares
the retained 0.5.3 VSIX with the built 0.5.4 worker on identical committed fixtures.
For 0.5.3 it calls both existing declaration mapping and file review; for 0.5.4 it
calls historical impact once. All queries use a 2,000-token output limit. A separate
TypeScript 5.9.3 `noEmit` process checks each fixture before and after editing.

| Fixture                                        | Independent compiler result                 | Historical result                                                  | 0.5.3 traffic tokens | 0.5.4 traffic tokens |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ | -------------------: | -------------------: |
| Delete exported `price` API file               | Baseline passes; edited source fails TS2307 | Removed declaration, old `checkout` caller and candidate test path |                  357 |                  639 |
| Change `price` parameter from number to string | Baseline passes; edited source fails TS2345 | Declared signature change with consumer/test paths                 |                  699 |                  720 |
| Add comment before unchanged declaration       | Both pass                                   | No declaration change; outside-declaration text remains explicit   |                  677 |                  347 |

The deleted API was unknown to the old current-only tools. The new command restores
its missing path, while the compiler independently establishes a broken import in
this fixture. The signature fixture independently establishes a rejected argument;
the historical command itself still makes no compatibility diagnosis.

Traffic uses `cl100k_base` on request name/input and returned text. It excludes
indexing, discovery schemas, IPC, compiler execution and a separately recorded repeat
query. First historical calls took 687–746 ms; repeat calls took 121–287 ms on this
small macOS arm64 / Node 22.22.0 run. The richer deletion result costs more tokens.
These authored fixtures do not measure paid tokens, model performance, completed
developer tasks, production repositories or application-test execution.

```sh
npm run build
node benchmarks/probes/historical-impact.mjs /tmp/pgraph-historical-impact.json
```

The probe requires the retained `artifacts/pgraph-0.5.3.vsix`. It records fixture
sources/hashes, baseline artifact hash, current worker hash, compiler diagnostics,
responses and timing so the evidence can be inspected and reproduced.
The checked-in report above is the archived 0.5.4 observation. Rerunning the probe
uses the current build and writes a separate result rather than overwriting it.

Regression coverage includes staged/working divergence, committed after snapshots,
nested roots, source hashes, inferred moves/renames, new consumers, syntax recovery,
Git index changes during analysis, cache isolation, bounds and budget handling.
The real isolated VS Code host removes a fixture method, indexes, invokes the new
command and verifies recovery of its old caller in the report.

## What closes the next gap

Use independently chosen real change tasks to compare missed consumers, time to
the correct patch and required-check results. Include deletions, parameter changes,
overloads, import rewrites, changed configuration and cross-service payload changes.
Run the same developer/agent workflow with and without historical evidence and
count every follow-up read. This preview closes a demonstrated evidence loss;
full compatibility analysis, cross-service impact and repeated developer adoption
remain unproven.
