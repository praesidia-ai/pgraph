# API and configuration

`PGraph.open(root, { store?, counter?, requireIndex? })` is the composition root.
The root must exist. `counter` implements `{ name, count(text): number }` and must
return finite nonnegative integer token counts. `store` implements `GraphStore`.
Close graph instances when finished. Methods are synchronous; hosts must move
indexing/context work off their UI thread, as the VS Code adapter does.

The 0.4.0 [daily workflow API](DAILY_WORKFLOWS.md) adds `health`, `searchText`,
`traceError`, `fileOverview`, `dependencyCycles`, `changedDeclarations`, `testGaps`,
`checks` and `verification.results`. Nine evidence actions share the read-only
`workflow` agent tool. The editor separately runs chosen package checks and records
their process results; neither the core API nor MCP executes them automatically.

| API                                                        | Result / behavior                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `init()`                                                   | Create local initialization marker; never alter source or instructions  |
| `index({ rebuild? })`                                      | File/parse/skip/delete counts, graph revision, timings, diagnostics     |
| `status()`                                                 | Stored index counts, revision, last run; not a fresh filesystem scan    |
| `symbol(nameOrId)`                                         | Definition; ambiguous names require an ID                               |
| `searchSymbols(query, { scope?, kind?, limit?, offset? })` | Bounded FTS/name search                                                 |
| `callers`, `callees`, `references`, `implementations`      | Direct symbol relationships                                             |
| `dependencies`, `dependents`                               | Include immediate contained members, deduplicate results                |
| `testsFor(symbol)`                                         | Direct call/reference-derived test relationships                        |
| `testPaths(symbol, { depth?, limit? })`                    | Bounded candidate tests with paths, possible dispatch and truncation    |
| `path(from, to, { depth?, maxVisited? })`                  | Directed call/dependency path and truncation flag                       |
| `impact(symbol, { depth?, limit? })`                       | Ranked reverse-use surface, routes/tests/public APIs/effects            |
| `slice(symbol, { surrounding? })`                          | Exact UTF-16 source range; live hash validation                         |
| `excerpt(symbol, { query?, line?, maxLines? })`            | Source-verified contiguous window with actual range and omission counts |
| `fileSlice({ file, startLine, endLine, surrounding? })`    | Explicit indexed file range, one-based lines                            |
| `skeleton(symbol)`, `skeletonFile(file)`                   | Persisted declarations/signatures without function bodies               |
| `architecture(scope?)`, `feature(concept)`                 | Bounded package/entry or concept/name views                             |
| `context({ task, maxTokens, options? })`                   | `{ package, text, metrics }`                                            |
| `semanticInput(symbol)`                                    | Live-hash-checked compact evidence for a separately authorized provider |
| `memory.accept(raw, input, source)`                        | Validated inferred fact; checks indexed evidence hashes                 |
| `memory.facts(symbolId?)`                                  | Separate semantic facts and provenance                                  |

`CALLED_BY` is a query direction, never stored alongside `CALLS`. Every edge has an
owner file so incremental updates can replace reversed test edges correctly.
IDs are stable under body edits and line shifts. Renaming/moving a declaration
changes its ID; overloads and anonymous duplicates use deterministic ordinals.

Context options: `format: 'json' | 'markdown'`, `scope`, `includeSource`, `weights`,
`evidenceMode: 'local' | 'assisted'`, `focus: { file, line }`, `previousContextId`,
`explain: boolean`. The focus is an indexed
repository-relative file and one-based cursor line; stale or out-of-scope focus
raises an error. `graph.focus({ file, line })` returns the smallest containing
declaration. Each context symbol includes its ID and selection reasons.

Every context package includes `contextId`. Clients retaining a prior result can
request reuse; `reuseFrom` and `reusedSymbols` describe entries omitted from a smaller
delta. Unknown receipts return full context. See the exact [receipt merge contract,
tool compatibility changes and limitations](AGENT_CONTEXT.md). Diagnostics are
opt-in and bounded. `excerpt` is a partial line window, not control-flow analysis.

Local evidence is the default and excludes cached semantic facts from context and
feature results. Assisted mode explicitly includes them without calling a model.
`feature(concept, evidenceMode?)` accepts the same selection. Configuration supplies
the library default; an explicit query option overrides it. The VS Code machine
setting takes precedence over agent-supplied options in that adapter.

