# Bedrock AgentCore QuickStart

Production-ready CDK boilerplate deploying ALL AgentCore components in a single command.

## What's Included

| Component | Type | Description |
|-----------|------|-------------|
| Runtime | L2 | Strands agent with Guardrails, Dockerfile-based (ARM64) |
| Memory | L2 | STM + LTM with Semantic, Summarization, and UserPreference strategies |
| Gateway | L2 | MCP endpoint for agent-to-agent communication, Cognito auth, no targets (dev adds own) |
| Code Interpreter | L2 | Sandboxed Python/JS/TS execution |
| Browser | L2 | Managed Chrome with S3 session recording |
| Guardrail | L1 | Content filters (sexual, violence, hate, insults, misconduct, prompt attack) + PII detection (email anonymize, SSN/CC block) |
| CloudTrail | - | API audit logging to S3 + CloudWatch |
| API Gateway + Lambda | - | Human-facing REST API with Cognito auth, throttling, CORS |
| Cognito | - | Shared auth pool (API Gateway + Gateway), client credentials flow |
| S3 | - | Versioned bucket for artifacts, browser recordings, CloudTrail logs |
| CloudWatch | - | Log groups for API Gateway, Lambda; SNS alert topic |
| Secrets Manager | - | Tavily API key (placeholder, update post-deploy) |
| Observability | - | OTEL env vars configured on Runtime (AWS distro) |
| Policy | - | Post-deploy setup: Cedar authorization on Gateway |

## Prerequisites

- AWS CLI configured with credentials
- Node.js 18+ and npm
- Python 3.12+
- Docker (running -- required for Runtime container build)
- AWS CDK v2

## Quick Start

```bash
# 1. Clone and enter
git clone <repo> && cd Agentic-AI-Quickstart

# 2. Deploy everything (5-10 min, handles bootstrap + CDK + Docker build)
./scripts/deploy-agentcore.sh -p <your-aws-profile>

# 3. Optional: Enable web search by setting your Tavily API key
aws secretsmanager put-secret-value \
  --secret-id agentcore/tavily-api-key \
  --secret-string '{"api_key":"YOUR_KEY"}' \
  --profile <your-aws-profile>
```

The deploy script runs pre-flight checks, installs CDK deps, bootstraps if needed, deploys the stack, and runs a health check. Outputs are saved to `cdk-outputs.json`.

For post-deploy setup (Observability, Cedar Policy on Gateway):

```bash
AWS_PROFILE=<your-aws-profile> bash scripts/post-deploy.sh
```

## Project Structure

```
agentcore_agents/
├── app.py                  # Strands agent (Guardrails, Memory, tools)
├── Dockerfile              # ARM64 container for Runtime
├── requirements.txt        # Python deps
└── tools/                  # Custom tool implementations
functions/
└── agentcore-integration/
    └── index.py            # Lambda bridge (API GW -> Runtime)
infra/
├── bin/infra.ts            # CDK app entry
├── lib/agentcore-stack.ts  # All AgentCore components (single stack)
└── package.json
scripts/
├── deploy-agentcore.sh     # One-command deploy
└── post-deploy.sh          # Observability + Policy setup
```

## Configuration

Key environment variables set on Runtime (configured in `agentcore-stack.ts`):

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Bedrock model ID |
| `MEMORY_ID` | Set by CDK | AgentCore Memory resource ID |
| `GUARDRAIL_ID` | Set by CDK | Bedrock Guardrail ID |
| `GUARDRAIL_VERSION` | Set by CDK | Bedrock Guardrail version |
| `CODE_INTERPRETER_ID` | Set by CDK | AgentCore Code Interpreter ID |
| `BROWSER_ID` | Set by CDK | AgentCore Browser ID |
| `GATEWAY_URL` | Set by CDK | AgentCore Gateway MCP endpoint URL |
| `AGENT_OBSERVABILITY_ENABLED` | `true` | OTEL tracing toggle |

## Testing the Agent

### 1. Get a Cognito token

```bash
# Grab client ID and user pool ID from stack outputs
CLIENT_ID=$(jq -r '.AgentCoreQuickStartStack.UserPoolClientId' cdk-outputs.json)
POOL_ID=$(jq -r '.AgentCoreQuickStartStack.UserPoolId' cdk-outputs.json)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile <profile>)

# Get token (client_credentials flow)
TOKEN=$(curl -s -X POST \
  "https://agentcore-qs-${ACCOUNT_ID}.auth.us-east-1.amazoncognito.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=<CLIENT_SECRET>&scope=agentcore-quickstart-api/read agentcore-quickstart-api/write" \
  | jq -r '.access_token')
```

### 2. Invoke the agent

```bash
API_URL=$(jq -r '.AgentCoreQuickStartStack.ApiUrl' cdk-outputs.json)

curl -X POST "${API_URL}agent" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{"prompt": "What time is it?", "sessionId": "test-001"}'
```

### 3. Health check (no auth)

```bash
curl -s "${API_URL}"
```

## Adding Tools

1. Define a `@tool` function in `agentcore_agents/app.py` (or a file in `agentcore_agents/tools/`):

```python
from strands.tools import tool

@tool
def my_tool(query: str) -> str:
    """Description of what this tool does."""
    # implementation
    return result
```

2. Add it to the `tools` list in `_ensure_initialized()`.
3. If the tool needs AWS permissions, add IAM grants in `agentcore-stack.ts`.
4. Redeploy: `./scripts/deploy-agentcore.sh -p <profile>`

## Adding Gateway Targets

The Gateway deploys with no targets. Add your own via the CDK stack or AWS console:

- **OpenAPI target** -- expose an existing REST API as tools
- **MCP Server target** -- connect to a remote MCP server
- **API Gateway target** -- route to another API Gateway

No Lambda is needed. See the [Gateway targets documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-supported-targets.html).

After adding targets, set up Cedar policies via `scripts/post-deploy.sh` to authorize access.

## Cleanup

```bash
cd infra && npx cdk destroy --profile <your-aws-profile>
```

This removes all deployed resources. S3 bucket has `RemovalPolicy.DESTROY` with `autoDeleteObjects` enabled.
