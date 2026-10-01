import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { QueueClient } from "@azure/storage-queue";
import { getWebhookConfig } from "../lib/config";

const QUEUE_NAME = "webhook-events";

function queueClient(): QueueClient {
  const connectionString = process.env.AzureWebJobsStorage;
  if (!connectionString) {
    throw new Error("AzureWebJobsStorage is not set");
  }
  return new QueueClient(connectionString, QUEUE_NAME);
}

interface QueueMessage {
  webhookId: string;
  payload: unknown;
}

export async function webhookHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const webhookId = request.params.webhookId;
  if (!webhookId) {
    return { status: 400, body: "Missing webhookId in route" };
  }

  const config = await getWebhookConfig(webhookId);
  if (!config) {
    context.warn(`Unknown webhookId '${webhookId}'`);
    return { status: 404, body: `Unknown webhook '${webhookId}'` };
  }
  if (!config.enabled) {
    context.log(`Webhook '${webhookId}' is disabled; ignoring`);
    return { status: 204 };
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { status: 400, body: "Invalid JSON body" };
  }

  const message: QueueMessage = { webhookId, payload };
  const queue = queueClient();
  await queue.createIfNotExists();
  const encoded = Buffer.from(JSON.stringify(message), "utf8").toString(
    "base64",
  );
  await queue.sendMessage(encoded);

  context.log(`Enqueued webhook '${webhookId}'`);
  return { status: 202 };
}

app.http("webhook", {
  methods: ["POST"],
  route: "webhook/{webhookId}",
  authLevel: "function",
  handler: webhookHttp,
});
