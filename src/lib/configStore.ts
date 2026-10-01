import { TableClient } from "@azure/data-tables";

function tableClient(tableName: string): TableClient {
  const connectionString = process.env.AzureWebJobsStorage;
  if (!connectionString) {
    throw new Error("AzureWebJobsStorage is not set");
  }
  return TableClient.fromConnectionString(connectionString, tableName);
}

export async function upsertConfigEntity(
  webhookId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const client = tableClient("WebhookConfigs");
  await client.createTable();
  await client.upsertEntity(
    {
      partitionKey: "webhook",
      rowKey: webhookId,
      ...properties,
    },
    "Replace",
  );
}

export async function deleteConfigEntity(webhookId: string): Promise<boolean> {
  const client = tableClient("WebhookConfigs");
  try {
    await client.deleteEntity("webhook", webhookId);
    return true;
  } catch (err: any) {
    if (err?.statusCode === 404) return false;
    throw err;
  }
}

export async function getStateEntity(
  webhookId: string,
): Promise<Record<string, unknown> | undefined> {
  const client = tableClient("WebhookState");
  try {
    const entity = await client.getEntity("webhook", webhookId);
    return entity as Record<string, unknown>;
  } catch (err: any) {
    if (err?.statusCode === 404) return undefined;
    throw err;
  }
}

export async function upsertStateEntity(
  webhookId: string,
  resultJson: string,
): Promise<void> {
  const client = tableClient("WebhookState");
  await client.createTable();
  await client.upsertEntity(
    {
      partitionKey: "webhook",
      rowKey: webhookId,
      resultJson,
      updatedAt: new Date().toISOString(),
    },
    "Replace",
  );
}

export async function deleteStateEntity(webhookId: string): Promise<boolean> {
  const client = tableClient("WebhookState");
  try {
    await client.deleteEntity("webhook", webhookId);
    return true;
  } catch (err: any) {
    if (err?.statusCode === 404) return false;
    throw err;
  }
}
