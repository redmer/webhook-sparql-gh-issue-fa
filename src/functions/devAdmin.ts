import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { getWebhookConfig } from "../lib/config";
import {
  deleteConfigEntity,
  deleteStateEntity,
  getStateEntity,
  upsertConfigEntity,
  upsertStateEntity,
} from "../lib/configStore";

/**
 * PUT /api/dev/config/{webhookId}
 * Body: config properties (enabled, sparqlEndpoint, sparqlQuery, githubRepo,
 *       issueTitle, issueTemplate, issueLabels)
 *
 * Secured by authLevel "function" — a valid function key is required.
 */
async function putConfig(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const webhookId = request.params.webhookId;
  if (!webhookId) {
    return { status: 400, jsonBody: { error: "Missing webhookId" } };
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return { status: 400, jsonBody: { error: "Invalid JSON body" } };
  }

  await upsertConfigEntity(webhookId, body);
  context.log(`Upserted config '${webhookId}'`);
  return { status: 200, jsonBody: { webhookId, saved: true } };
}

/** GET /api/dev/config/{webhookId} — read back the parsed config. */
async function getConfig(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const webhookId = request.params.webhookId;
  if (!webhookId) {
    return { status: 400, jsonBody: { error: "Missing webhookId" } };
  }

  const config = await getWebhookConfig(webhookId);
  if (!config) {
    return { status: 404, jsonBody: { error: `No config for '${webhookId}'` } };
  }
  return { status: 200, jsonBody: config };
}

/** DELETE /api/dev/config/{webhookId} */
async function deleteConfig(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const webhookId = request.params.webhookId;
  if (!webhookId) {
    return { status: 400, jsonBody: { error: "Missing webhookId" } };
  }

  const deleted = await deleteConfigEntity(webhookId);
  context.log(`Deleted config '${webhookId}': ${deleted}`);
  return { status: deleted ? 200 : 404, jsonBody: { webhookId, deleted } };
}

/** GET /api/dev/state/{webhookId} — inspect stored previous SPARQL result. */
async function getState(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const webhookId = request.params.webhookId;
  if (!webhookId) {
    return { status: 400, jsonBody: { error: "Missing webhookId" } };
  }

  const entity = await getStateEntity(webhookId);
  if (!entity) {
    return { status: 404, jsonBody: { error: `No state for '${webhookId}'` } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse((entity as any).resultJson);
  } catch {
    parsed = undefined;
  }
  return {
    status: 200,
    jsonBody: {
      webhookId,
      updatedAt: (entity as any).updatedAt,
      state: parsed,
    },
  };
}

/**
 * PUT /api/dev/state/{webhookId}
 * Body: { "vars": ["time"], "rows": [["2026-09-30T19:40:23Z"]] }
 * Seeds the "previous result" so you can force equal/unequal comparisons.
 */
async function putState(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const webhookId = request.params.webhookId;
  if (!webhookId) {
    return { status: 400, jsonBody: { error: "Missing webhookId" } };
  }

  let body: { vars?: string[]; rows?: string[][] };
  try {
    body = (await request.json()) as { vars?: string[]; rows?: string[][] };
  } catch {
    return { status: 400, jsonBody: { error: "Invalid JSON body" } };
  }
  if (!Array.isArray(body.vars) || !Array.isArray(body.rows)) {
    return {
      status: 400,
      jsonBody: {
        error: "Body must have 'vars' (string[]) and 'rows' (string[][])",
      },
    };
  }

  await upsertStateEntity(
    webhookId,
    JSON.stringify({ vars: body.vars, rows: body.rows }),
  );
  context.log(`Seeded state for '${webhookId}'`);
  return { status: 200, jsonBody: { webhookId, saved: true } };
}

/** DELETE /api/dev/state/{webhookId} — reset stored state. */
async function deleteState(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const webhookId = request.params.webhookId;
  if (!webhookId) {
    return { status: 400, jsonBody: { error: "Missing webhookId" } };
  }

  const deleted = await deleteStateEntity(webhookId);
  context.log(`Deleted state '${webhookId}': ${deleted}`);
  return { status: deleted ? 200 : 404, jsonBody: { webhookId, deleted } };
}

app.http("dev-put-config", {
  methods: ["PUT"],
  route: "dev/config/{webhookId}",
  authLevel: "function",
  handler: putConfig,
});

app.http("dev-get-config", {
  methods: ["GET"],
  route: "dev/config/{webhookId}",
  authLevel: "function",
  handler: getConfig,
});

app.http("dev-delete-config", {
  methods: ["DELETE"],
  route: "dev/config/{webhookId}",
  authLevel: "function",
  handler: deleteConfig,
});

app.http("dev-get-state", {
  methods: ["GET"],
  route: "dev/state/{webhookId}",
  authLevel: "function",
  handler: getState,
});

app.http("dev-put-state", {
  methods: ["PUT"],
  route: "dev/state/{webhookId}",
  authLevel: "function",
  handler: putState,
});

app.http("dev-delete-state", {
  methods: ["DELETE"],
  route: "dev/state/{webhookId}",
  authLevel: "function",
  handler: deleteState,
});
