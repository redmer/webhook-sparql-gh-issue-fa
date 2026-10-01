import { createHash } from "crypto";
import { SparqlResult } from "./sparql";

export interface NormalizedResult {
  vars: string[];
  rows: string[][];
}

/**
 * Normalize a SPARQL result for comparison:
 * - trim whitespace in every cell
 * - sort rows lexicographically
 */
export function normalize(result: SparqlResult): NormalizedResult {
  const rows = result.rows
    .map((row) => row.map((cell) => cell.trim()))
    .sort((a, b) => {
      const sa = a.join("");
      const sb = b.join("");
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
  return { vars: [...result.vars], rows };
}

/** Deep comparison of two normalized results. */
export function resultsEqual(
  a: NormalizedResult,
  b: NormalizedResult,
): boolean {
  if (a.vars.length !== b.vars.length || a.rows.length !== b.rows.length) {
    return false;
  }
  for (let i = 0; i < a.vars.length; i++) {
    if (a.vars[i] !== b.vars[i]) return false;
  }
  for (let i = 0; i < a.rows.length; i++) {
    const rowA = a.rows[i];
    const rowB = b.rows[i];
    if (rowA.length !== rowB.length) return false;
    for (let j = 0; j < rowA.length; j++) {
      if (rowA[j] !== rowB[j]) return false;
    }
  }
  return true;
}

/** Stable content hash used for issue deduplication. */
export function contentHash(result: NormalizedResult): string {
  const payload = JSON.stringify(result);
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
