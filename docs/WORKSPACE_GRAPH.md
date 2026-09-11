# Explore a workspace with PGraph

The 0.5.0 preview supports one project, multiple open project folders, and a parent
folder containing separate Git repositories. For example, opening `frontier/`
discovers its direct child repositories; `frontier/` itself does not need a Git
history. A folder with its own `.git` remains one project, including a monorepo.

Install `pgraph-0.6.0.vsix`, open a trusted folder or add project folders to the
**same VS Code workspace** (File → Add Folder to Workspace), then run:

1. **PGraph: Index Workspace** — updates each repository's `.pgraph/graph.db`.
2. **PGraph: Explore Relationships** — opens the interactive service map.
3. Select a service and **Explore service** to search its symbols. Select a symbol
   and **Expand neighborhood** to inspect incoming/outgoing relationships. Use
   direction, depth, relationship filters, zoom, pan and Fit to narrow the view.
4. Select an arrow to inspect its extractor, evidence category, confidence, source
   locations and hashes. Open either endpoint's source from the evidence panel.

The node and relationship lists support keyboard navigation alongside the canvas.
The renderer is bundled Cytoscape.js; it makes no network requests. This release
indexes folders in the current window's workspace, not folders open in other windows.

## Project and Workspace scopes

The 0.6.0 **Workspace Impact for Current Symbol** command connects supported
HTTP/Azure operations to indexed handlers and candidate tests across these roots.
It uses the source cursor as the origin and one total response budget. Ordinary
**Impact Analysis** remains local. See [workspace impact](WORKSPACE_IMPACT.md) for
setup, agent arguments, static evidence, unknowns and limits.

**PGraph: Choose Scope** offers the whole workspace or a specific detected project.
The status bar, sidebar and Daily Workflow picker display the selected scope.
One detected project defaults to Project; multiple projects default to Workspace.
An explicit choice is saved with the workspace. A pinned project remains selected
when another project's editor gains focus.

In Workspace scope, the daily source-text, stack-trace, freshness, cycle,
changed-declaration, historical-impact, staged/branch, test-gap, available-check and recorded-check
reports query each detected project and group evidence by project. Errors appear
beside the affected project, so one missing index, initial commit or branch reference
does not discard successful results elsewhere. Queries show progress and can be
cancelled. Branch mode uses the explicitly supplied base independently in each repo.

**Review Historical Impact** in 0.5.4 reconstructs the selected Git baseline for
each project, including old consumers of removed declarations. Staged and committed
after snapshots can differ from working source. See [snapshot semantics and
limits](HISTORICAL_IMPACT.md); grouped historical reports do not prove cross-service
compatibility and use a separate output budget per project.
In 0.5.5, **Continue Historical Review** lists projects with pending declaration
pages and queries the chosen project's captured comparison. It preserves that
project's review identity and rejects changed inputs. [Paging limits](HISTORICAL_REVIEW_PAGING.md)
remain independent of the cross-service impact gate.

**Run Repository Check** offers scripts labeled by project and executes only the
one deliberately selected. Saved investigations can be resumed across detected
projects in Workspace scope. File and cursor actions resolve the project owning
the source. In 0.5.1, **Find Relevant Context** and the `pgraph_context` agent tool
retrieve across detected projects in Workspace scope. Other agent queries need a
returned `project` ID or a pinned Project scope. Follow-up source reads therefore
keep their repository identity even when another editor gains focus.

**Review My Changes** refreshes all detected projects in Workspace scope and opens
the grouped changed-declaration report. In Project scope it retains the conservative
file-level review. **Index Repository** always targets one project; **Index
Workspace** always indexes all detected projects, even when a project is pinned.
Each project has its own `.pgraph` index, source paths and Git baseline.

Run **PGraph: Refresh Workspace Projects** after adding or removing child
repositories on disk. Discovery checks direct child folders of a non-Git parent;
it does not recurse arbitrarily or follow child directory symlinks. It checks at
most 256 child directories per open folder and retains at most 64 projects.
Limits and unreadable folders are reported by Refresh Workspace Projects and the
workspace reports. Deeper repositories can be added as open workspace folders.
When child repositories are discovered, loose files beside them are not a project;
open their containing folder separately if they need indexing.

