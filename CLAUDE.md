# Everybody Counts — AgentCore QuickStart

## AWS Profile

**All AWS operations must use the `everybody-counts` profile.**

- Always pass `--profile everybody-counts` to every `aws` CLI command
- Always pass `--profile everybody-counts` to every `cdk` command
- Set `AWS_PROFILE=everybody-counts` when running scripts that use boto3 or the AWS SDK
- Never use the `default` profile or any other profile for this project
- If a command would affect AWS and no profile is specified, stop and add `--profile everybody-counts` before running

### Examples

```bash
# CDK deploy
npx cdk deploy --profile everybody-counts

# CDK bootstrap
npx cdk bootstrap --profile everybody-counts

# AWS CLI
aws sts get-caller-identity --profile everybody-counts
aws secretsmanager put-secret-value --secret-id agentcore/tavily-api-key --secret-string '...' --profile everybody-counts

# Deploy script
./scripts/deploy-agentcore.sh -p everybody-counts
```

## Git Commits

**Commits must show only the human author (eranmoss-revstar).**

- Never add `Co-Authored-By` trailers of any kind
- Never mention AI tools in commit messages or descriptions

## CDK is the Single Source of Truth

**All AWS infrastructure and code must be deployed through CDK. Never use the AWS console or CLI to create, modify, or delete AWS resources.**

- Every resource (Lambda, S3, Cognito, Bedrock KB, OpenSearch, API Gateway, Guardrails, IAM, etc.) must exist in `infra/lib/`
- If a new service or resource is needed, add it to the CDK stack first, then deploy
- If a resource is changed (config, permissions, env vars, **or Lambda code**), update and run CDK deploy — never patch it directly with `aws lambda update-function-code` or equivalent CLI shortcuts
- If a resource is removed, remove it from the CDK stack and redeploy — never delete it manually
- The CDK stack is always kept in sync with what is deployed; if they drift, CDK wins
- Console access is read-only (for observability/debugging only)

### Deploying changes

```bash
# Deploy everything (Lambda code + infra + AgentCore container)
cd infra && npx cdk deploy --profile everybody-counts

# Or use the deploy script (also rebuilds the AgentCore Docker image)
./scripts/deploy-agentcore.sh -p everybody-counts
```

Lambda functions (`functions/agentcore-integration/`, `functions/chat-handler/`, `functions/kb-sync/`) are packaged by CDK via `Code.fromAsset()` — editing the source file and running `cdk deploy` is all that is needed. Do not use `aws lambda update-function-code`.

## Project Overview

RAG-based math teaching assistant for UK KS1 (Grade 1–2) teachers, built on AWS Bedrock. See `docs/everybody-counts-implementation-plan.md` for the full architecture.

- **Repository:** `/home/eranmoss/Everybodt_counts/Bedrock-AgentCore-QuickStart`
- **AWS account:** `111974299507` (us-east-1)
- **CDK stack name:** `EverybodyCountsStack`
- **Infra:** CDK TypeScript in `infra/` — single stack in `infra/lib/agentcore-stack.ts`
- **Lambdas:** `functions/chat-handler/` (RAG + Claude), `functions/kb-sync/` (S3 → KB ingestion)
- **Frontend:** Amplify React app (to be added)
- **Scripts:** `scripts/deploy-agentcore.sh` (deploy), `scripts/post-deploy.sh` (post-deploy setup)

> Note: `agentcore_agents/` and `functions/agentcore-integration/` are legacy boilerplate being replaced — do not extend them.
