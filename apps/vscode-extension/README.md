# PGraph by Praesidia for VS Code

Persistent local repository intelligence for coding agents. Index TypeScript and
JavaScript, then retrieve symbols, callers, dependencies, tests and selected source
ranges under an explicit token budget. No external model key or cloud database is
required for the deterministic engine.

## Start

1. Install Node.js 22.18 or newer (24 LTS recommended).
2. Open a trusted repository and run **PGraph: Index Repository**.
3. Open the PGraph sidebar, or enable PGraph tools in Copilot Agent Mode.
4. Use `#pgraph_context` with a task such as "Add rate limiting to login".

Set `pgraph.nodePath` in user settings if the required Node executable is not on
PATH. Source analysis runs in a separate process. The local `.pgraph` directory
contains source-derived metadata; add it to your repository's ignore rules.

Commands include Find Symbol, Find Callers, Find Callees, Impact Analysis, Find
Relevant Context, Show Architecture, Graph Status, Show Token Savings and Reindex
Changed Files. Existing indexes update after source saves by default.

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