A plain source folder remains usable for supported TS/JS indexing and search.
Git review requires a Git working tree with a resolvable initial commit. PGraph
now distinguishes a non-Git folder from unavailable HEAD and gives a recovery
message rather than displaying the raw failed command. It does not create a Git
repository, make a commit or rewrite a parent's existing index to resolve this.

Validation includes unit tests for container discovery, monorepo preservation,
worktree markers, duplicates, symlinks and limits, plus an isolated real VS Code
workspace with ordinary roots and a parent containing two child repositories.
The host test checks separate indexes, grouped source matches, partial Git errors,
child-source navigation/bookmarks and project pinning. It does not measure scale
or full semantic impact across real services.

## Declare service identities without secrets

A repository can contain one service or many. By default PGraph creates a repository
service plus groups for nested Azure `host.json` directories. Package/tsconfig files
are compiler boundaries; they do not establish deployment identities. Override
service boundaries and add endpoint mappings in each repository's `.pgraph.json`.
Reindex after changing the configuration.

Example for the order service repository:

```json
{
  "topology": {
    "services": [
      {
        "name": "orders",
        "path": ".",
        "urls": {
          "BILLING_URL": "https://billing.internal"
        },
        "resources": {
          "SERVICE_BUS_CONNECTION": "company-orders-bus"
        }
      }
    ]
  }
}
```

Example for a billing service inside another repository:

```json
{
  "topology": {
    "services": [
      {
        "name": "billing",
        "path": "functions/billing",
        "origins": ["https://billing.internal"],
        "resources": {
          "BILLING_BUS_CONNECTION": "company-orders-bus"
        }
      }
    ]
  }
}
```

Paths are repository-relative directories, with `.` for the whole repository.
When paths overlap, the deepest service owns the evidence. Service paths must be
unique within a repository. Equal names across repositories remain distinct.

`urls` maps environment-variable **names** to non-secret HTTP base URLs; `origins`
declares where the receiving service is addressed. Prefix paths in origins represent
an additional deployment prefix. For Azure HTTP functions the default `/api` prefix
is already applied from the nearest `host.json`; do not repeat it in origins unless
there is a separate deployment prefix.

`resources` maps connection-setting **names** to a shared logical namespace/account
identity. Producer and consumer can use different setting names, provided their
mapped identity is the same. A literal Service Bus namespace must be mapped using
that same namespace string on the other side. For an Event Grid trigger without a
connection setting, use the resource key `event-grid`; map it to the same topic
identity used by its publisher. These values are identifiers, never connection
strings, tokens or passwords. PGraph does not read `.env` or `local.settings.json`.

## What can establish a connection

- HTTP: global `fetch`, supported axios calls, imported Express app route declarations,
  Azure Functions v4 `app.http`, and v3 `function.json` HTTP triggers. A connection
  requires a mapped origin, compatible method and route. Simple `:id` / `{id}` path
  parameters are supported. Literal URL query strings and credentials are omitted
  from communication evidence. Environment-based template URLs support one leading
  environment-variable substitution plus a literal path.
- Messaging: Azure Service Bus client sender/receiver declarations, Azure Functions
  Service Bus and storage queue trigger/output declarations, and v3 binding files.
  A connection requires a channel name and the same declared namespace/account.
  Explicit queue/topic kinds must agree. A sender declaration is evidence of an
  intended producer, not proof that a message was sent.
- Event Grid: SDK publisher `send` calls and Azure trigger/output declarations,
  matched using explicit topic identities. Event type and subscription-filter
  routing are not analyzed, so matches remain candidates.
- Both ES module imports and top-level CommonJS `require` bindings are recognized.
  Shadowed APIs are excluded. Unknown expressions remain unresolved.

Cross-service edges are **inferred from declarations**, with heuristic confidence
scores, not measured probabilities or runtime traces. Multiple compatible targets
are labeled ambiguous. Unresolved outgoing declarations appear as separate nodes.
The symbol explorer retains compiler/heuristic/semantic provenance from the index.

Mounted Express routers, dynamic request options, wrappers, constrained/optional
route parameters, deployment rewrites, runtime subscriptions, Durable Functions
orchestrations and shared database topology need further recognizers. The service
map is not a complete runtime dependency inventory. No URL is followed and no
repository code is executed to discover communications.

## Scale and freshness

