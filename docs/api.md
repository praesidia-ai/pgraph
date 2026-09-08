# API and configuration

`PGraph.open(root, { store?, counter?, requireIndex? })` is the composition root.
The root must exist. `counter` implements `{ name, count(text): number }` and must
return finite nonnegative integer token counts. `store` implements `GraphStore`.
Close graph instances when finished. Methods are synchronous; hosts must move
indexing/context work off their UI thread, as the VS Code adapter does.

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
| `path(from, to, { depth?, maxVisited? })`                  | Directed call/dependency path and truncation flag                       |
| `impact(symbol, { depth?, limit? })`                       | Ranked reverse-use surface, routes/tests/public APIs/effects            |
| `slice(symbol, { surrounding? })`                          | Exact UTF-16 source range; live hash validation                         |
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

Context options: `format: 'json' | 'markdown'`, `scope`, `includeSource`, `weights`.
Budgets are integers from 128 to 32,000. A task whose envelope alone exceeds the
budget raises an error. The budget covers `result.text`, including headings and
metadata. Multiple-choice knapsack chooses summary/signature/skeleton/source per
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
    "weights": { "name": 0.38, "proximity": 0.18 }
  },
  "semantic": { "enabled": false, "provider": "vscode-copilot" },
  "git": { "enabled": false, "maxCommits": 100 },
  "diagnostics": false
}
```

The `semantic.enabled` repository setting gates the library `graph.enrich(symbol, provider, signal?)` API. The caller supplies a provider implementation; the core never creates one from repository configuration. It cannot authorize editor transmission: the VS Code machine setting and explicit command are separate enforcing gates. Persisted semantic memory can still be queried offline.

Built-in exclusions always apply: `.git`, `.pgraph`, dependencies, build/cache
directories, generated directories, symlinks and recognized secret filenames.
Nested `.gitignore` rules and custom excludes apply before source includes.
Package manifests and compiler configuration are discovery metadata even when
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