`reviewChanges(maxFiles = 30)` and the `review_changes` tool examine staged/unstaged
and untracked files against HEAD. They return conservative current-file dependency
impact, candidate tests and unknown areas. They do not reconstruct the old graph,
compare contracts, cross service boundaries or execute checks. Up to 100 files,
60 declarations, 100 affected symbols and 50 tests are considered/returned, with
limit flags. Reindex first; the editor command does this before its review.

Budgets are integers from 128 to 32,000. A task whose envelope alone exceeds the
budget raises an error. The budget covers `result.text`, including headings and
metadata. Target/test reservations and multiple-choice knapsack choose
summary/signature/skeleton/source/excerpt per
symbol, then full serialization is measured again. Very small budgets can omit
required context: expansion and task validation remain the consumer's responsibility.

Source slices return at most 1,001 requested lines plus up to 30 surrounding lines.
Tool adapters enforce additional token limits and ask for a smaller slice when it
does not fit. Source text is read internally to validate its hash; only the requested
range is exposed. `skeleton`/ordinary graph queries use the last committed index;
`slice` and selected `context` source reject stale hashes. Reindex after changes.

## Configuration

Optional `.pgraph.json` at the repository root:

```json
{
  "include": ["src/**", "packages/**"],
  "exclude": ["**/*.generated.ts"],
  "limits": {
    "maxFiles": 50000,
    "maxFileBytes": 2000000,
    "maxTotalBytes": 200000000
  },
  "context": {
    "defaultTokenBudget": 2000,
    "evidenceMode": "local",
    "weights": { "name": 0.38, "proximity": 0.18 }
  },
  "semantic": { "enabled": false, "provider": "vscode-copilot" },
  "git": { "enabled": false, "maxCommits": 100 },
  "diagnostics": false
}
```

The `semantic.enabled` repository setting gates the library `graph.enrich(symbol, provider, signal?)` API. The caller supplies a provider implementation; the core never creates one from repository configuration. It cannot authorize editor transmission: the VS Code machine setting and explicit command are separate enforcing gates. Persisted semantic memory can still be queried offline using an explicit assisted query or the memory API.

Built-in exclusions always apply: `.git`, `.pgraph`, dependencies, build/cache
directories, generated directories, symlinks and recognized secret filenames.
Nested `.gitignore` rules and custom excludes apply before source includes.
Package manifests, supported text dependency lockfiles and compiler configuration are discovery metadata even when
source includes are narrower. TypeScript may read contained dependency declarations
and JSON configuration outside source includes, plus its installed standard libraries.
Supporting repository reads have a separate 50 MB cap per compiler program.

Default rank weights: name .38, path .12, signature .10, proximity .18, entry .06,
tests .06, public .03, concept .05, git .02. Scores normalize the configured weights;
exact identifiers and directly named targets receive deterministic boosts. Git
collection is opt-in and stores commit IDs/frequency/co-change paths, not authors.

Changing hashes invalidates affected semantic facts. New source files or resolution
config changes trigger broader resolution to repair formerly unresolved imports.
Queries use bounded traversal; caps can make results incomplete. Consult truncation
markers and narrow scope instead of assuming a complete program proof.

`clean` deletes only known database/WAL/SHM files. Stop open editor/MCP graph clients
before cleaning; use `rebuild` for ordinary repairs while keeping the index open.
Never treat an index downloaded from an untrusted source as a trusted cache.

## Index progress

`graph.index({ onProgress })` accepts a callback with `phase`, `message`, and optional
`completed` / `total` fields. Phases are `discover`, `analyze`, `persist` and `complete`. TypeScript analysis reports its active configuration group; mixed
root/shared and nested project configurations remain in one repository graph.
Progress events are informational and are not a resumable checkpoint protocol.

## Workspace maps and graph views

`graph.topology()` returns a committed repository communication snapshot.
`composeWorkspace([snapshot, ...])` combines explicitly selected roots with
namespaced identities and evidence-backed candidate links. `graph.relationships`
returns a bounded symbol neighborhood with directed edges and provenance. See
[the workspace graph guide](WORKSPACE_GRAPH.md) for examples and exact limits.

`workspaceImpact(projects, { project, symbol, depth? })` is a separate core export.
Each project supplies `{ project, name, graph? , error? }`; graph roots must match
their project IDs. It performs read-only static path composition across the
explicitly supplied graphs. Callers own and close these graph instances.
`packWorkspaceImpact(result, maxTokens)` from graph-tools packs complete paths and
their source identities under one response budget. See [workspace impact](WORKSPACE_IMPACT.md)
for limits, freshness, failure handling and the VS Code agent contract.
