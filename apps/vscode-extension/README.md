# PGraph by Praesidia for VS Code

Persistent local repository intelligence for coding agents. Index TypeScript and
JavaScript, then retrieve symbols, callers, dependencies, tests and selected source
ranges under an explicit token budget. No external model key or cloud database is
required for the deterministic engine.

## Start

1. Install Node.js 22.18 or newer (24 LTS recommended).
2. Open a trusted repository, several workspace folders, or their parent folder.
   **PGraph: Choose Scope** selects Project or Workspace. Run **Index Repository**
   for one project or **Index Workspace** for all detected projects.
3. Open the PGraph sidebar, or enable PGraph tools in Copilot Agent Mode.
4. Use `#pgraph_context` with a task such as "Add rate limiting to login".

Set `pgraph.nodePath` in user settings if the required Node executable is not on
PATH. Source analysis runs in a separate process. The local `.pgraph` directory
contains source-derived metadata; add it to your repository's ignore rules.

Commands include Find Symbol, Find Callers, Find Callees, Impact Analysis, Find
Relevant Context, Show Architecture, Graph Status, Show Token Savings and Reindex
Changed Files. Existing indexes update after source saves by default.

If VS Code reports `spawn node ENOENT`, run `node --version` and
`node -p "process.execPath"` in Terminal **on the affected computer**. Set
**PGraph: Node Path** in VS Code user settings to that full executable path,
without added quotes, and retry indexing. Node must be 22.18+; installing the VSIX
does not install Node. Paths from a different laptop may not exist on this one.

For large repositories, indexing has a 15-minute execution limit. Adjust
`pgraph.indexTimeoutSeconds` in VS Code settings if needed. Query execution defaults
to 120 seconds (`pgraph.queryTimeoutSeconds`), excluding time queued behind an
index. The indexing notification shows the current TypeScript project and elapsed
time, and remains cancellable. Workspace indexing processes folders sequentially,
keeps a database in each folder, and releases idle workers to limit memory use.
In Workspace scope, context combines per-project source evidence under one total
output budget. Results retain project IDs, revisions, source hashes and partial
failures. Other agent tools require the returned `project` ID or a pinned Project
scope; cursor anchors and context receipts require one project. **Explore
Relationships** composes cross-service communication candidates across the
workspace indexes. Grouped context does not prove cross-service impact.

## Local package source

The 0.6.0 **Workspace Impact for Current Symbol** command follows explicit
HTTP/Azure communication mappings into other projects' handlers and candidate
tests. Use it from the editor menu or sidebar after **Index Workspace**. The agent
tool `pgraph_impact` accepts `workspace: true` with an origin `project` ID. Results
retain complete paths, project errors, source hashes and budget omissions. This
static analysis runs without AI and does not establish delivery or compatibility.

The 0.5.3 preview improves local task selection with English inflections, term
coverage and declaration filtering before search limits. Traversal avoids unrelated
callers of shared helpers and retains declared possible implementations. Search
quality on broad developer tasks remains under evaluation; no model call is required.

The 0.5.2 preview follows local TypeScript project references from package exports
to current indexed source, including unbuilt packages and stale local declarations.
This restores missing callers, callees and candidate test paths. Run **Index
Workspace** after upgrading; freshness checks identify an older extraction.
Separate installed packages and out-of-root references remain separate.

## Optional Copilot enrichment

Enable `pgraph.semanticEnabled` in **user settings**, then explicitly run
**PGraph: Build Semantic Index**. Choose a symbol and an available Copilot model.
VS Code handles model consent. Compact source-derived evidence is sent only by
this explicit action; enrichment never runs in the background. Regular agent tools
return their results to the invoking agent according to the host's permissions.

Source and semantic text are untrusted evidence. Skeletons may contain sensitive
literals/types; they are not secret-redacted. Semantic claims retain provenance
and are invalidated when their underlying files change.

## Measurement and limits

Token savings refer to **repository-context tokens**, not hidden Copilot tokens.
The default counter is cl100k_base BPE; tool invocations also respect a host-provided
model tokenizer when available. Automatic tool selection is the agent's choice.
Static analysis is incomplete for dynamic dispatch, computed routes and runtime DI.

This is the 0.6.0 v2 preview. The real extension-host workflow is automated; live
model authorization and correctness on representative company tasks must be
validated in your environment before production rollout.

MIT licensed. The underlying PGraph core also exposes CLI and MCP adapters.

## Daily workflow

A non-Git parent folder can contain multiple direct child repositories. PGraph
discovers them as independent projects instead of asking Git to resolve the parent's
HEAD. A Git monorepo remains one project. Use **Refresh Workspace Projects** after
changing child repositories on disk. Discovery supports up to 64 projects and scans
up to 256 direct child directories per non-Git parent; child symlinks are skipped.
Loose files beside discovered repositories are outside their indexes.

