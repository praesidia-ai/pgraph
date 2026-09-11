import { bounded, hash, readLocal, words } from "@praesidia/pgraph-shared";
import type { GraphQuery, SourceSlice } from "./index.js";

export interface ExcerptOptions {
  query?: string;
  line?: number;
  maxLines?: number;
}
export interface SourceExcerpt extends SourceSlice {
  symbol: string;
  selection: "cursor" | "matching text" | "declaration start";
  omittedBefore: number;
  omittedAfter: number;
  complete: boolean;
  warning?: string;
}

/** A contiguous, source-verified excerpt; not a complete data/control-flow slice. */
export function sourceExcerpt(
  graph: GraphQuery,
  name: string,
  options: ExcerptOptions = {},
): SourceExcerpt {
  const node = graph.symbol(name);
  const loc = node.location;
  if (!loc || ["file", "package"].includes(node.kind))
    throw new Error("Choose an indexed declaration for an excerpt");
  if (
    options.query !== undefined &&
    (typeof options.query !== "string" || options.query.length > 500)
  )
    throw new Error("Excerpt query must contain at most 500 characters");
  const maxLines = bounded(options.maxLines ?? 30, 3, 120, "maxLines");
  const record = graph.store.file(loc.file);
  const content = readLocal(graph.root, loc.file, graph.maxFileBytes);
  if (!record || hash(content) !== record.hash)
    throw new Error(`Stale index for ${loc.file}; run pgraph index --changed`);
  const lines = content.slice(loc.startOffset, loc.endOffset).split("\n");
  const size = Math.min(maxLines, lines.length);
  let start = 0;
  let selection: SourceExcerpt["selection"] = "declaration start";
  if (options.line !== undefined) {
    bounded(options.line, loc.startLine, loc.endLine, "line");
    start = Math.max(
      0,
      Math.min(
        lines.length - size,
        options.line - loc.startLine - Math.floor(size / 2),
      ),
    );
    selection = "cursor";
  } else if (options.query?.trim()) {
    const terms = [
      ...new Set(words(options.query).filter((term) => term.length > 2)),
    ].slice(0, 24);
    const tokens = lines.map((line) => new Set(words(line)));
    const frequencies = terms.map(
      (term) => tokens.filter((line) => line.has(term)).length,
    );
    const scores = tokens.map((line) =>
      terms.reduce(
        (sum, term, i) =>
          sum + (line.has(term) ? 1 / Math.sqrt(frequencies[i]!) : 0),
        0,
      ),
    );
    let total = scores.slice(0, size).reduce((a, b) => a + b, 0),
      best = total;
    for (let i = size; i < lines.length; i++) {
      total += scores[i]! - scores[i - size]!;
      if (total > best + 1e-9) {
        best = total;
        start = i - size + 1;
      }
    }
    if (best > 0) selection = "matching text";
  }
  const complete = size === lines.length;
  return {
    symbol: node.id,
    file: loc.file,
    startLine: loc.startLine + start,
    endLine: loc.startLine + start + size - 1,
    source: lines.slice(start, start + size).join("\n"),
    hash: record.hash,
    selection,
    omittedBefore: start,
    omittedAfter: lines.length - start - size,
    complete,
    ...(!complete
      ? {
          warning:
            "Partial source excerpt; surrounding definitions and control conditions may be omitted.",
        }
      : {}),
  };
}
