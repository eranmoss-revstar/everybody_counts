# Everybody Counts — Teaching Assistant Implementation Plan

## What We're Building

An RAG-based math teaching assistant for UK Grade 1–2 (KS1) teachers. Teachers ask natural-language questions about how to teach a math concept and receive step-by-step, classroom-ready guidance grounded in Everybody Counts' own uploaded materials. No external data sources. Tone: pedagogical, clarifying, and playful.

Delivered as a CDK QuickStart — one command provisions all infrastructure.

---

## Architecture

```
Teacher (browser)
        |
        v
  Amplify Web App  [Lexend font]
        |  Cognito JWT
        v
  API Gateway  POST /chat
        |
        v
  chat-handler Lambda
        |--- Bedrock KB retrieve --> OpenSearch Serverless
        |--- Claude Sonnet 4.5
        |--- Guardrails (math-only topic policy)
        |--- STM: conversation history from Amplify

Everybody Counts Admin (S3 upload via AWS CLI or SDK)
        |
        v
  S3 Bucket /uploads/  (PDF, DOCX, PPTX)
        |  S3 PUT event
        v
  kb-sync Lambda --> Bedrock Knowledge Base --> OpenSearch Serverless
```

---

## Components

### Cognito User Pool
- Email + password sign-in (SRP)
- Self sign-up disabled — teacher accounts created by Everybody Counts admins
- Used by API Gateway as JWT authorizer and by Amplify for login

### S3 Bucket
- Single bucket (already defined in `infra/lib/agentcore-stack.ts` as `agentcore-quickstart-{account}-{region}`)
- `/uploads/` prefix for admin-uploaded teaching documents; `/cloudtrail/` prefix already in use for audit logs
- Formats: PDF, DOCX, PPTX — Bedrock KB parses natively, no conversion needed
- S3 event notification on `uploads/*` prefix triggers kb-sync Lambda (to be added to existing bucket definition)

### kb-sync Lambda
- Triggered by S3 ObjectCreated on `uploads/` prefix
- Calls Bedrock `StartIngestionJob` to sync documents into the Knowledge Base
- Logs to CloudWatch

### Bedrock Knowledge Base
- Data source: S3 `/uploads/`
- Embedding model: Amazon Titan Embed Text v2
- Vector store: OpenSearch Serverless
- Bedrock handles chunking and text extraction natively

### OpenSearch Serverless
- Collection type: VECTORSEARCH
- Backing store for the Knowledge Base vector index
- Access granted to KB role and chat-handler Lambda role

### Bedrock Guardrails
- Content filters: hate, violence, sexual, insults, misconduct (HIGH), prompt attack (HIGH input)
- Topic policy: block anything outside UK KS1 math teaching scope
- PII: anonymise emails, block SSN/credit card numbers
- Applied to both input and output on every chat-handler invocation

### chat-handler Lambda
- Receives user message + conversation history (STM) from Amplify via API Gateway
- Retrieves relevant chunks from Bedrock KB
- Calls Claude Sonnet 4.5 with: system prompt + retrieved context + STM history + user message
- System prompt sets pedagogical, clarifying, playful tone for KS1 math teachers
- Applies Guardrails on input and output
- Returns response to Amplify

### API Gateway
- HTTP API, Cognito JWT authorizer
- `POST /chat` — authenticated
- `GET /health` — no auth
- CORS configured for Amplify domain

### Amplify App
- React frontend, Lexend font
- Cognito-authenticated (Amplify Auth)
- Chat UI: multi-turn conversation
- STM managed client-side in React state — last 10–15 turns sent with each request
- No citations displayed

### Short-Term Memory (STM)
- Client-side only — Amplify holds the conversation array in React state
- The frontend sends recent conversation history with each request, limited to the latest 10–15 turns to control token usage and latency
- No long-term memory or server-side conversation store is used

### CloudWatch + Alerts
- Log groups for both Lambdas and API Gateway
- Alarms: guardrail interventions > 5 per 5 min, Lambda errors > 5 per 5 min
- SNS topic for alert notifications

---

## Data Flows

### Document Ingestion
1. Everybody Counts admin uploads PDF / DOCX / PPTX to `s3://bucket/uploads/`
2. S3 event triggers kb-sync Lambda
3. Lambda calls `StartIngestionJob` on the Bedrock KB data source
4. Bedrock extracts text, chunks, embeds with Titan, indexes into OpenSearch
5. Lambda logs job ID to CloudWatch

### Teacher Chat
1. Teacher types a question in the Amplify chat UI
2. Amplify sends `{ userMessage, conversationHistory }` to `POST /chat` with Cognito JWT
3. API Gateway validates JWT
4. chat-handler Lambda retrieves top-k relevant chunks from Bedrock KB
5. Lambda calls Claude Sonnet 4.5 with system prompt + context + STM + user message
6. Guardrails applied — off-topic requests blocked with a friendly redirect message
7. Response returned to Amplify, appended to conversation history in React state

---

## CDK Stack — What Gets Deployed

| Component | Details |
|---|---|
| Cognito User Pool | Email sign-in, no self-signup, admin-managed accounts |
| S3 Bucket | Versioned, encrypted, `/uploads/` prefix, lifecycle 30-day noncurrent |
| kb-sync Lambda | Python 3.12, S3 event trigger, calls StartIngestionJob |
| OpenSearch Serverless | VECTORSEARCH collection, AWS-managed encryption |
| Bedrock Knowledge Base | S3 data source, Titan Embed v2, OpenSearch backend |
| Bedrock Guardrails | Content filters + KS1 math topic policy + PII detection |
| chat-handler Lambda | Python 3.12, 512 MB, 60s timeout, calls KB + Claude |
| API Gateway | HTTP API, Cognito JWT auth, POST /chat + GET /health |
| Amplify App | React/Vite, Lexend font, Cognito auth, chat UI |
| CloudWatch | Log groups for both Lambdas + API GW, alarms, SNS alerts |

---

## Changes from Source Repo (AgentCore QuickStart)

### Removed
- AgentCore Runtime (Docker container agent)
- AgentCore Memory — LTM replaced by client-side STM only
- AgentCore Code Interpreter
- AgentCore Browser
- AgentCore Gateway (MCP)
- `@aws-cdk/aws-bedrock-agentcore-alpha` package
- Tavily web search secret and tool
- `agentcore_agents/` Docker container

### Added
- OpenSearch Serverless collection
- Bedrock Knowledge Base with S3 data source
- kb-sync Lambda (S3 → KB ingestion trigger)
- Amplify App
- Guardrail topic policy (KS1 math scope)

### Modified
- S3 bucket: adds `/uploads/` prefix and S3 event notification
- Cognito: simplified to SRP/email only, removes client credentials OAuth flow
- Lambda: `agentcore-integration` replaced by `chat-handler` (KB retrieve + Claude call)
- API Gateway: REST → HTTP API, `/agent` → `/chat`
- Guardrails: adds topic denial policy for non-math content
- Stack name: `AgentCoreStack` → `EverybodyCountsStack`

---


## Out of Scope (This POC)
- Student-facing interface
- Long-term memory / user profiles
- Citations / source references
- External data retrieval (web, APIs)
- Multi-language support
- Multiple grade bands
- Student PII handling
