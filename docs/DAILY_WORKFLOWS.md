# Daily workflows in the 0.6.0 preview

**Workspace Impact for Current Symbol** is available from the sidebar, editor menu
and command palette. It links supported HTTP/Azure sites to handlers and candidate
tests across detected projects, without AI. See [the workspace impact guide](WORKSPACE_IMPACT.md)
for mappings, source identities, unknowns and budget limits.

Open **PGraph: Daily Workflow** from the command palette, status bar or sidebar.
The shortcut is **Ctrl+Alt+P** on Windows/Linux and **Cmd+Alt+P** on macOS. It offers
actions for the problem in front of you; no model account is required.

The [research and feature matrix](DAILY_DEVELOPER_RESEARCH.md) explain the eleven
new capabilities, their intended users and an adoption evaluation plan.
The [historical-impact follow-up](HISTORICAL_IMPACT.md) adds before/after Git evidence
and documents a reproduced deleted-API consumer gap.

## Find and understand

**Find Exact Source Text** locates literal error messages or source strings with
matching lines and symbol IDs. **Investigate Stack Trace** accepts a pasted frame
or uses selected multiline text from the current editor. **Understand Current File**
shows declarations, dependencies and consumers. **Find Dependency Cycles** reports
bounded strongly connected file groups. Results open as readable Markdown; the
same evidence is available as budgeted JSON to agents.

## Review the intended patch

**Show Changed Declarations** maps combined staged/unstaged hunks against HEAD,
including supported untracked files. **Review Staged Declarations** compares the
Git index against HEAD. **Compare Branch Declarations** asks for an explicit Git
base reference and compares its merge base with committed HEAD.

Snapshot mismatches remain unknown: staged or committed content must match indexed
working source before declarations can be mapped. Deleted declarations, renames,
top-level changes and configuration may need wider inspection. The existing
**Review My Changes** keeps its conservative file-level analysis.

**Review Historical Impact** is a separate, deeper review. It compares a Git
baseline with working, staged or committed declarations and includes old consumers
of removed APIs. Staged/committed after snapshots can differ from the working
source; working mode requires a fresh index. Signature changes are declared text
differences, and move/rename pairings remain inferred candidates. Inspect all
unknowns and candidate paths before selecting checks. No model or repository script
is executed. [Snapshot modes, budgets and bounds](HISTORICAL_IMPACT.md) explain the
additional extraction cost and limitations.

**Continue Historical Review** retrieves the next budgeted page from the same
project and comparison. Changes to its inputs require a new review. Reports show
selected-file counts, change-kind counts and the total compared declarations;
these totals exclude unknown or unmodeled impact. See [paging and evidence](HISTORICAL_REVIEW_PAGING.md).

**Find Change Test Gaps** lists changed callable declarations and their candidate
tests. A missing static path is not proof that no test covers the code. Candidate
tests are not automatically executed or treated as a replacement for CI.

## Execute and record a check

Run **Discover Repository Checks** to inspect supported package scripts. Then choose
**Run Repository Check** and select the displayed command. This deliberately executes
the repository script and package-manager lifecycle hooks through a VS Code task;
it requires a trusted local workspace. Output and termination remain in VS Code's
task terminal. Install the selected package manager if it is unavailable.

Reindex before running a recorded check. **Show Recorded Checks** reports its exit
result and whether supported source/configuration inputs still match the captured
fingerprint. A new file, changed source or indexed configuration change can make
the receipt stale. Completed results survive worker restarts; pending executions
cannot be attested by a restarted worker.

The receipt records a process result, not individual assertions, full coverage or
successful CI. Environment variables, installed dependencies and unsupported or
excluded assets are outside its fingerprint. A zero exit code is meaningful only
for the selected script and this stated evidence scope. Up to 20 completed records
are stored in the local graph database; no terminal output is stored by this feature.

## Resume an investigation

Place the cursor inside an indexed declaration and run **Save Investigation**.
Give the task a short description. **Resume Investigation** resolves its stable
symbol ID again and retrieves fresh context. Remove old entries with **Remove Saved
Investigation**. Up to 30 entries are retained in local VS Code workspace state.
Task-only bookmarks can be saved when no source editor is active. Missing or renamed
symbols require a new anchor; bookmarks do not preserve old source answers.

## CLI and agents

One read-only tool, `workflow` (`pgraph_workflow` in VS Code), exposes ten
evidence actions. It has no execution or bookmark-write action. This avoids adding
one agent schema per editor command.

```sh
pgraph workflow health
pgraph workflow text "Negative balance" --scope src --tokens 1000
pgraph workflow trace "at compute (src/core.ts:2:9)" --tokens 1000
pgraph workflow file --file src/core.ts
pgraph workflow cycles --scope src
pgraph workflow changes --mode working --tokens 3000
pgraph workflow changes --mode staged
pgraph workflow changes --mode branch --base main
pgraph workflow change_impact --mode staged --file src/core.ts --tokens 3000
pgraph workflow test_gaps
pgraph workflow checks
pgraph workflow verification
```

`main` is an example; choose a reference that exists in the repository. CLI and MCP
require an existing index. The editor's freshness command can also explain an
uninitialized index. `limit`, `offset` and `caseSensitive` control literal search;
`limit` caps the number of files considered for change queries. Unsupported options
should be omitted. See the generated tool schema for types and bounds.
For historical continuation, use the returned next offset and review ID together;
keep the same mode/base/file/limit. The CLI accepts `--review-id` for this action.

Library methods are `health()`, `searchText(query, options)`, `traceError(trace)`,
`fileOverview(file)`, `dependencyCycles(scope)`, `changedDeclarations(options)`,
`historicalChanges(options)`, `testGaps(options)`, `checks()` and `verification.results()`. A trusted host can
call `verification.begin(checkId)` before executing the returned process arguments
and `verification.finish(runId, exitCodeOrNull)` afterward. These functions do not
execute a process themselves; only the host can supply actual execution evidence.
They are not exposed as write operations over MCP.

Health scans supported files within configured discovery limits. Literal search
caps scans at 2,000 files/20 MB and results at 100 lines. Cycles consider at most
1,000 source files, 200 dependents per file and 30 components. Hunk mapping caps
files at 100 and declarations at 100. Test gaps inspect at most 30 changed callable
declarations with bounded four-hop static paths. Inspect all unknown/truncated
flags before deciding whether additional searches or checks are needed.

## Validation

The added regression suite covers input freshness, literal search, stack-frame
aliases, consumers/cycles, hunk selection, staged/branch mismatches, deletions,
nested Git roots, test gaps, check discovery, stale receipts and restart behavior.
The actual VS Code integration runs a temporary fixture check and tests saving and
resuming an investigation. It does not run scripts from the developer's normal
workspace or make a live model request.

The [controlled workflow probe](../benchmarks/reports/v4-daily-workflow.json)
compares the existing file review with hunk mapping plus targeted impact on a
constructed one-function edit. It is a navigation diagnostic, not a complete
developer task trial.

In that fixture, the existing file review returns 60 affected entries. Hunk mapping
selects the one edited function and its targeted impact returns three entries
(the function, consumer module and consumer function). Request/response traffic is
3,857 tokens for file review versus 682 for hunk mapping plus impact. The report
separately records 3,015 tokens for the current declared schema set. It uses the
same current engine for both paths, not a historical-version comparison. This
favorable synthetic case does not establish correctness or savings on real tasks.
Small metadata/hash-token differences occur between runs. Reproduce with:

```sh
npm run build
node benchmarks/probes/daily-workflow.mjs /tmp/pgraph-daily-workflow.json
```
