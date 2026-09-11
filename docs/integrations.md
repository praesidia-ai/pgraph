# Editor and agent integrations

## VS Code

Run `npm ci --ignore-scripts && npm run build && npm run package:extension`, then
install `artifacts/pgraph-0.6.0.vsix`. Node 22.18+ is required independently of
VS Code's bundled Electron runtime. Set `pgraph.nodePath` in user/machine settings
if necessary. **PGraph: Index Workspace** indexes all detected projects in
sequence, reports success/failure per folder and releases idle workers between
folders. Repeated invocations share the active workspace run. Each root owns its
`.pgraph` database and index revision. Removing a folder stops its worker.

The 0.5.1 preview detects direct child Git repositories in non-Git parent folders.
**Choose Scope** selects grouped daily Workspace queries or pins one Project.
In Workspace scope, editor/agent context combines bounded per-project evidence
under one output budget. Other agent tools require a returned `project` ID or a
pinned project; single-project editor commands retain source/pin selection.
Context receipts remain per-root. **PGraph: Explore Relationships** adds a separate cross-service
map and bounded symbol browser; see [the workspace guide](WORKSPACE_GRAPH.md).
Virtual/untrusted workspaces are disabled.

The 0.6.0 **Workspace Impact for Current Symbol** command and the existing agent
`impact` tool (`workspace: true` plus an origin `project`) connect supported
HTTP/Azure sites to handlers and candidate tests across open roots. See the
[workspace impact contract](WORKSPACE_IMPACT.md). Root-bound CLI/MCP remain local.

The 0.2.0 preview adds **Context for Current Symbol** (also in the source editor
context menu) and **Review My Changes**. Cursor context validates the saved source
and anchors retrieval to its indexed declaration. Change review reindexes the
selected root, then lists conservative affected code and candidate tests for Git
changes against HEAD. It does not run tests or reconstruct deleted-symbol history.

The 0.5.4 **Review Historical Impact** command adds a separate before/after Git
analysis with removed-symbol consumers, declared signature changes and candidate
test paths. The existing `workflow` tool exposes `action: "change_impact"` in both
MCP profiles and VS Code. [Snapshot selection and limits](HISTORICAL_IMPACT.md)
explain staged/working differences, budgets and explicit unknowns.
In 0.5.5, `page.nextOffset` and `page.reviewId` support continuation through the same
tool. Pass them as `offset` and `reviewId` with unchanged comparison options; the
editor exposes **Continue Historical Review**. See [paging rules](HISTORICAL_REVIEW_PAGING.md).

`pgraph.evidenceMode` defaults to `local` and excludes cached AI facts from context
and feature queries. Choose `assisted` to include existing inferred evidence. This
machine setting overrides tool arguments; neither mode makes a model call.

Commands cover initialize, index, changed-file indexing, architecture, symbol,
callers, callees, impact, context, semantic index, token savings and graph status.
The sidebar shows the selected repository's stored health and counts, task/context
entry points and recent workspace indexing results. Progress reports discovery,
per-tsconfig analysis, persistence and commit completion; timestamped messages are
available in the PGraph output channel.
The sidebar opens the relationship webview, with a locally bundled renderer,
nonce-based script policy, bounded graph results and validated source navigation.

An existing index is incrementally updated after supported source/JSON and text lockfile events
when `pgraph.autoIndex` is enabled. `.gitignore` changes currently require the
Reindex Changed Files command. Requests run in a separate Node process and terminate
on cancellation or an execution timeout. Indexing defaults to 900 seconds
(`pgraph.indexTimeoutSeconds`); queries default to 120 seconds
(`pgraph.queryTimeoutSeconds`). Requests execute in order, so a queued query does
not time out while waiting for indexing. Cancelling a queued request does not stop
the active index. SQLite transactions protect committed data
if the process stops. A subsequent request restarts the engine.

Copilot tools share dispatch and schemas with MCP. Tool availability in the agent
picker depends on VS Code, Copilot permissions and organization policy. The extension
encourages context-first use through descriptions; it cannot force an agent's choice.
The host may prompt according to its tool-approval policies. No instruction files or
agent hooks are installed by PGraph.

## Optional semantic enrichment

The 0.4.0 [daily workflow](DAILY_WORKFLOWS.md) adds readable investigation reports,
saved task anchors and deliberate VS Code check execution. `workflow` is the one
additional read-only agent tool. Its nine evidence actions never execute scripts;
the editor check runner is a separate, explicit user command.

