import cytoscape from "cytoscape";
import type {
  ExplorerGraph,
  ExplorerNode,
  ExplorerEdge,
} from "@praesidia/pgraph-core";
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const api = acquireVsCodeApi();
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const status = element("status");
let graph: ExplorerGraph = {
  nodes: [],
  edges: [],
  revisions: {},
  truncated: false,
  warnings: [],
};
let mode = "workspace";
let selected: ExplorerNode | undefined;
const cy = cytoscape({
  container: element("graph"),
  minZoom: 0.15,
  maxZoom: 2.5,
  wheelSensitivity: 0.2,
  style: [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "background-color": "#5386d7",
        color: "#a8b9d2",
        "font-size": 11,
        "text-valign": "bottom",
        "text-margin-y": 8,
        "text-wrap": "ellipsis",
        "text-max-width": "150px",
        width: 24,
        height: 24,
        "border-width": 2,
        "border-color": "#78a5ed",
      },
    },
    {
      selector: 'node[kind="service"]',
      style: {
        shape: "round-rectangle",
        width: 135,
        height: 48,
        "text-valign": "center",
        "text-margin-y": 0,
        color: "#ffffff",
        "background-color": "#244b85",
        "border-color": "#5386d7",
      },
    },
    {
      selector: 'node[kind="unresolved"]',
      style: {
        shape: "diamond",
        "background-color": "#6c5635",
        "border-color": "#d2a969",
        "border-style": "dashed",
        width: 28,
        height: 28,
      },
    },
    {
      selector: "edge",
      style: {
        width: 1.5,
        "line-color": "#526b8f",
        "target-arrow-color": "#718cb3",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        label: "data(type)",
        "font-size": 9,
        color: "#99abc5",
        "text-rotation": "autorotate",
        "text-margin-y": -9,
        "arrow-scale": 0.8,
      },
    },
    {
      selector: 'edge[evidence="unresolved"]',
      style: {
        "line-style": "dashed",
        "line-color": "#a98751",
        "target-arrow-color": "#a98751",
      },
    },
    {
      selector: ":selected",
      style: {
        "border-color": "#c9e2ff",
        "border-width": 3,
        "line-color": "#97c5ff",
        "target-arrow-color": "#97c5ff",
      },
    },
  ],
});
function button(label: string, action: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.textContent = label;
  node.onclick = action;
  return node;
}
function inspectNode(node: ExplorerNode): void {
  selected = node;
  element("detail-title").textContent = node.label;
  element("detail").textContent = node.detail;
  element("actions").replaceChildren(
    button(
      node.kind === "service" ? "Explore service" : "Expand neighborhood",
      () =>
        api.postMessage({
          type: "focus",
          id: node.id,
          direction: element<HTMLSelectElement>("direction").value,
          depth: Number(element<HTMLSelectElement>("depth").value),
        }),
    ),
  );
  if (node.symbolId)
    element("actions").append(
      button("Open source", () =>
        api.postMessage({ type: "open", id: node.id }),
      ),
    );
  cy.elements().unselect();
  cy.getElementById(node.id).select();
}
function inspectEdge(edge: ExplorerEdge): void {
  element("detail-title").textContent = edge.type;
  element("detail").textContent =
    `${edge.evidence} · confidence ${Math.round(edge.confidence * 100)}%\n${edge.detail}\n\n${edge.sources.map((s) => `${s.location.file}:${s.location.startLine}\nSHA-256 ${s.hash ?? "unavailable"}`).join("\n\n")}`;
  element("actions").replaceChildren(
    ...edge.sources
      .slice(0, 2)
      .map((_, i) =>
        button(`Open ${i ? "destination" : "origin"} evidence`, () =>
          api.postMessage({ type: "open", id: edge.id, source: i }),
        ),
      ),
  );
  cy.elements().unselect();
  cy.getElementById(edge.id).select();
}
cy.on("tap", "node", (event) => {
  const node = graph.nodes.find((n) => n.id === event.target.id());
  if (node) inspectNode(node);
});
cy.on("tap", "edge", (event) => {
  const edge = graph.edges.find((e) => e.id === event.target.id());
  if (edge) inspectEdge(edge);
});
function render(): void {
  const filter = element<HTMLSelectElement>("filter").value;
  const edges = graph.edges.filter((edge) => !filter || edge.type === filter);
  cy.elements().remove();
  cy.add([
    ...graph.nodes.map((node) => ({
      group: "nodes" as const,
      data: { ...node },
    })),
    ...edges.map((edge) => ({
      group: "edges" as const,
      data: { ...edge, source: edge.from, target: edge.to },
    })),
  ]);
  cy.layout({
    name: mode === "workspace" ? "circle" : "breadthfirst",
    directed: true,
    padding: 65,
    spacingFactor: 1.15,
    animate: false,
  }).run();
  element("empty").hidden = graph.nodes.length > 0;
  element("nodes").replaceChildren(
    ...graph.nodes.map((node) =>
      button(`${node.label} · ${node.kind}`, () => {
        inspectNode(node);
        cy.animate({
          center: { eles: cy.getElementById(node.id) },
          duration: 200,
        });
      }),
    ),
  );
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  element("edges").replaceChildren(
    ...edges.map((edge) =>
      button(
        `${label.get(edge.from)} → ${label.get(edge.to)} · ${edge.type}`,
        () => inspectEdge(edge),
      ),
    ),
  );
  status.textContent = `${mode === "workspace" ? "Workspace service map" : "Symbol neighborhood"} · ${graph.nodes.length} nodes · ${edges.length} relationships${graph.truncated ? " · PARTIAL VIEW: limits reached" : ""}. ${graph.warnings.join(" ")}`;
  if (selected) {
    const current = graph.nodes.find((n) => n.id === selected!.id);
    if (current) inspectNode(current);
  }
}
window.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "graph") {
    graph = message.graph;
    mode = message.mode;
    status.className = "";
    render();
  }
  if (message.type === "loading") {
    status.className = "";
    status.textContent = "Loading committed graph indexes…";
  }
  if (message.type === "error") {
    status.className = "error";
    status.textContent = message.message;
  }
  if (message.type === "stale") {
    status.className = "error";
    status.textContent =
      "Workspace sources or folders changed. Reindex, then refresh this view.";
  }
});
element("workspace").onclick = () => api.postMessage({ type: "workspace" });
element("refresh").onclick = () => api.postMessage({ type: "refresh" });
element("fit").onclick = () => cy.fit(undefined, 55);
element("filter").onchange = render;
element<HTMLFormElement>("search-form").onsubmit = (event) => {
  event.preventDefault();
  api.postMessage({
    type: "search",
    query: element<HTMLInputElement>("search").value,
    direction: element<HTMLSelectElement>("direction").value,
    depth: Number(element<HTMLSelectElement>("depth").value),
  });
};
new ResizeObserver(() => {
  cy.resize();
}).observe(element("graph"));
api.postMessage({ type: "ready" });

for (const id of ["direction", "depth"])
  element(id).onchange = () => {
    if (selected && graph.nodes.some((node) => node.id === selected!.id)) {
      api.postMessage({
        type: "focus",
        id: selected.id,
        direction: element<HTMLSelectElement>("direction").value,
        depth: Number(element<HTMLSelectElement>("depth").value),
      });
    } else if (mode === "symbols")
      element<HTMLFormElement>("search-form").requestSubmit();
  };
