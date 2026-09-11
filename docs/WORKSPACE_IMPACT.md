# Workspace impact in the 0.6.0 preview

The useful question is: **If I change this function, which other service's code
and tests should I inspect?** A map of service arrows cannot answer that by itself.
PGraph now connects supported communication sites to indexed handlers, follows
their local code, and returns candidate paths with project and source identities.
The analysis uses no model, service requests or repository script execution.

## The gap and supporting evidence

The reported `frontier` failure exposed a scope mismatch: a folder containing
repositories was being treated as a repository with one Git HEAD. Project discovery
and separate Git error handling address that first step. The next gap was visible
in the retained 0.5.5 worker: it could draw HTTP and queue relationships, but its
local impact result stopped at the origin project. Handler identities were missing
from communication records.

Framework semantics matter here. Azure Functions v4 registers a named or inline
handler in code; the invocation context is its second argument. PGraph can link
these declarations without asking a model to guess the function. V3 and v4 cannot
be mixed in one deployed function app; static configuration found on disk does not
establish which functions are deployed. [Microsoft's v4 migration guide](https://learn.microsoft.com/en-us/azure/azure-functions/functions-node-upgrade-v4).

A Service Bus sender object is also different from a send call. PGraph records
client creation as configuration evidence and follows `sendMessages` as a potential
operation. Creating a sender alone does not establish that its enclosing function
publishes a message. [ServiceBusSender API](https://learn.microsoft.com/en-us/javascript/api/@azure/service-bus/servicebussender?view=azure-node-latest).

This is an implementation gap supported by a reproduction, not evidence that all
developers need this workflow. The [user-gap research](USER_GAP_RESEARCH.md) and
[pilot kit](USER_PILOT.md) retain the separate adoption and task-outcome questions.

## Use it as a developer

1. Install the 0.6.0 preview and run **PGraph: Index Workspace**. Extraction version
   5 is required; older indexes request an update before workspace impact.
2. Open one project, add several folders to the same VS Code workspace, or open a
   non-Git parent containing direct child repositories. **Choose Scope** still
   offers Project and Workspace. Each project keeps its own index and Git history.
3. Declare the relevant service origins, URL settings and resource mappings in
   `.pgraph.json`; see the [workspace mapping examples](WORKSPACE_GRAPH.md).
   Matching names alone do not connect services. No secrets or connection strings
   are required in these mappings.
4. Place the cursor inside a saved, indexed declaration and run **PGraph: Workspace
   Impact for Current Symbol** from the command palette, sidebar or editor menu.
5. Inspect `projects`, `paths`, `tests`, `unknown`, `omitted` and `truncated` in the
   JSON report. Each symbol carries its project ID, file, line and source hash.
   Open the corresponding source before deciding what to edit or verify.

The cursor supplies the origin project even when another project is pinned.
This explicitly named workspace command always considers all detected projects.
Ordinary **Impact Analysis** stays local to the chosen project. Neither requires
Git history; historical change review is a separate Git-based operation.

## Use it with an existing agent

The existing VS Code `pgraph_impact` tool accepts:

```json
{
  "workspace": true,
  "project": "<24-character project ID from workspace context>",
  "symbol": "<origin symbol ID>",
  "depth": 3,
  "maxTokens": 4000
}
```

`depth` is local graph depth, from 1 to 4 in workspace mode. Traversal crosses at
most two communication boundaries. The editor supplies only currently authorized
root paths; the tool cannot add filesystem roots. An unknown origin, closed project,
stale origin or invalid argument fails explicitly. Other unavailable/stale indexes
are reported beside usable project results. Queries are cancellable and respect
the editor's query timeout.

Response handles such as `s0` are local to that response. For follow-ups, use a
symbol's actual `project` and `symbol` fields:

```json
{
  "project": "<returned receiving project ID>",
  "symbol": "<returned symbol ID>",
  "maxTokens": 1000
}
```

Pass that to `pgraph_slice`, or use the file and line with `pgraph_file_slice`.
Reusing a symbol name without its project can select the wrong repository.
CLI and root-bound MCP keep local impact behavior and omit workspace routing from
their advertised schemas. The library exports `workspaceImpact` for hosts that
explicitly provide their own opened graphs.

## What the paths mean

| Evidence            | Supported behavior                                                                                                                     | What remains unknown                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| HTTP requests       | Global fetch and recognized axios calls match explicit origins/routes; Express and Azure v4 handlers link to indexed declarations      | Dynamic clients, mounted routers, runtime rewrites, middleware control flow            |
| Service Bus         | Recognized const sender `sendMessages`, receiver `subscribe` handlers and Azure v4 triggers match explicit resource/channel identities | Runtime filters, delivery, imported sender instances, arbitrary factory chains         |
| Secondary output    | Recognized `extraOutputs.set` on a registered or typed Azure invocation context links a known output binding                           | Whether the binding is enabled in the actual deployed function and runtime delivery    |
| Event Grid          | Recognized publisher `send` and v4 event handlers can connect through explicit resource mappings                                       | Event-type filtering, payload contracts and deployed subscriptions                     |
| Local relationships | Calls, incoming references, declared types and possible interface dispatch connect a focused declaration to a boundary                 | General value flow, runtime dispatch, arbitrary callbacks and exhaustive caller recall |
| Tests               | Bounded static paths identify candidate test declarations                                                                              | Tests are not executed; coverage and sufficient verification are not established       |

The engine keeps upstream dependencies separate from downstream callees. A shared
helper does not cause a downstream walk to include all its unrelated callers.
Reverse queue paths identify producers worth reviewing; they do not imply a return
channel. Ambiguous destinations remain separate candidates. Configuration-only
records and unresolved handlers cannot invent an execution path.

Per-project freshness, revisions, input fingerprints and used source hashes are
checked. Projects are observed sequentially, so the workspace is not an atomic
snapshot. A source change during a read can require a retry. Changed project
snapshots are excluded from returned paths; a changed origin aborts the request.

Work is bounded: at most 64 roots, 24 traversal frontiers, 24 returned paths,
80 local nodes per traversal, 60 neighbors per expansion, six remote leaves per
frontier and two communication boundaries. Test discovery has separate bounds.
Topology extraction/composition limits also apply. The response indicates
truncation; no path never proves no impact.

## Budget behavior and reproduction

The serialized JSON uses one `cl100k_base` budget including project metadata,
failures, warnings, hashes, paths and tests. Packing keeps complete paths and removes
unused symbol handles. Omitted path/test counts remain visible. If mandatory
metadata cannot fit, the response requests a larger budget or fewer projects.
It does not hide failed projects to fit more source.

The [paired worker probe](../benchmarks/reports/v060-workspace-impact.json) uses
identical authored sources with the retained 0.5.5 VSIX and the current worker.
The baseline finds two service arrows but no handler execution identities; local
impact remains in the originating project. The current response connects
`submit → pay → archive → persist` across HTTP and Service Bus and includes one
candidate test. A stale receiver and an unindexed project stay explicit while a
healthy intermediate handler remains available. The unindexed folder is not written.

In that recorded run, the complete response uses 1,710 tokens. A 1,000-token budget
returns one path in 843 tokens and reports one path and one test omitted. A
128-token budget requests more room for metadata. These are response-size checks,
not complete-agent-task or billing savings. Different output semantics also mean
the recorded query times are not a speedup comparison.

```sh
node benchmarks/probes/workspace-impact.mjs /tmp/pgraph-workspace-impact.json
```

The script uses temporary fixtures, reads the retained artifact, records the exact
new worker hash and defaults to a temporary output path. Unit fixtures additionally
cover imported/inline handlers, both path directions, Event Grid, secondary output
writes, ambiguity, shadowed environment settings, opaque callbacks, single-root
communication, source identities, extraction upgrades and output budgets.

Full v2 still needs representative cross-service tasks, payload compatibility,
actual required-check outcomes, performance on the intended workspace, and evidence
of voluntary repeated use. See the [delivery gates](V2_DELIVERY.md).

Validation on macOS arm64 / Node 22.22.0: the full suite passed 100 tests across 17
files; the final cursor correction also passed all 14 targeted workspace/context
tests. Typechecking and lint passed. The real isolated VS Code host passed agent
and native workspace impact, receiving-project source reads, stale-service
isolation, strict arguments, both workspace layouts and existing Git/check/recovery
workflows. Cross-platform release validation remains open.
