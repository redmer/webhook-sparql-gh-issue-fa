# `triply-webhook-to-gh-issue-func`

This Azure Function App (Typescript & NodeJS), when triggered as a TriplyDB webhook, compares the results of a SPARQL query with a previous baseline and if they're unequal, opens a GitHub issue.

Two SPARQL queries establish a baseline (or old situation) and a result to compare with (or the new situation).
These SELECT queries can have any number of columns, each of which need to be equal.
Each column will be substituted for in a GitHub issue template.

## How it works

1. **HTTP trigger** (`POST /api/webhook/{webhookId}`) receives the TriplyDB webhook, validates the `webhookId` against Table Storage config, and enqueues the payload to Azure Queue Storage.
2. **Queue trigger** pops the message, runs the configured SPARQL query, compares the result with the previous state, and opens a GitHub issue via the REST API if they differ.
3. **Issue deduplication** is built-in: a SHA-256 hash of the result is embedded in the issue body as an HTML comment (`<!-- triply-webhook-hash: ... -->`). Before creating a new issue, the function searches for an existing open issue with that hash.

## Configuration

### App settings (env vars)

- `AzureWebJobsStorage` — connection string for Azure Storage (Tables + Queues)
- `TRIPLYDB_TOKEN` — Bearer token for SPARQL endpoint (optional if endpoint is public)
- `GITHUB_TOKEN` — GitHub token with `issues:write` on target repos

### Table Storage

#### `WebhookConfigs` (PartitionKey = `webhook`, RowKey = your webhook ID)

| Property         | Type    | Required | Description                           |
| ---------------- | ------- | -------- | ------------------------------------- |
| `enabled`        | boolean | yes      | `false` to disable without deleting   |
| `sparqlEndpoint` | string  | no       | SPARQL endpoint to run on             |
| `sparqlQuery`    | string  | yes      | The query to run (new situation)      |
| `githubRepo`     | string  | yes      | `owner/name`                          |
| `issueTitle`     | string  | yes      | Mustache template for the issue title |
| `issueTemplate`  | string  | yes      | Mustache template for the issue body  |
| `issueLabels`    | string  | no       | Comma-separated labels                |

#### `WebhookState` (PartitionKey = `webhook`, RowKey = your webhook ID)

Written automatically. Stores the last seen SPARQL result as JSON in `resultJson`.

## Example config row

```json
{
  "partitionKey": "webhook",
  "rowKey": "crow-ecm",
  "enabled": true,
  "sparqlQuery": "PREFIX dct: <http://purl.org/dc/terms/>\nPREFIX owl: <http://www.w3.org/2002/07/owl#>\n\nSELECT ?time ?version WHERE {\n  [] a owl:Ontology ;\n    dct:modified ?time ;\n    owl:versionInfo ?version .\n}",
  "githubRepo": "crow/ontology",
  "issueTitle": "Ontology updated to version {{version}}",
  "issueTemplate": "At {{time}} the ontology was updated to version {{version}}.\n\nRows: {{#rows}}{{time}} {{version}}\n{{/rows}}",
  "issueLabels": "ontology, automated"
}
```

## Template syntax

The issue body is rendered with Mustache:

- `{{columnName}}` — value from the first row of the SPARQL result
- `{{#rows}}...{{/rows}}` — iterate over all rows; inside the loop, `{{columnName}}` refers to that row's value
- `{{payload.dataset.name}}` — access the original TriplyDB webhook payload

## TriplyDB webhook setup

Point your TriplyDB webhook to:

```
POST https://<your-func-app>.azurewebsites.net/api/webhook/<webhookId>?code=<function-key>
```

The `webhookId` is the RowKey of your config row in `WebhookConfigs`.

## Local development

```bash
cp local.settings.json.template local.settings.json
# Fill in AzureWebJobsStorage (e.g. UseDevelopmentStorage=true for Azurite)
npm install
npm start
```

## Local testing endpoints

When running locally (`func start`, no `WEBSITE_SITE_NAME`), extra endpoints under
`/api/dev/*` let you configure and simulate everything with a `.http` file:

| Method | Route                         | Purpose                                                                          |
| ------ | ----------------------------- | -------------------------------------------------------------------------------- |
| PUT    | `/api/dev/config/{webhookId}` | Upsert config into Table Storage                                                 |
| GET    | `/api/dev/config/{webhookId}` | Read the parsed config back                                                      |
| DELETE | `/api/dev/config/{webhookId}` | Delete config                                                                    |
| GET    | `/api/dev/state/{webhookId}`  | Inspect stored previous SPARQL result                                            |
| PUT    | `/api/dev/state/{webhookId}`  | Seed previous result (`{vars, rows}`) to force equal/unequal diffs               |
| DELETE | `/api/dev/state/{webhookId}`  | Reset state                                                                      |
| POST   | `/api/dev/test/{webhookId}`   | **Dry-run**: run query, compare, render issue — no state writes, no GitHub calls |

See [docs/testing/local-testing.http](docs/testing/local-testing.http) for a
ready-to-run sequence (REST Client / httpyac).
