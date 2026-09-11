# Task selection: evidence for the 0.5.3 preview

Updated 2026-09-10. Developers and agents lose time when search returns wrappers,
shared utilities or declarations while omitting the implementation needed for the
task. More indexed symbols and a larger context window do not establish that this
problem is solved. This investigation isolates selection on one frozen graph.

## What failed

The 0.5.2 diagnostic selected 5 of 15 required symbol targets in ten known
self-repository searches. A local diagnostic hook identified the actual losses:
nine missing targets failed the shortlist and one failed representation allocation.
The instrumented baseline produced byte-identical ordinary context responses to
the saved, uninstrumented engine for all ten requests.

Three mechanisms contributed to noise:

- Search limited results before excluding files and local variables. Eligible
  implementations could therefore be absent from the candidate window.
- Ranking retained the strongest individual term score without crediting coverage
  of multiple task terms. Its substring comparison also disagreed with the text
  index on English inflections such as `parsing` and `parse`.
- Traversal could move from a relevant caller to a shared helper and then into
  unrelated callers. Repeated test expansion could promote distant tests as highly
  as direct ones. Graph support also created large groups of tied scores.

The text index already uses SQLite's Porter tokenizer and weighted BM25. The
[SQLite FTS5 documentation](https://www.sqlite.org/fts5.html) explains those features.
The [Porter stemmer implementation](https://github.com/words/stemmer) now supplies
English word normalization in ranking too. This is lexical matching, not semantic
understanding, runtime analysis or a model call.

## Changes

The 0.5.3 selector filters declaration kinds inside the search query before its
result limit. It credits coverage across bounded term searches and prioritizes that
coverage when admitting candidates. Ranking compares identifier words and English
stems instead of arbitrary substrings; literal names retain a stronger bonus than
inflections. Exact symbol resolution and graph identities are unchanged.

Graph traversal preserves its direction through calls, avoiding connections inferred
merely because two features use the same helper. Type/reference edges can provide
local context but do not recursively expose every consumer. A declared `IMPLEMENTS`
edge may bridge a call to a possible implementation; this does not resolve its
runtime receiver. Lexical relevance breaks graph-score ties. Candidate tests come
from bounded static paths to the top seeds, with longer paths receiving less weight.

A library-only `ContextEngine` observer reports candidate rank, rejection stage and
representation costs. It bypasses cached selection to reconstruct the trace, but
retains source freshness checks. It is not a tool argument and adds nothing to an
ordinary agent response. The existing optional, budgeted `explain` field also uses
more precise omission reasons.

These changes apply to project retrieval and the independent project retrieval
used by Workspace context. They require no AI account, embeddings, remote service
or query-time model call. They do not create cross-project call edges.

## Controlled comparison

The [paired report](../benchmarks/reports/v053-selection-quality.json) compares saved
0.5.2 and current library engines against the same SQLite graph and 107 verified
source files. Both use the same requests, token budgets, source-query implementation
and `cl100k_base` tokenizer. Corpus and engine fingerprints are recorded. This
controls the earlier problem where changing PGraph's engine also changed the
self-repository corpus used to evaluate it.

| Known self-repository diagnostic               | Saved 0.5.2 |  0.5.3 |
| ---------------------------------------------- | ----------: | -----: |
| Required targets selected                      |        5/15 |   9/15 |
| Searches selecting all required targets        |        3/10 |   6/10 |
| Required targets supplied as source or excerpt |        2/15 |   3/15 |
| Total output tokens across ten requests        |      15,797 | 15,577 |

The added targets are `GraphQuery.slice`, `optimizeBudget`, `TypeScriptAdapter.parse`
and `SqliteGraphStore.neighbors`. Only the last is newly supplied as implementation
source; the other additions are summaries or signatures. Finding a target is not
the same as supplying enough evidence to complete its task.

Six targets still fail the shortlist: the three indexing-flow targets, repository
opening, a file-slice freshness target and another slice target in a test search.
The inherited test-search oracle itself warrants independent review because it
requires implementation methods rather than actual test declarations.

Five additional sample-app cases were authored after implementation and before their
first comparison: session expiry, revoking a user's sessions, malformed password
hashes, failure-count expiry and normalized email lookup. Both versions selected
all five targets as source. Their output totals were 5,928 and 5,940 tokens. These
are small authored controls, not independent developer tasks or a held-out benchmark.

The known ten requests guided development, including exploratory ranking variants.
No relevance labeling of every returned symbol, paid-agent run, task completion,
retention result or company-repository generalization is established. The small
output-token difference is not a whole-task savings claim. Single-run latency in
the report is descriptive; it is not a performance comparison.

## Validation and reproduction

81 tests across 15 files passed, alongside typechecking and lint. Five new tests
cover variable-heavy retrieval, unrelated consumers of a shared helper, declared
interface bridges, diagnostic parity/freshness/scope, and English inflection handling
without changing exact symbol identity. Existing workspace and budget checks passed.
The real isolated VS Code host passed natural-language implementation retrieval
through the bundled worker alongside single-project and multi-project workflows,
Git failure isolation, project-specific reads and the existing editor checks.

For future controlled changes, build the baseline, freeze it **before editing**,
then rebuild and compare:

```sh
node benchmarks/probes/selection-quality.mjs freeze /tmp/pgraph-selection-snapshot
# Implement and build the candidate engine.
node benchmarks/probes/selection-quality.mjs compare /tmp/pgraph-selection-snapshot /tmp/selection-quality.json
```

The probe refuses a changed frozen source file, graph, baseline engine or shared
GraphQuery implementation. It measures library selection rather than extraction,
editor IPC, tool discovery or model consumption. Local snapshot evidence is kept
with development artifacts; the report alone is not a replacement for that corpus.

The next acceptance work is to obtain independently specified developer tasks,
label useful and irrelevant evidence, measure required implementation recall and
compare task outcomes. The existing [pilot kit](USER_PILOT.md) specifies recruitment
and activation/retention criteria. Those gates remain open.
