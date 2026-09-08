import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type {
  ExplorerGraph,
  RelationshipOptions,
} from "@praesidia/pgraph-core";

export interface ExplorerHost {
  workspace(): Promise<ExplorerGraph>;
  relationships(
    rootId: string,
    options: RelationshipOptions,
  ): Promise<ExplorerGraph>;
  open(
    rootId: string,
    symbol: string,
    revision: number,
    line?: number,
  ): Promise<void>;
}
export function explorerHTML(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const nonce = randomBytes(18).toString("base64");
  const script = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist/explorer.js"),
  );
  const css = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media/explorer.css"),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <link rel="stylesheet" href="${css}"><title>PGraph relationships</title></head><body>
  <header><div><span class="eyebrow">PRAESIDIA / PGRAPH</span><h1>Explore relationships</h1></div><button id="workspace">Service map</button><button id="refresh">Refresh view</button></header>
  <section class="toolbar" aria-label="Graph controls"><form id="search-form"><input id="search" aria-label="Search symbols" placeholder="Find a symbol in the selected service…" maxlength="500"><button>Search</button></form>
  <label>Direction <select id="direction" aria-label="Direction"><option value="both">Both</option><option value="out">Outgoing</option><option value="in">Incoming</option></select></label>
  <label>Depth <select id="depth" aria-label="Depth"><option>1</option><option>2</option><option>3</option><option>4</option></select></label>
  <label>Links <select id="filter" aria-label="Relationship filter"><option value="">All relationships</option><option value="CALLS">Calls</option><option value="IMPORTS">Imports</option><option value="DEPENDS_ON">Dependencies</option><option value="http">HTTP</option><option value="service-bus">Service Bus</option><option value="storage-queue">Storage queue</option><option value="event-grid">Event Grid</option></select></label><button id="fit">Fit</button></section>
  <p id="status" role="status" aria-live="polite">Loading workspace indexes…</p>
  <main><section class="canvas-wrap"><div id="graph" aria-label="Relationship graph; use the adjacent list for keyboard navigation"></div><div class="legend"><span>● Service / symbol</span><span class="unknown">◌ Unresolved target</span><span>→ Directed relationship</span></div><div id="empty" hidden>No relationships in this view. Index the workspace, or choose another symbol.</div></section>
  <aside><h2 id="detail-title">Inspect a connection</h2><p id="detail">Select a service, symbol or arrow to see its evidence.</p><div id="actions"></div><h2>Visible nodes</h2><div id="nodes" class="list" aria-label="Visible nodes"></div><h2>Visible relationships</h2><div id="edges" class="list" aria-label="Visible relationships"></div></aside></main>
  <script nonce="${nonce}" src="${script}"></script></body></html>`;
}
export class RelationshipExplorer implements vscode.Disposable {
  private graph: ExplorerGraph | undefined;
  private selectedRoot: string | undefined;
  private options: RelationshipOptions = {};
  private generation = 0;
  private busy = false;
  readonly panel: vscode.WebviewPanel;
  constructor(
    extensionUri: vscode.Uri,
    private readonly host: ExplorerHost,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "pgraph.relationships",
      "PGraph · Relationships",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "dist"),
          vscode.Uri.joinPath(extensionUri, "media"),
        ],
      },
    );
    this.panel.webview.html = explorerHTML(this.panel.webview, extensionUri);
    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handle(message).catch((error) =>
        this.panel.webview.postMessage({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    });
    this.panel.onDidDispose(() => {
      this.generation++;
    });
  }
  async handle(message: unknown): Promise<void> {
    if (
      !message ||
      typeof message !== "object" ||
      JSON.stringify(message).length > 10_000
    )
      throw new Error("Invalid explorer message");
    const m = message as Record<string, unknown>;
    if (
      !["ready", "workspace", "refresh", "focus", "search", "open"].includes(
        String(m.type),
      )
    )
      throw new Error("Unknown explorer action");
    if (this.busy) return;
    if (m.type === "open") {
      const node = this.graph?.nodes.find((n) => n.id === m.id);
      const edge = this.graph?.edges.find((e) => e.id === m.id);
      const index = Number(m.source ?? 0);
      if (!Number.isSafeInteger(index) || index < 0 || index > 1)
        throw new Error("Invalid evidence selection");
      const source = node?.symbolId
        ? {
            rootId: node.rootId,
            symbolId: node.symbolId,
            location: node.location,
          }
        : edge?.sources[index];
      if (!source || this.graph?.revisions[source.rootId] === undefined)
        throw new Error("Source is not in the displayed graph");
      await this.host.open(
        source.rootId,
        source.symbolId,
        this.graph.revisions[source.rootId]!,
        source.location?.startLine,
      );
      return;
    }
    if (m.type === "focus") {
      const node = this.graph?.nodes.find((n) => n.id === m.id);
      if (!node) throw new Error("Node is not in the displayed graph");
      this.selectedRoot = node.rootId;
      const direction = m.direction ?? "both";
      const depth = m.depth ?? 1;
      if (
        !["in", "out", "both"].includes(String(direction)) ||
        !Number.isSafeInteger(depth) ||
        Number(depth) < 1 ||
        Number(depth) > 4
      )
        throw new Error("Invalid expansion options");
      this.options = {
        symbol: node.symbolId,
        scope: node.scope,
        direction: direction as RelationshipOptions["direction"],
        depth: Number(depth),
      };
    } else if (m.type === "search") {
      if (!this.selectedRoot) throw new Error("Select a service first");
      if (
        typeof m.query !== "string" ||
        m.query.length > 500 ||
        !["in", "out", "both"].includes(String(m.direction)) ||
        !Number.isSafeInteger(m.depth) ||
        Number(m.depth) < 1 ||
        Number(m.depth) > 4
      )
        throw new Error("Invalid search options");
      this.options = {
        query: m.query,
        scope: this.options.scope,
        direction: m.direction as RelationshipOptions["direction"],
        depth: Number(m.depth),
      };
    } else if (m.type !== "refresh") {
      this.selectedRoot = undefined;
      this.options = {};
    }
    const generation = ++this.generation;
    this.busy = true;
    await this.panel.webview.postMessage({ type: "loading" });
    try {
      const graph = this.selectedRoot
        ? await this.host.relationships(this.selectedRoot, this.options)
        : await this.host.workspace();
      if (generation !== this.generation) return;
      this.graph = graph;
      await this.panel.webview.postMessage({
        type: "graph",
        graph,
        mode: this.selectedRoot ? "symbols" : "workspace",
      });
    } finally {
      this.busy = false;
    }
  }
  markStale(): void {
    void this.panel.webview.postMessage({ type: "stale" });
  }
  dispose(): void {
    this.generation++;
    this.panel.dispose();
  }
}
