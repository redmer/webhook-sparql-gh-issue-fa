import { app, InvocationContext } from "@azure/functions";
import Mustache from "mustache";
import { getWebhookConfig, WebhookConfig } from "../lib/config";
import {
  contentHash,
  normalize,
  NormalizedResult,
  resultsEqual,
} from "../lib/diff";
import { createIssue, findExistingIssue } from "../lib/github";
import { runSparqlQuery, SparqlResult } from "../lib/sparql";
import { getPreviousResult, saveResult, StoredState } from "../lib/state";
import { buildView, renderTemplate } from "../lib/template";

interface QueueMessage {
  webhookId: string;
  payload: Record<string, unknown>;
}

/**
 * Render the configured SPARQL endpoint as a Mustache template against
 * `{ payload }`, so e.g. `{{payload.dataset.id}}` can appear in the URL.
 */
function resolveEndpoint(
  config: WebhookConfig,
  payload: Record<string, unknown>,
): string {
  const endpoint = config.sparqlEndpoint;
  if (!endpoint) {
    throw new Error(
      `No SPARQL endpoint: set sparqlEndpoint on config '${config.webhookId}'`,
    );
  }
  return Mustache.render(endpoint, { payload });
}

/**
 * Render the configured SPARQL query as a Mustache template against
 * `{ payload }`. Use `{{{...}}}` (triple braces) inside a BIND/VALUES when
 * the payload value needs to be injected as-is rather than HTML-escaped,
 * e.g. `BIND("{{{payload.payload.ticket}}}" AS ?payloadPayloadTicket)`.
 * The config author is responsible for producing valid SPARQL (quoting the
 * injected value, escaping quotes inside it, etc.).
 */
function resolveQuery(
  config: WebhookConfig,
  payload: Record<string, unknown>,
): string {
  return Mustache.render(config.sparqlQuery, { payload });
}

async function getBaseline(
  config: WebhookConfig,
  context: InvocationContext,
): Promise<NormalizedResult | undefined> {
  const stored: StoredState | undefined = await getPreviousResult(
    config.webhookId,
  );
  if (!stored) {
    context.log(
      `No stored state for '${config.webhookId}'; first run will initialize state and open an issue`,
    );
    return undefined;
  }
  return normalize(stored as SparqlResult);
}

export async function webhookProcess(
  message: QueueMessage,
  context: InvocationContext,
): Promise<void> {
  const { webhookId, payload } = message;
  context.log(`Processing webhook '${webhookId}'`);

  const config = await getWebhookConfig(webhookId);
  if (!config) {
    context.warn(`Unknown webhookId '${webhookId}'; dropping message`);
    return;
  }
  if (!config.enabled) {
    context.log(`Webhook '${webhookId}' disabled; dropping message`);
    return;
  }

  const endpoint = resolveEndpoint(config, payload);
  const query = resolveQuery(config, payload);

  const currentRaw = await runSparqlQuery(endpoint, query);
  const current = normalize(currentRaw);
  const baseline = await getBaseline(config, context);

  const changed = !baseline || !resultsEqual(baseline, current);

  if (!changed) {
    context.log(`No change for '${webhookId}'`);
    // Keep state fresh (e.g. if config switched from queryOld to stateful mode).
    await saveResult(webhookId, current);
    return;
  }

  const hash = contentHash(current);

  const existingIssue = await findExistingIssue(config.githubRepo, hash);
  if (existingIssue !== undefined) {
    context.log(
      `Open issue #${existingIssue} already covers this result; skipping`,
    );
  } else {
    const view = buildView(currentRaw, payload);
    const title = renderTemplate(config.issueTitle, view);
    const body = renderTemplate(config.issueTemplate, view);

    const issueNumber = await createIssue({
      repoFullName: config.githubRepo,
      title,
      body,
      labels: config.issueLabels,
      hash,
    });
    context.log(`Created issue #${issueNumber} in ${config.githubRepo}`);
  }

  await saveResult(webhookId, current);
}

app.storageQueue("webhookProcess", {
  queueName: "webhook-events",
  connection: "AzureWebJobsStorage",
  handler: webhookProcess,
});
