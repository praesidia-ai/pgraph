import { readChangedFiles } from "@praesidia/pgraph-git";
import { hash, readLocal } from "@praesidia/pgraph-shared";
import type { GraphNode } from "@praesidia/pgraph-ir";
import type { PGraph } from "./index.js";

export interface ChangeReview {
  base: string;
  revision: number;
  analysis: "current-file-dependencies";
  totalFiles: number;
  files: {
    file: string;
    status: string;
    indexedHash?: string;
    symbols: number;
    limitation?: string;
  }[];
  affected: { node: GraphNode; via: string; potentialDispatch?: boolean }[];
  tests: { node: GraphNode; via: string; potentialDispatch?: boolean }[];
  checks: string[];
  warnings: string[];
  truncated: boolean;
}

export function reviewChanges(graph: PGraph, maxFiles = 30): ChangeReview {
  const changes = readChangedFiles(graph.root, maxFiles);
  const result: ChangeReview = {
    base: changes.head,
    revision: graph.status().revision,
    analysis: "current-file-dependencies",
    totalFiles: changes.totalFiles,
    files: [],
    affected: [],
    tests: [],
    checks: [],
    warnings: [
      "Conservative file-level impact in this repository. Deleted/renamed symbols and previous contracts require a baseline graph. Cross-service consumers are not included.",
    ],
    truncated: changes.truncated,
  };
  const affected = new Set<string>(),
    tests = new Set<string>();
  let inspected = 0;
  for (const change of changes.files) {
    const record = graph.store.file(change.file);
    const entry: ChangeReview["files"][number] = { ...change, symbols: 0 };
    result.files.push(entry);
    if (change.status === "D") {
      entry.limitation =
        "Deleted file: previous consumers require a baseline graph";
      continue;
    }
    if (!record) {
      entry.limitation =
        "Not indexed: reindex if supported; effects are unknown";
      continue;
    }
    try {
      if (
        hash(readLocal(graph.root, change.file, graph.maxFileBytes)) !==
        record.hash
      ) {
        entry.limitation = "Index is stale: reindex before reviewing this file";
        continue;
      }
    } catch {
      entry.limitation = "Source cannot be verified: reindex before reviewing";
      continue;
    }
    entry.indexedHash = record.hash;
    const nodes = graph.store
      .nodesInFile(change.file)
      .filter(
        (node) =>
          !["file", "package", "directory", "repository"].includes(node.kind),
      );
    entry.symbols = nodes.length;
    if (!nodes.length)
      entry.limitation =
        "No supported declarations: configuration or dependency impact needs separate verification";
    for (const node of nodes) {
      if (++inspected > 60) {
        result.truncated = true;
        break;
      }
      if (node.kind === "test" && !tests.has(node.id)) {
        if (tests.size >= 50) result.truncated = true;
        else {
          tests.add(node.id);
          result.tests.push({ node, via: "changed test" });
        }
      }
      const impact = graph.impact(node.id, { depth: 3, limit: 60 });
      result.truncated ||= impact.truncated;
      for (const warning of impact.warnings)
        if (!result.warnings.includes(warning)) result.warnings.push(warning);
      for (const candidate of impact.likelyChangeSurface) {
        if (!affected.has(candidate.node.id)) {
          if (affected.size >= 100) {
            result.truncated = true;
            continue;
          }
          affected.add(candidate.node.id);
          result.affected.push({
            node: candidate.node,
            via: node.id,
            potentialDispatch: candidate.potentialDispatch,
          });
        }
        if (candidate.node.kind === "test" && !tests.has(candidate.node.id)) {
          if (tests.size >= 50) {
            result.truncated = true;
            continue;
          }
          tests.add(candidate.node.id);
          result.tests.push({
            node: candidate.node,
            via: node.id,
            potentialDispatch: candidate.potentialDispatch,
          });
        }
      }
    }
  }
  if (changes.totalFiles) {
    result.checks = [
      "Run typecheck/build for affected packages",
      "Run the listed candidate tests and required package/CI checks",
    ];
    if (result.files.some((file) => file.limitation) || result.truncated)
      result.checks.push(
        "Run wider checks for files or dependencies marked unknown/omitted",
      );
    if (!result.tests.length)
      result.warnings.push(
        "No candidate tests found; this does not establish test coverage or safety.",
      );
  }
  return result;
}
