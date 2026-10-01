import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { getWebhookConfig } from "../lib/config";
import { contentHash, normalize, resultsEqual } from "../lib/diff";
import { runSparqlQuery, SparqlResult } from "../lib/sparql";
import { getPreviousResult, StoredState } from "../lib/state";
import { buildView, renderTemplate } from "../lib/template";
import { forbiddenIfNotLocal } from "./devAdmin";

/**
 * POST /api/dev/test/{webhookId}
 *
 * Dry-run the whole pipeline synchronously:
 *   - look up config and stored state
 *   - run the SPARQL query
 *   - compare with state
 *   - render the issue title/body that WOULD be created
 *
 * Never writes to state, never touches GitHub. Returns everything for
 * inspection in the REST client response.
 *
 * Query params:
 *   ?body=false   — omit the rendered issue body from the response
 */
export async function devTest(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  forbiddenIfNotLocal();

  const webhookId = request.params.webhookId;
  if (!webhookId) {
    return { status: 400, jsonBody: { error: "Missing webhookId" } };
  }

  const includeBody = request.query.get("body") !== "false";

  let payload: Record<string, unknown> = {};
  try {
    if (request.body) {
      payload = (await request.json()) as Record<string, unknown>;
    }
  } catch {
    return { status: 400, jsonBody: { error: "Invalid JSON body" } };
  }

  const config = await getWebhookConfig(webhookId);
  if (!config) {
    return { status: 404, jsonBody: { error: `No config for '${webhookId}'` } };
  }

  const endpoint = config.sparqlEndpoint;
  if (!endpoint) {
    return {
      status: 400,
      jsonBody: {
        error: `Config '${webhookId}' has no sparqlEndpoint`,
      },
    };
  }

  context.log(`[dev-test] Running query for '${webhookId}'`);

  let currentRaw: SparqlResult;
  try {
    currentRaw = await runSparqlQuery(endpoint, config.sparqlQuery);
  } catch (err: any) {
    return {
      status: 502,
      jsonBody: {
        webhookId,
        error: `SPARQL query failed: ${err?.message ?? String(err)}`,
        endpoint,
      },
    };
  }

  const current = normalize(currentRaw);
  const stored: StoredState | undefined = await getPreviousResult(webhookId);
  const baseline = stored ? normalize(stored as SparqlResult) : undefined;

  const changed = !baseline || !resultsEqual(baseline, current);
  const hash = contentHash(current);

  const view = buildView(currentRaw, payload);
  let title: string | undefined;
  let body: string | undefined;
  let renderError: string | undefined;
  try {
    title = renderTemplate(config.issueTitle, view);
    body = renderTemplate(config.issueTemplate, view);
  } catch (err: any) {
    renderError = err?.message ?? String(err);
  }

  return {
    status: 200,
    jsonBody: {
      webhookId,
      endpoint,
      dryRun: true,
      result: {
        vars: current.vars,
        rowCount: current.rows.length,
        rowsPreview: current.rows.slice(0, 5),
      },
      storedState: baseline
        ? { vars: baseline.vars, rowCount: baseline.rows.length }
        : null,
      changed,
      hash,
      wouldCreateIssue: changed,
      issue: {
        repo: config.githubRepo,
        title,
        labels: config.issueLabels,
        body: includeBody ? body : undefined,
      },
      renderError,
    },
  };
}

app.http("dev-test", {
  methods: ["POST"],
  route: "dev/test/{webhookId}",
  authLevel: "function",
  handler: devTest,
});
