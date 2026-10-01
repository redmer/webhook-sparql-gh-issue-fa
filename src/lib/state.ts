import { TableClient } from "@azure/data-tables";

export interface StoredState {
  vars: string[];
  rows: string[][];
}

function tableClient(): TableClient {
  const connectionString = process.env.AzureWebJobsStorage;
  if (!connectionString) {
    throw new Error("AzureWebJobsStorage is not set");
  }
  return TableClient.fromConnectionString(connectionString, "WebhookState");
}

export async function getPreviousResult(
  webhookId: string,
): Promise<StoredState | undefined> {
  const client = tableClient();
  try {
    const entity = await client.getEntity("webhook", webhookId);
    if (typeof entity.resultJson !== "string") return undefined;
    return JSON.parse(entity.resultJson) as StoredState;
  } catch (err: any) {
    if (err?.statusCode === 404) return undefined;
    throw err;
  }
}

export async function saveResult(
  webhookId: string,
  result: StoredState,
): Promise<void> {
  const client = tableClient();
  await client.createTable();
  await client.upsertEntity(
    {
      partitionKey: "webhook",
      rowKey: webhookId,
      resultJson: JSON.stringify(result),
      updatedAt: new Date().toISOString(),
    },
    "Replace",
  );
}
