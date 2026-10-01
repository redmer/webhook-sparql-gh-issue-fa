export interface SparqlResult {
  vars: string[];
  // Each row is an array of lexical values, positionally aligned with `vars`.
  rows: string[][];
}

interface SparqlJsonBinding {
  type: string;
  value: string;
}

interface SparqlJsonResponse {
  head: { vars: string[] };
  results: { bindings: Record<string, SparqlJsonBinding>[] };
}

export async function runSparqlQuery(
  endpoint: string,
  query: string,
): Promise<SparqlResult> {
  const headers: Record<string, string> = {
    Accept: "application/sparql-results+json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const token = process.env.TRIPLYDB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: new URLSearchParams({ query }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `SPARQL query failed: ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
    );
  }

  const json = (await response.json()) as SparqlJsonResponse;
  const vars = json.head.vars;
  const rows = json.results.bindings.map((binding) =>
    vars.map((v) => binding[v]?.value ?? ""),
  );
  return { vars, rows };
}
