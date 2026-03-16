# Architecture

## Overview

Single CDK stack deploying all AWS Bedrock AgentCore components with two entry points: a REST API for human consumers and an MCP Gateway for agent consumers.

```
Human (Web/Mobile)                     Agent (MCP Client)
       |                                       |
       v                                       v
   API Gateway                         AgentCore Gateway
   (Cognito auth)                      (Cognito M2M, MCP protocol)
       |                                       |
       v                                       |
   Lambda Bridge -----> AgentCore Runtime <-----+
                            |
                            |--- Memory (STM + LTM)
                            |--- Code Interpreter
                            |--- Browser
                            |--- Guardrails (on model)
                            |--- OTEL traces -> CloudWatch
                            |
                            v
                     Bedrock Foundation Models
                     (Claude Haiku 4.5 default)
```

## AgentCore Components

### Runtime

- **Type:** L2 construct (`agentcore.Runtime`)
- **Artifact:** Docker image built from `agentcore_agents/Dockerfile` (ARM64)
- **Auth:** IAM (Lambda invokes via `grantInvokeRuntime`)
- **Protocol:** HTTP
- **Lifecycle:** 15-min idle timeout, 8-hour max session lifetime
- **Isolation:** Each session runs in a dedicated Firecracker microVM

The Runtime hosts the Strands agent (`app.py`) which lazy-initializes on first invocation to stay within the 30s init timeout.

### Memory

- **Type:** L2 construct (`agentcore.Memory`)
- **STM:** Conversation context within a session (auto-managed by `AgentCoreMemorySessionManager`)
- **LTM:** Three extraction strategies run automatically:
  - **Semantic** — extracts factual information
  - **Summarization** — generates conversation summaries
  - **UserPreference** — captures user preferences and patterns
- **Expiration:** 90 days
- **Agent integration:** Strands-native `AgentCoreMemorySessionManager` (context manager)

### Gateway

- **Type:** L2 construct (`agentcore.Gateway`)
- **Protocol:** MCP with semantic tool discovery
- **Auth:** Cognito (shared User Pool)
- **Targets:** None deployed (developer adds their own)
- **Target types available:** OpenAPI, MCP Server, API Gateway, Smithy (no Lambda needed)

The Gateway is a connector to external systems. Tools that the agent executes directly (calculator, time, web search) live inside the Runtime, not behind the Gateway.

### Code Interpreter

- **Type:** L2 construct (`agentcore.CodeInterpreterCustom`)
- **Network:** Public (PyPI access for package installation)
- **Languages:** Python, JavaScript, TypeScript
- **Isolation:** Each session in a Firecracker microVM
- **Agent integration:** Strands wrapper `AgentCoreCodeInterpreter` (loaded if `CODE_INTERPRETER_ID` is set)

### Browser

- **Type:** L2 construct (`agentcore.BrowserCustom`)
- **Network:** Public
- **Recording:** Enabled, stored to S3 (`browser-recordings/` prefix)
- **Agent integration:** Strands wrapper `AgentCoreBrowser` (loaded if `BROWSER_ID` is set)

### Guardrail

- **Type:** L1 construct (`bedrock.CfnGuardrail`)
- **Content filters:** Sexual, violence, hate, insults, misconduct (HIGH/HIGH), prompt attack (HIGH input / NONE output)
- **PII detection:** Email (anonymize), SSN (block), credit card (block)
- **Agent integration:** Applied at model level via `BedrockModel(guardrail_id=..., guardrail_version=...)`

### Policy

- **Not deployed via CDK** — requires Gateway association via API (not available in CloudFormation)
- **Setup:** Post-deploy script creates PolicyEngine, Cedar policies, and Gateway association
- **Purpose:** Deterministic authorization on Gateway tool invocations (Cedar permit/forbid rules)

### Observability

- **Not a CDK construct** — configured via environment variables on Runtime
- **OTEL:** `AGENT_OBSERVABILITY_ENABLED=true`, `OTEL_PYTHON_DISTRO=aws_distro`
- **Traces:** CloudWatch > X-Ray traces (requires enabling Transaction Search post-deploy)
- **Logs:** CloudWatch log groups for Runtime, Lambda, API Gateway

## API Layer

### REST API (Human-Facing)

```
Cognito -> API Gateway -> Lambda -> Runtime
```

- **GET /** — Health check (no auth)
- **POST /agent** — Agent invocation (Cognito auth, write scope required)
- **Throttling:** 100 RPS, 200 burst
- **CORS:** All origins (configurable)

### MCP Gateway (Agent-Facing)

```
MCP Client -> Gateway (MCP protocol) -> External API targets
```

- Agents connect via `streamablehttp_client` with Cognito Bearer token
- Gateway discovers and exposes tools from connected targets
- Semantic search across all tool descriptions

## IAM Permissions

The Runtime execution role has:

| Permission | Resource | Purpose |
|-----------|----------|---------|
| `bedrock:InvokeModel` | All foundation models + inference profiles | LLM invocation |
| `bedrock:ApplyGuardrail` | Deployed guardrail | Content safety |
| `bedrock-agentcore:*Memory*` | Memory resource | STM/LTM read/write |
| `bedrock-agentcore:*CodeInterpreter*` | Code Interpreter resource | Code execution |
| `bedrock-agentcore:*Browser*` | Browser resource | Web automation |
| `secretsmanager:GetSecretValue` | Tavily secret | Web search API key |

The Lambda execution role has:
- `bedrock-agentcore:InvokeAgentRuntime` on the Runtime

## Data Flow

### Agent Invocation

1. Client sends `{"prompt": "...", "sessionId": "...", "actorId": "..."}` to `POST /agent`
2. API Gateway validates Cognito token
3. Lambda forwards to Runtime via `invoke_agent_runtime()`
4. Runtime lazy-initializes agent (first call only):
   - Fetches Tavily key from Secrets Manager
   - Creates Strands Agent with BedrockModel + Guardrails + tools
5. If Memory is configured:
   - Creates `AgentCoreMemorySessionManager` for the session
   - Agent has access to STM (recent turns) and LTM (extracted insights)
6. Agent processes prompt, optionally calling tools
7. Memory session stores the conversation turn (LTM extraction is automatic)
8. Response returned through Lambda -> API Gateway -> Client

### Tool Invocation

Tools are `@tool` decorated Python functions inside the Runtime:

```python
@tool
def calculator(expression: str) -> str:
    """Evaluate a math expression."""
    ...
```

The LLM decides when to call tools based on the user's prompt. Code Interpreter and Browser are loaded as Strands wrappers that call the external AgentCore services via SDK.

## Infrastructure

| Resource | Configuration |
|----------|--------------|
| S3 Bucket | Versioned, encrypted, auto-delete, 30-day noncurrent retention |
| CloudTrail | Single-region, logs to S3 + CloudWatch |
| CloudWatch | Log groups (API GW, Lambda), metric filters, alarms (5xx errors) |
| SNS | Alert topic (no subscriptions by default) |
| Cognito | User Pool with domain, client credentials flow, read/write scopes |