Per-root indexes remain persistent and independent. The workspace layer is composed
on request from committed snapshots and namespaced root/symbol identities; no merged
index or daemon is created. Removed or failed roots are reported, and a subsequent
refresh rebuilds the workspace layer from the current roots.

The map accepts up to 64 roots, 150 service groups, 200 displayed nodes and 800 edges.
Extraction retains up to 200 communication declarations per file and 2,000 per root;
matching stops at 500,000 candidate comparisons. File-node scans stop at 100,000.
The symbol view supports depth 0–4, at most 200 nodes and 800 edges. Limit exhaustion
sets an explicit partial-view flag; a depth-limited neighborhood is intentional.

The panel warns after edits or workspace-folder changes. Source navigation validates
that the symbol belongs to the current displayed graph, its repository remains open,
the index revision matches, and the source file still matches its indexed hash.
Reindex then refresh if navigation reports stale evidence. CLI and MCP servers
remain bound to one configured root. Cross-service impact ranking remains future work.

## Workspace context for developers and agents

The 0.5.1 editor context response contains project IDs, names, index revisions,
observation times, source hashes and selected symbols. Duplicate names and relative
paths in different projects remain distinct. Sources are checked against their
indexed hash when retrieved. Projects are queried sequentially; this is not an
atomic snapshot, so edits after retrieval still require reindexing and fresh reads.

An agent can start with:

```json
{
  "task": "Investigate submitOrder failures",
  "format": "json",
  "maxTokens": 4000
}
```

Then call `pgraph_excerpt`, `pgraph_file_slice`, `pgraph_impact` or another existing
tool with **both** the returned `project` ID and the relevant symbol/file arguments.
Project IDs are local to the canonical repository path. Closed or unknown projects
are rejected; passing an arbitrary root path is unsupported. A standalone MCP
server does not expose the editor's `project` field and never opens another repository.

The final JSON or Markdown result, including metadata and errors, is counted with
`cl100k_base` against one `maxTokens` budget. The agent adapter also checks its host
model's token count when available. If even the project inventory cannot fit, the
result requests a larger budget or a narrower Project scope. The editor command
uses a ceiling of 2,000 tokens or 500 per project, whichever is larger (at most
32,000). A tool request keeps the caller's explicit ceiling.

Each worker retrieves at most 2,000 tokens of local candidate context. Packing
visits local ranks in project order and considers at most 256 candidates. Scores
from separate repositories are not treated as comparable. Whole symbol entries
are retained or omitted; source text is never silently cut. `omittedSymbols`
counts candidates dropped during workspace packing, not all unselected repository
symbols. Project errors, local warnings and discovery limits remain visible.

This is bounded project retrieval, not a proof of cross-service dependency or
complete task recall. Workspace responses have no reusable receipt; `focus` and
`previousContextId` require an explicit `project` or a pinned Project scope.
Cursor commands still use the actual source project. No model is called, and the
machine's Local/Assisted evidence setting still takes precedence over agent input.

## Library API

```ts
import { PGraph, composeWorkspace } from "@praesidia/pgraph-core";

const orders = PGraph.open("/work/orders", {
  requireIndex: true,
  readOnly: true,
});
const billing = PGraph.open("/work/billing", {
  requireIndex: true,
  readOnly: true,
});
try {
  const workspaceMap = composeWorkspace([
    orders.topology(),
    billing.topology(),
  ]);
  const neighborhood = orders.relationships({
    symbol: orders.symbol("submitOrder").id,
    direction: "both",
    depth: 2,
    maxNodes: 100,
    maxEdges: 400,
  });
} finally {
  orders.close();
  billing.close();
}
```

`composeWorkspace` is provider-independent and performs no filesystem discovery or
network access. Callers choose and authorize the roots. Its result includes bounded
nodes/edges, per-root revisions, provenance, source hashes, warnings and truncation.

## Verification

Run `npm run check` and `npm run test:extension` after building. The browser test
uses the real bundled renderer and HTML against generated indexed services:

```sh
npx playwright install chromium
npm run test:explorer
```

Alternatively set `PGRAPH_BROWSER_PATH` to an installed Chrome/Chromium executable.
The test uses an isolated browser profile, exercises graph controls and hostile
labels, and writes `artifacts/pgraph-v2-preview.png`. It does not contact the example
service URLs or change the developer's browser profile.
