# Deployment Guide

## One-Command Deploy

```bash
./scripts/deploy-agentcore.sh -p <your-aws-profile>
```

This runs:
1. Pre-flight checks (AWS CLI, Docker, Node.js, credentials)
2. CDK bootstrap (if version < 30)
3. `npm install` for CDK dependencies
4. TypeScript compilation
5. Docker image build (ARM64 container for Runtime)
6. `cdk deploy` (CloudFormation stack creation)
7. API health check

Outputs are saved to `cdk-outputs.json`.

### Options

```bash
./scripts/deploy-agentcore.sh -p <profile>              # Deploy
./scripts/deploy-agentcore.sh -p <profile> -r us-west-2  # Different region
./scripts/deploy-agentcore.sh -p <profile> --dry-run      # Synth only
```

## Manual Deploy

```bash
cd infra
npm install
npx tsc
npx cdk deploy --require-approval never --profile <profile>
```

## Post-Deploy Setup

```bash
AWS_PROFILE=<profile> bash scripts/post-deploy.sh
```

This displays stack outputs and provides instructions for:
- Enabling CloudWatch Transaction Search (OTEL traces)
- Setting up AgentCore Policy (Cedar authorization on Gateway)

### Tavily Web Search (Optional)

The agent works without Tavily. To enable web search:

```bash
aws secretsmanager put-secret-value \
  --secret-id agentcore/tavily-api-key \
  --secret-string '{"api_key":"YOUR_TAVILY_KEY"}' \
  --profile <profile>
```

Get a key at https://tavily.com/

## What Gets Deployed

### AgentCore Components

| Resource | CloudFormation Type | Purpose |
|----------|-------------------|---------|
| Runtime | `AWS::BedrockAgentCore::Runtime` | Agent compute (Firecracker microVM, ARM64 container) |
| Memory | `AWS::BedrockAgentCore::Memory` | STM + LTM with 3 extraction strategies |
| Gateway | `AWS::BedrockAgentCore::Gateway` | MCP endpoint for agent-to-agent (no targets — add your own) |
| Code Interpreter | `AWS::BedrockAgentCore::CodeInterpreterCustom` | Sandboxed code execution |
| Browser | `AWS::BedrockAgentCore::BrowserCustom` | Managed Chrome with S3 recording |

### Bedrock

| Resource | Type | Purpose |
|----------|------|---------|
| Guardrail | `AWS::Bedrock::Guardrail` | Content filters + PII detection |
| Guardrail Version | `AWS::Bedrock::GuardrailVersion` | Pinned guardrail version |

### Infrastructure

| Resource | Purpose |
|----------|---------|
| API Gateway | REST API with Cognito auth, CORS, throttling (100 RPS) |
| Lambda | Bridge: API GW -> Runtime invocation |
| Cognito User Pool | Shared auth (API GW + Gateway), client credentials flow |
| Cognito Domain | OAuth token endpoint |
| S3 Bucket | Artifacts, browser recordings, CloudTrail logs |
| CloudTrail | API audit logging |
| CloudWatch | Log groups, metric filters, alarms |
| SNS Topic | Alert notifications |
| Secrets Manager | Tavily API key |

## Authentication Flow

```
Client App
    |
    v
Cognito (client_credentials grant)
    |
    v  Bearer token
API Gateway (validates token, requires write scope)
    |
    v
Lambda (IAM invokes Runtime)
    |
    v
AgentCore Runtime (processes request)
```

### Getting a Token

```bash
# From cdk-outputs.json
CLIENT_ID=<UserPoolClientId>
POOL_ID=<UserPoolId>
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile <profile>)

# Get client secret
CLIENT_SECRET=$(aws cognito-idp describe-user-pool-client \
  --user-pool-id $POOL_ID --client-id $CLIENT_ID \
  --profile <profile> --query "UserPoolClient.ClientSecret" --output text)

# Get token
curl -s -X POST \
  "https://agentcore-qs-${ACCOUNT_ID}.auth.us-east-1.amazoncognito.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=client_credentials&scope=agentcore-quickstart-api/read agentcore-quickstart-api/write"
```

## Changing the Model

Default model is Claude Haiku 4.5. Change via CDK env var in `infra/lib/agentcore-stack.ts`:

```typescript
MODEL_ID: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
```

Or override at deploy time by modifying the `environmentVariables` block. Make sure the model is enabled in your account's Bedrock model access.

## Updating the Agent Code

1. Edit `agentcore_agents/app.py`
2. Redeploy: `./scripts/deploy-agentcore.sh -p <profile>`

CDK rebuilds the Docker image and creates a new Runtime version. Existing sessions continue on the old version; new sessions use the updated code.

## Cleanup

```bash
cd infra && npx cdk destroy --force --profile <profile>
```

If Cognito User Pool deletion fails (domain exists), delete the domain first:

```bash
aws cognito-idp delete-user-pool-domain \
  --user-pool-id <pool-id> \
  --domain agentcore-qs-<account-id> \
  --profile <profile>

# Then retry destroy
npx cdk destroy --force --profile <profile>
```

## Troubleshooting

### "Runtime initialization time exceeded" (30s timeout)

The Docker image is too heavy. Keep `requirements.txt` lean — avoid large packages like `playwright` in requirements (the Strands tool wrappers handle their own deps lazily).

### "AccessDeniedException" on model invocation

The model isn't enabled in your account. Go to Bedrock Console > Model access > Enable the model. Or change `MODEL_ID` to an enabled model.

### API Gateway returns "Unauthorized"

Cognito token expired (1 hour TTL) or wrong scope. Re-fetch the token.

### "Agent artifact type cannot be updated"

Can't switch between `fromCodeAsset` and `fromAsset` on an existing Runtime. Destroy and redeploy.