1. Enable `pgraph.semanticEnabled` in **user settings**.
2. Run **PGraph: Build Semantic Index**; enter a symbol such as `AuthService`.
3. Choose an available model from VS Code's `vendor: 'copilot'` list. VS Code handles
   provider consent; PGraph has no external-provider key fields.
4. A bounded skeleton and known relationships go to the model. The response must
   contain a summary, concepts, constraints and confidence. It is validated, stored
   separately and invalidated with the underlying files/dependencies.

Skeletons are source-derived and can contain identifiers, literals and type text;
they are not a secret-redaction format. Source/model text remains untrusted.
The prompt requests domain responsibility only, with no tool access. No parser can
guarantee that model text is semantically correct or immune to prompt injection.
Consumers must not treat inferred constraints as policy or executable instructions.

The real extension-host test exercises `vscode.lm.invokeTool` without a paid account.
Sending a live Copilot model request requires your account/consent and is a separate
manual integration check; the automated suite does not pretend to provide it.

## MCP

`node packages/graph-mcp/dist/main.js /absolute/repository` starts a stdio server.
Index the repository first. No TCP listener or remote authentication is implemented.
All tools are bound to the startup root; schemas reject root overrides and unknown
parameters. MCP exposes no indexing, cleanup, process execution or enrichment tool.
Query-only CLI and MCP adapters open SQLite read-only and never run schema migrations.
The process is not an OS sandbox.

For a smaller discovery surface, start the source-built MCP server with
`--tool-profile essential`. It exposes only `workflow`, `context`, `search`,
`excerpt`, `file_slice` and `impact`. Omit the option or use `--tool-profile full`
for the complete existing tool set. Profile selection happens at startup;
unavailable tools are not registered and calls to them fail. Both profiles use
the same bounded dispatcher and strict schemas, including rejection of unknown
arguments. Use `search` to find symbol IDs and `file_slice` for source beyond a
partial excerpt. Dedicated caller/test-path queries require the full profile.

The [actual stdio probe](../benchmarks/reports/tool-profiles.json) measured 3,563
versus 1,421 BPE tokens for the tools/list arrays: 60.1% fewer schema payload tokens,
with identical results for the three shared queries tested. Server instructions
cost 64 versus 100 tokens separately. This is not a billing or whole-task saving.
Run `node benchmarks/probes/tool-profiles.mjs` after building to reproduce it.

For VS Code's native extension tools, use the optional
[user tool-set example](../examples/integrations/pgraph-essential.toolsets.jsonc)
through [Chat: Configure Tool Sets](https://code.visualstudio.com/docs/agent-customization/tool-sets).
Select the group and deselect the other PGraph tools; a tool set alone does not
filter all enabled tools. This example does not modify settings automatically.
Host selection and billing behavior need live-user validation.

Tools: workflow, context, symbol, search, callers, callees, references, implementations,
dependencies, dependents, impact, tests, slice, excerpt, file_slice, skeleton, path,
architecture, feature and status. Editor names have the `pgraph_` prefix.
The preview also provides `review_changes`, a bounded read-only Git/change-impact
query. Its file-level result identifies unsupported/deleted/stale areas explicitly.

In 0.3.0, `tests` returns a structured target/test-path result instead of a flat
array. `excerpt` returns a bounded partial source window with a hash and omission
counts. `context` accepts `explain` and `previousContextId`; receipts only help when
the caller still retains the referenced context. See [the merge contract and
agent workflow](AGENT_CONTEXT.md) before implementing a receipt-aware client.

## First-use troubleshooting

| Symptom                    | Resolution                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spawn node ENOENT`        | On the affected computer, run `node -p "process.execPath"` in Terminal. Paste its full output into PGraph: Node Path in user settings and retry. |
| `node:sqlite` unavailable  | Use Node 22.18+; configure editor `nodePath`                                                                                                     |
| No graph index             | Run `pgraph index --root /repository`                                                                                                            |
| Ambiguous symbol           | Use an ID returned by `search`                                                                                                                   |
| Stale source               | Run `index --changed` / editor Reindex Changed Files                                                                                             |
| Few or no callers          | Check tsconfig aliases, ignored files and unresolved/dynamic dependencies                                                                        |
| Copilot models unavailable | Check account, org policy and VS Code provider authorization                                                                                     |
| Budget envelope too large  | Shorten the task or increase the budget                                                                                                          |
| Worker timeout             | Narrow repository include patterns or use CLI indexing before opening the editor                                                                 |

Supported API references: [VS Code tools](https://code.visualstudio.com/api/extension-guides/ai/tools),
[Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model),
[MCP SDK stdio](https://ts.sdk.modelcontextprotocol.io/server).
