import { TableClient } from "@azure/data-tables";

export interface WebhookConfig {
  webhookId: string;
  enabled: boolean;
  sparqlEndpoint?: string;
  sparqlQuery: string;
  githubRepo: string; // "owner/name"
  issueTitle: string;
  issueTemplate: string;
  issueLabels?: string[]; // parsed from comma-separated string
}

function tableClient(tableName: string): TableClient {
  const connectionString = process.env.AzureWebJobsStorage;
  if (!connectionString) {
    throw new Error("AzureWebJobsStorage is not set");
  }
  return TableClient.fromConnectionString(connectionString, tableName);
}

function parseLabels(raw: unknown): string[] | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function getWebhookConfig(
  webhookId: string,
): Promise<WebhookConfig | undefined> {
  const client = tableClient("WebhookConfigs");
  let entity;
  try {
    entity = await client.getEntity("webhook", webhookId);
  } catch (err: any) {
    if (err?.statusCode === 404) return undefined;
    throw err;
  }

  if (
    !entity.sparqlQuery ||
    !entity.githubRepo ||
    !entity.issueTitle ||
    !entity.issueTemplate
  ) {
    throw new Error(
      `WebhookConfig '${webhookId}' is missing required fields (sparqlQuery, githubRepo, issueTitle, issueTemplate)`,
    );
  }

  return {
    webhookId,
    enabled: entity.enabled !== false && entity.enabled !== "false",
    sparqlEndpoint: entity.sparqlEndpoint as string | undefined,
    sparqlQuery: entity.sparqlQuery as string,
    githubRepo: entity.githubRepo as string,
    issueTitle: entity.issueTitle as string,
    issueTemplate: entity.issueTemplate as string,
    issueLabels: parseLabels(entity.issueLabels),
  };
}
