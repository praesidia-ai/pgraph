# Explore a workspace with PGraph

Install the current VSIX, add every relevant local repository to the **same VS Code
workspace** (File → Add Folder to Workspace), then run:

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
Reindex then refresh if navigation reports stale evidence. CLI/MCP/Copilot context
tools still query one root; cross-root context packing and impact ranking are future
work.

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