Workspace scope groups daily reports, check choices and saved investigations by
project. Missing Git history, unavailable refs or missing indexes are reported per
project. One failure does not discard other projects' results. A pinned Project
scope persists when editor focus changes; cursor/file actions use the source's
own project. Agent context and symbol tools still query one selected project.

Open **PGraph: Daily Workflow** from the command palette, status bar or sidebar
(Cmd+Alt+P on macOS; Ctrl+Alt+P elsewhere). Find exact error text, map stack frames,
inspect file consumers/cycles, review edited declarations or staged/branch changes,
and inspect candidate test gaps. Reports are readable Markdown; agents use the
single read-only `pgraph_workflow` tool.

**Review Historical Impact** compares working, staged or committed declarations
with their Git baseline. It recovers old consumer/test paths for removed APIs and
shows before/after signatures, explicit unknowns and bounded traversal. Staged and
committed snapshots can differ from working source. Working mode needs a fresh
index. Workspace scope reviews projects separately with progress and partial errors.
This local analysis makes no model calls and executes no repository scripts.
Signature changes and inferred move/rename candidates still require compatibility
checks; cross-service impact and runtime coverage are not established.

**Continue Historical Review** retrieves another page from the same project and
Git comparison. Removed declarations and signature changes are selected before
the page limit. Reports distinguish selected files, total compared changes and
unknown areas. Agents send the returned `page.nextOffset` as `offset` with
`page.reviewId` as `reviewId`, preserving their original comparison options.
Changed inputs require a fresh review; missing consumer paths still need wider checks.

**Discover Repository Checks** shows supported package scripts. **Run Repository
Check** deliberately executes the selected script and lifecycle hooks through a
VS Code task. **Show Recorded Checks** distinguishes process outcomes and stale
supported-input evidence. It is not a full CI or coverage certificate; environment
and unindexed assets are outside its fingerprint. Scripts never run from query tools.

**Save Investigation**, **Resume Investigation** and **Remove Saved Investigation**
manage local task/symbol bookmarks. Resuming retrieves fresh context. **Check Index
Freshness** identifies supported new, changed, deleted and configuration inputs.

## Source excerpts and reusable context

The 0.3.0 preview adds `pgraph_excerpt` for a source window around matching text or
a cursor inside a declaration. Results include actual lines, source hashes and
omission warnings. Task context can select these partial excerpts automatically.
`pgraph_tests` now returns candidate tests with paths and possible interface-dispatch
labels; it does not establish runtime receiver identity or execute tests.

Agents retaining an earlier context can pass its `contextId` as
`previousContextId`. Smaller follow-ups list unchanged symbol IDs to reuse and
supply current metadata. If earlier evidence is no longer retained, omit the
receipt; unknown receipts and restarted workers return full context. Optional
`explain` adds bounded selection diagnostics. All these features work locally
without model calls. Supported text dependency lockfiles also trigger auto-indexing.

## V2 local context and change review

Use **PGraph: Context for Current Symbol** from the source editor context menu or
command palette. Place the cursor inside a declaration or its body, then describe
the task. Results include indexed symbol IDs, selection reasons and short source
bodies within the budget. Save and reindex stale source before using this action.

**PGraph: Evidence Mode** defaults to `local`, excluding cached AI concepts and
constraints. `assisted` includes existing inferred facts. Neither mode makes a
model call; generating semantic evidence remains a separate explicit command.
The editor's evidence setting takes precedence over tool arguments.

**PGraph: Review My Changes** refreshes the selected repository and displays
affected code, candidate tests and suggested checks for staged, unstaged and
untracked Git changes against HEAD. It needs an initial Git commit. Analysis is
conservative at file level: removed/renamed-symbol history and cross-service
consumers are not reconstructed. Unsupported/stale files and limits are shown.
No tests or repository scripts are executed by change review.

## Explore services and symbols

After **PGraph: Index Workspace**, run **PGraph: Explore Relationships**. The local
interactive map spans the folders in this window's workspace. Select a service to
search symbols, expand incoming/outgoing relationships, inspect provenance, and
open either endpoint's source. Keyboard-accessible lists accompany the canvas.

Cross-service candidates require compatible routes/channels and explicit service
URL or messaging resource identities in `.pgraph.json` → `topology.services`.
Unknown destinations appear separately. See `docs/WORKSPACE_GRAPH.md` in the project
for configuration examples, supported Azure patterns and limits. Context tools
continue to query one selected repository.
