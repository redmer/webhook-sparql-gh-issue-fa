import Mustache from "mustache";
import { NormalizedResult } from "./diff";
import { SparqlResult } from "./sparql";

export interface TemplateView {
  [key: string]: unknown;
}

/**
 * Build the Mustache view from a result set:
 * - first-row columns available as {{colName}}
 * - all rows available as {{rows}} -> list of { colName: value }
 * - webhook payload fields merged in (payload.*)
 */
export function buildView(
  result: SparqlResult,
  payload: Record<string, unknown>,
): TemplateView {
  const view: TemplateView = { payload };

  // All rows as objects
  view.rows = result.rows.map((row) => {
    const obj: Record<string, string> = {};
    result.vars.forEach((v, i) => {
      obj[v] = row[i] ?? "";
    });
    return obj;
  });

  // First row flattened to top level
  const first = result.rows[0];
  if (first) {
    result.vars.forEach((v, i) => {
      view[v] = first[i] ?? "";
    });
  }

  return view;
}

export function renderTemplate(template: string, view: TemplateView): string {
  return Mustache.render(template, view);
}

/** Render a normalized result back into the same view shape (for stored state). */
export function buildViewFromNormalized(
  result: NormalizedResult,
  payload: Record<string, unknown>,
): TemplateView {
  return buildView(result as SparqlResult, payload);
}
