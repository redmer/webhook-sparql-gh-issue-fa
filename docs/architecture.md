# Architecture

> Replace the `<...>` placeholder names below with your actual Azure resource
> names (Function App, Storage Account, App Insights, etc.) before publishing.

## System architecture

```mermaid
flowchart LR
    subgraph External["External systems"]
        TriplyDB["TriplyDB<br/>(SPARQL endpoint + webhook source)"]
        GitHub["GitHub<br/>(target repositories)"]
    end

    subgraph Azure["Azure subscription &lt;your-subscription&gt;"]
        subgraph RG["Resource Group &lt;your-resource-group&gt;"]
            subgraph FA["Function App &lt;your-function-app&gt;<br/>(Node.js / TypeScript)"]
                HttpFn["webhookHttp<br/>HTTP trigger<br/>POST /api/webhook/{webhookId}"]
                QueueFn["webhookProcess<br/>Queue trigger"]
                DevFns["devAdmin / devTest<br/>HTTP triggers (local only)"]
            end

            subgraph Storage["Storage Account &lt;your-storage-account&gt;"]
                Queue["Queue: webhook-events"]
                TblConfig["Table: WebhookConfigs"]
                TblState["Table: WebhookState"]
            end

            AppInsights["Application Insights<br/>&lt;your-app-insights&gt;<br/>(optional)"]
        end
    end

    TriplyDB -- "webhook event<br/>POST JSON payload" --> HttpFn
    HttpFn -- "validate webhookId" --> TblConfig
    HttpFn -- "enqueue {webhookId, payload}<br/>(base64)" --> Queue
    Queue -- "trigger" --> QueueFn
    QueueFn -- "read config" --> TblConfig
    QueueFn -- "read / write previous result" --> TblState
    QueueFn -- "SPARQL SELECT<br/>(Mustache-rendered query)" --> TriplyDB
    QueueFn -- "search existing issue +<br/>create issue (if changed)" --> GitHub
    FA -. "telemetry" .-> AppInsights

    classDef azure fill:#e8f1fb,stroke:#0078d4,color:#111;
    classDef external fill:#f6f6f6,stroke:#666,color:#111;
    class FA,Storage,AppInsights azure;
    class TriplyDB,GitHub external;
```

## Request flow

```mermaid
sequenceDiagram
    autonumber
    actor T as TriplyDB (webhook)
    participant H as webhookHttp<br/>HTTP trigger
    participant C as Table: WebhookConfigs
    participant Q as Queue: webhook-events
    participant P as webhookProcess<br/>Queue trigger
    participant S as Table: WebhookState
    participant SP as SPARQL endpoint
    participant G as GitHub API

    T->>H: POST /api/webhook/{webhookId}?code=fn-key<br/>JSON payload
    H->>C: getWebhookConfig(webhookId)
    alt unknown webhook
        C-->>H: not found
        H-->>T: 404
    else disabled
        C-->>H: enabled = false
        H-->>T: 204 (ignored)
    else valid
        C-->>H: config
        H->>Q: enqueue {webhookId, payload} (base64)
        H-->>T: 202 Accepted
    end

    Q-->>P: dequeue message
    P->>C: re-read config (drop if unknown/disabled)
    P->>S: getPreviousResult(webhookId)
    S-->>P: baseline (or none on first run)
    P->>SP: Mustache-rendered SPARQL SELECT
    SP-->>P: result rows
    P->>P: normalize + compare (diff.ts)<br/>contentHash(result)

    alt first run or result changed
        P->>G: search open issue by hash comment
        alt no existing issue with same hash
            P->>G: create issue (repo, title, Mustache body, labels)
        else duplicate
            G-->>P: existing issue found — skip
        end
        P->>S: saveResult(webhookId, resultJson)
    else unchanged
        P->>P: no-op (state kept as-is)
    end
```

## Data flow

```mermaid
flowchart TD
    subgraph Inputs
        Payload["Webhook payload (JSON)<br/>from TriplyDB event"]
        Config["WebhookConfigs row<br/>enabled, sparqlEndpoint, sparqlQuery,<br/>githubRepo, issueTitle, issueTemplate, issueLabels"]
        State["WebhookState row<br/>resultJson (previous SPARQL result)"]
        Secrets["App settings<br/>TRIPLYDB_TOKEN, GITHUB_TOKEN,<br/>AzureWebJobsStorage"]
    end

    subgraph Processing
        RenderQ["Mustache render<br/>sparqlEndpoint + sparqlQuery<br/>with { payload } context"]
        Query["Run SPARQL SELECT<br/>(Bearer TRIPLYDB_TOKEN)"]
        Diff["normalize + resultsEqual<br/>+ SHA-256 contentHash"]
        RenderIssue["Mustache render<br/>issueTitle + issueTemplate<br/>with rows + payload"]
        Dedup["findExistingIssue<br/>by hash comment<br/>"]
    end

    subgraph Outputs
        Issue["GitHub issue<br/>(title, body, labels)"]
        NewState["WebhookState row updated<br/>(only on change)"]
    end

    Payload --> RenderQ
    Config --> RenderQ
    RenderQ --> Query
    Query --> Diff
    State --> Diff
    Config --> RenderIssue
    Payload --> RenderIssue
    Diff -- "changed" --> RenderIssue
    RenderIssue --> Dedup
    Secrets --> Dedup
    Dedup -- "new" --> Issue
    Diff -- "changed" --> NewState
    Diff -- "unchanged" --> NoOp["No issue, no state write"]

    classDef data fill:#e8f1fb,stroke:#0078d4,color:#111;
    class Payload,Config,State,Secrets,Issue,NewState data;
```

## Dev / testing endpoints (local only)

```mermaid
flowchart LR
    Dev["Developer<br/>(.http files / REST Client)"]
    subgraph Local["Local Functions host (func start)"]
        DevCfg["devAdmin<br/>PUT/GET/DELETE /api/dev/config/{id}<br/>GET/PUT/DELETE /api/dev/state/{id}"]
        DevTest["devTest<br/>POST /api/dev/test/{id}<br/>dry-run: query + compare + render"]
    end
    Azurite["Azurite<br/>(local Tables + Queues)"]

    Dev --> DevCfg
    Dev --> DevTest
    DevCfg --> Azurite
    DevTest --> Azurite
```
