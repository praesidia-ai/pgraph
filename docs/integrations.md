# Editor and agent integrations

## VS Code

Run `npm ci --ignore-scripts && npm run build && npm run package:extension`, then
install `artifacts/pgraph-0.1.0.vsix`. Node 22.18+ is required independently of
VS Code's bundled Electron runtime. Set `pgraph.nodePath` in user/machine settings
if necessary. Multi-root workspaces select the active editor's folder or ask the
user to pick a repository. Virtual/untrusted workspaces are disabled.

Commands cover initialize, index, changed-file indexing, architecture, symbol,
callers, callees, impact, context, semantic index, token savings and graph status.
The sidebar shows stored health, counts, task/context entry points and recent work.
It is an overview/navigation view, not an interactive graph visualization.

An existing index is incrementally updated after supported source/JSON file events
when `pgraph.autoIndex` is enabled. `.gitignore` changes currently require the
Reindex Changed Files command. Requests run in a separate Node process and terminate
on cancellation or a 120-second timeout. SQLite transactions protect committed data
if the process stops. A subsequent request restarts the engine.

Copilot tools share dispatch and schemas with MCP. Tool availability in the agent
picker depends on VS Code, Copilot permissions and organization policy. The extension
encourages context-first use through descriptions; it cannot force an agent's choice.
The host may prompt according to its tool-approval policies. No instruction files or
agent hooks are installed by PGraph.

## Optional semantic enrichment

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

Tools: context, symbol, search, callers, callees, references, implementations,
dependencies, dependents, impact, tests, slice, file_slice, skeleton, path,
architecture, feature and status. Editor names have the `pgraph_` prefix.

## First-use troubleshooting

| Symptom                    | Resolution                                                                       |
| -------------------------- | -------------------------------------------------------------------------------- |
| `node:sqlite` unavailable  | Use Node 22.18+; configure editor `nodePath`                                     |
| No graph index             | Run `pgraph index --root /repository`                                         |
| Ambiguous symbol           | Use an ID returned by `search`                                                   |
| Stale source               | Run `index --changed` / editor Reindex Changed Files                             |
| Few or no callers          | Check tsconfig aliases, ignored files and unresolved/dynamic dependencies        |
| Copilot models unavailable | Check account, org policy and VS Code provider authorization                     |
| Budget envelope too large  | Shorten the task or increase the budget                                          |
| Worker timeout             | Narrow repository include patterns or use CLI indexing before opening the editor |

Supported API references: [VS Code tools](https://code.visualstudio.com/api/extension-guides/ai/tools),
[Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model),
[MCP SDK stdio](https://ts.sdk.modelcontextprotocol.io/server).
