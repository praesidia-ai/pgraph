# PGraph architecture

PGraph is a local, graph-native context engine. The public library owns indexing,
queries, source selection and budgeting. CLI, MCP and VS Code are consumers.

## Data flow

Repository → discovery and hashes → TypeScript compiler → language-neutral graph
→ transactional SQLite → ranked symbol candidates → budgeted context → adapters.

## Decisions

- npm workspaces and TypeScript project references keep builds transparent. Each
  package has one responsibility; no task orchestrator or runtime DI container.
- `graph-ir` defines JSON-serializable nodes, typed edges, locations and provenance.
  It imports neither TypeScript nor SQLite. `graph-store` is the storage contract.
- `graph-store-sqlite` uses Node's bundled SQLite (Node >=22.18), WAL, foreign keys,
  migrations and indexed adjacency lookups. No daemon or native npm addon.
- `graph-typescript` uses the compiler checker for aliases, imports and call targets.
  Framework recognizers add explicitly labelled heuristic facts. Tree-sitter and
  SCIP can implement the parser contract later; they are not required for TS/JS.
- IDs combine language, repository-relative path and qualified lexical name.
  They survive body edits and line shifts. Renames deliberately change identity;
  anonymous and duplicate declarations require a deterministic ordinal suffix.
- Source text is read locally on demand. Graph ranges are UTF-16 offsets (the
  compiler convention) plus one-based lines. Hash checks reject stale slices.
- Index updates replace changed files and the reverse dependency closure in one
  transaction, preserving unrelated rows. The compiler may load dependency ASTs
  for accurate resolution; extraction metrics distinguish this from re-extraction.
  New files and resolution configuration changes require broader resolution.
- Query expansion is bounded by depth, result count and visited-node limits.
  Search uses indexed names and an FTS token index; the graph is not loaded wholesale.
- Context selection uses deterministic ranking and multiple representations per
  symbol. A real BPE tokenizer measures complete serialized output, including its
  envelope, with a final budget check. Consumers can inject their own tokenizer.
- Semantic memory is a separate, hash-keyed, untrusted layer with provenance,
  confidence and invalidation. Only an explicit VS Code command invokes Copilot.
  The core neither imports an AI SDK nor reads provider API keys.
- VS Code runs engine work in a separate Node process so compiler and SQLite work
  do not block the extension host. Tools share schemas and dispatch with MCP.
- MCP is stdio-only and bound to the root supplied at startup. Query tools cannot
  choose an arbitrary repository or execute programs.

## Package boundaries

`shared` → `graph-ir` → `graph-store` → `graph-store-sqlite`

`graph-typescript`, `graph-git`, `graph-semantic` → `graph-indexer`

`graph-query`, `graph-ranking` → `graph-context` → `graph-core`

`graph-core` → `graph-tools` → CLI / MCP / VS Code

`graph-benchmark` measures retrieval independently of any agent provider.

## Consistency and security

Indexing never runs repository scripts, compiler plugins, config JavaScript or
application imports. Discovery excludes symlinks, hidden caches, secrets, generated
files and dependencies. Reads enforce root containment and file-size limits.
Configuration is data, not executable code. Writers serialize through SQLite;
readers observe atomic committed snapshots. Source content and model responses are
untrusted data, never instructions. No telemetry or network activity in the engine.

## Evaluation contract

The measured quantity is repository-context tokens, not hidden Copilot tokens.
Fixture benchmarks record baseline files, lines, tokens, calls and required-symbol
recall. Recall is a retrieval check, **not proof of coding-task correctness**.
Representative medium/large real-repository paired agent trials must establish the
50% reduction / equal-correctness product KPI before that claim is made.

## Research and tradeoffs

- [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API):
  use checker-backed identity rather than same-name matching.
- [SCIP](https://github.com/sourcegraph/scip): portable symbol/occurrence ingestion is
  an adapter boundary; PGraph adds context selection, not a competing protocol.
- [Tree-sitter](https://github.com/tree-sitter/tree-sitter): incremental syntax is
  useful for future languages; TS semantic resolution justifies the compiler first.
- [Graft](https://github.com/trailhq/Graft): persistent structural context is useful;
  this implementation independently prioritizes SQLite, symbol ranges and measured
  serialized budgets, with no agent-specific hooks installed automatically.
- [SQLite in Node](https://nodejs.org/api/sqlite.html): synchronous access belongs in
  a worker/process for editor integrations; external Node avoids Electron ABI issues.
- [VS Code tools](https://code.visualstudio.com/api/extension-guides/ai/tools) and
  [language models](https://code.visualstudio.com/api/extension-guides/ai/language-model):
  supported APIs, user-initiated consent and defensive model selection.
- [MCP SDK](https://ts.sdk.modelcontextprotocol.io/server): use its stdio transport,
  lifecycle and schema validation instead of implementing JSON-RPC from scratch.

## Extension points

Additional parsers emit IR; stores implement the graph-store contract; rankers accept
weights; tokenizers implement count; semantic providers accept compact evidence;
framework enrichers consume compiler facts. Remote storage, CI artifacts, embeddings,
additional languages and team knowledge are outside the initial implementation.
