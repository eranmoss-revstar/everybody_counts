#!/usr/bin/env bash
# Post-deploy steps for AgentCore QuickStart.
# Run after: cd infra && npx cdk deploy
set -euo pipefail

STACK_NAME="AgentCoreQuickStartStack"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-}"

AWS_OPTS="--region $REGION"
if [ -n "$PROFILE" ]; then
  AWS_OPTS="$AWS_OPTS --profile $PROFILE"
fi

echo "=========================================="
echo " AgentCore QuickStart — Post-Deploy Setup"
echo "=========================================="
echo ""

# 1. Fetch and display stack outputs
echo "[1/4] Stack Outputs"
echo "-------------------"
OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[*].{Key:OutputKey,Value:OutputValue}" \
  --output table $AWS_OPTS 2>/dev/null || echo "")

if [ -z "$OUTPUTS" ]; then
  echo "  Stack '$STACK_NAME' not found. Deploy first:"
  echo "  cd infra && npx cdk deploy"
  exit 1
fi

echo "$OUTPUTS"
echo ""

# Extract key values
API_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text $AWS_OPTS 2>/dev/null || echo "N/A")

GATEWAY_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='GatewayUrl'].OutputValue" \
  --output text $AWS_OPTS 2>/dev/null || echo "N/A")

GATEWAY_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='GatewayId'].OutputValue" \
  --output text $AWS_OPTS 2>/dev/null || echo "N/A")

echo "Quick Access:"
echo "  REST API (human):    $API_URL"
echo "  MCP Gateway (agent): $GATEWAY_URL"
echo ""

# 2. Tavily API key reminder
echo "[2/4] Update Tavily API Key"
echo "---------------------------"
echo "  The deployed secret has a placeholder value."
echo "  Update it with your real Tavily API key:"
echo ""
echo "  aws secretsmanager put-secret-value \\"
echo "    --secret-id agentcore/tavily-api-key \\"
echo "    --secret-string '{\"api_key\": \"YOUR_REAL_TAVILY_KEY\"}' \\"
echo "    --region $REGION"
echo ""
echo "  Get a key at: https://tavily.com/"
echo ""

# 3. Observability setup
echo "[3/4] Enable CloudWatch Transaction Search"
echo "-------------------------------------------"
echo "  Required for OTEL traces from AgentCore Runtime."
echo ""
echo "  Steps:"
echo "  1. Open CloudWatch Console: https://$REGION.console.aws.amazon.com/cloudwatch/home?region=$REGION"
echo "  2. Go to Settings > Transaction Search"
echo "  3. Click 'Enable Transaction Search'"
echo "  4. After enabling, traces appear under:"
echo "     CloudWatch > X-Ray traces > Traces"
echo ""

# 4. Policy (Cedar authorization on Gateway)
echo "[4/4] AgentCore Policy Setup"
echo "----------------------------"
echo "  Policy requires Gateway association via API (not available in CloudFormation)."
echo "  Follow these steps to set up Cedar authorization on your Gateway:"
echo ""
echo "  Step 1: Create a Policy Engine"
echo "    python3 -c \""
echo "import boto3"
echo "client = boto3.client('bedrock-agentcore-control', region_name='$REGION')"
echo "engine = client.create_policy_engine(name='agentcore_quickstart_policy_engine', description='Cedar policy engine')"
echo "print('PolicyEngine ARN:', engine['policyEngineArn'])"
echo "print('PolicyEngine ID:', engine['policyEngineId'])"
echo "\""
echo ""
echo "  Step 2: Create a Cedar policy (replace POLICY_ENGINE_ID)"
echo "    python3 -c \""
echo "import boto3"
echo "client = boto3.client('bedrock-agentcore-control', region_name='$REGION')"
echo "client.create_policy("
echo "    policyEngineId='POLICY_ENGINE_ID',"
echo "    name='allow_all_tools',"
echo "    definition={'cedar': {'statement': 'permit(principal, action, resource == AgentCore::Gateway::\"arn:aws:bedrock-agentcore:$REGION:$(aws sts get-caller-identity --query Account --output text $AWS_OPTS):gateway/$GATEWAY_ID\");'}},"
echo "    validationMode='IGNORE_ALL_FINDINGS'"
echo ")"
echo "print('Policy created')"
echo "\""
echo ""
echo "  Step 3: Associate Policy Engine with Gateway (replace POLICY_ENGINE_ARN)"
echo "    python3 -c \""
echo "import boto3"
echo "client = boto3.client('bedrock-agentcore-control', region_name='$REGION')"
echo "client.update_gateway("
echo "    gatewayIdentifier='$GATEWAY_ID',"
echo "    policyEngineConfiguration={'arn': 'POLICY_ENGINE_ARN', 'mode': 'ENFORCE'}"
echo ")"
echo "print('Policy Engine associated with Gateway')"
echo "\""
echo ""
echo "  Docs: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-getting-started.html"
echo ""

echo "=========================================="
echo " Post-deploy complete!"
echo "=========================================="
