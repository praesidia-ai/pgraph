# PGraph by Praesidia for VS Code

Persistent local repository intelligence for coding agents. Index TypeScript and
JavaScript, then retrieve symbols, callers, dependencies, tests and selected source
ranges under an explicit token budget. No external model key or cloud database is
required for the deterministic engine.

## Start

1. Install Node.js 22.18 or newer (24 LTS recommended).
2. Open a trusted repository and run **PGraph: Index Repository**, or add multiple
   service folders to a workspace and run **PGraph: Index Workspace**.
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
Context tools still target one selected folder. **Explore Relationships** composes
cross-service communication candidates across the workspace indexes.

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

This is a 0.1 pre-release. The real extension-host workflow is automated; live
model authorization and correctness on representative company tasks must be
validated in your environment before production rollout.

MIT licensed. The underlying PGraph core also exposes CLI and MCP adapters.

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
