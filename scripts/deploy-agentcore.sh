#!/bin/bash

# AgentCore QuickStart - Client Deployment Script
# This script automates the deployment process for client environments

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration variables
CLIENT_NAME=""
AWS_REGION="us-east-1"
ENVIRONMENT="production"
AWS_PROFILE=""
DRY_RUN=false

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to display help
show_help() {
    cat << EOF
AgentCore QuickStart - Client Deployment Script

Usage: ./deploy-agentcore.sh [OPTIONS]

OPTIONS:
    -c, --client-name NAME     Client name (required)
    -r, --region REGION        AWS region (default: us-east-1)
    -e, --environment ENV      Environment (default: production)
    -p, --aws-profile PROFILE  AWS profile to use (required)
    -d, --dry-run             Validate configuration without deploying
    -h, --help                Show this help message

Examples:
    ./deploy-agentcore.sh -c "acme-corp" -p "agentcoreqs"
    ./deploy-agentcore.sh -c "tech-startup" -r "us-west-2" -e "staging" -p "agentcoreqs"
    ./deploy-agentcore.sh -c "enterprise-client" -p "agentcoreqs" --dry-run

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -c|--client-name)
            CLIENT_NAME="$2"
            shift 2
            ;;
        -r|--region)
            AWS_REGION="$2"
            shift 2
            ;;
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -p|--aws-profile)
            AWS_PROFILE="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Validate required parameters
if [[ -z "$CLIENT_NAME" ]]; then
    print_error "Client name is required. Use -c or --client-name"
    exit 1
fi

if [[ -z "$AWS_PROFILE" ]]; then
    print_error "AWS profile is required. Use -p or --aws-profile"
    exit 1
fi

# Create sanitized client name for AWS resources
CLIENT_NAME_CLEAN=$(echo "$CLIENT_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g')

print_status "Starting deployment for client: $CLIENT_NAME"
print_status "Configuration:"
echo "  - Client Name: $CLIENT_NAME"
echo "  - Sanitized Name: $CLIENT_NAME_CLEAN"
echo "  - AWS Region: $AWS_REGION"
echo "  - Environment: $ENVIRONMENT"
echo "  - AWS Profile: $AWS_PROFILE"
echo "  - Dry Run: $DRY_RUN"

# Pre-deployment checks
print_status "Running pre-deployment checks..."

# Check if AWS CLI is installed and configured
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check AWS credentials with profile
if ! aws sts get-caller-identity --profile $AWS_PROFILE &> /dev/null; then
    print_error "AWS credentials not configured for profile '$AWS_PROFILE'. Please run 'aws configure --profile $AWS_PROFILE' first."
    exit 1
fi

# Check if CDK is installed
if ! command -v npx &> /dev/null; then
    print_error "Node.js/npm is not installed. Please install Node.js first."
    exit 1
fi

# Check if AgentCore CLI is installed
if ! command -v agentcore &> /dev/null; then
    print_error "AgentCore CLI is not installed. Please install it first."
    print_status "Install with: pip install bedrock-agentcore"
    exit 1
fi

# Check current directory structure
if [[ ! -f "infra/package.json" ]]; then
    print_error "This script must be run from the AgentCore-Quickstart root directory"
    exit 1
fi

# Check if agent directory exists
if [[ ! -d "agentcore_agents" ]]; then
    print_error "Agent directory 'agentcore_agents' not found."
    exit 1
fi

    # Check if app.py exists
    if [[ ! -f "agentcore_agents/app.py" ]]; then
        print_error "Agent entrypoint 'agentcore_agents/app.py' not found."
        exit 1
    fi

    # Check if Lambda function exists
    if [[ ! -f "functions/agentcore-integration/index.py" ]]; then
        print_error "Lambda function 'functions/agentcore-integration/index.py' not found."
        exit 1
    fi

print_success "Pre-deployment checks passed"

# Check Bedrock model access
print_status "Checking Bedrock model access..."
BEDROCK_MODELS=$(aws bedrock list-foundation-models --region "$AWS_REGION" --profile "$AWS_PROFILE" 2>/dev/null | jq -r '.modelSummaries[].modelId' | head -5)
if [[ -z "$BEDROCK_MODELS" ]]; then
    print_warning "Unable to list Bedrock models. Ensure Bedrock is enabled in region $AWS_REGION"
else
    print_success "Bedrock access verified. Available models found."
fi

# Create client-specific branch
print_status "Creating client-specific Git branch..."
BRANCH_NAME="client-$CLIENT_NAME_CLEAN"

if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    print_warning "Branch $BRANCH_NAME already exists. Switching to it."
    git checkout "$BRANCH_NAME"
else
    git checkout -b "$BRANCH_NAME"
    print_success "Created new branch: $BRANCH_NAME"
fi

# Create deployment outputs directory
OUTPUTS_DIR="client-deployments/$CLIENT_NAME_CLEAN"
mkdir -p "$OUTPUTS_DIR"

if [[ "$DRY_RUN" == "true" ]]; then
    print_warning "DRY RUN MODE - No actual deployment will occur"
    
    # Validate CDK synthesis
    print_status "Validating CDK synthesis..."
    cd infra
    npm install
    npx cdk synth > "../$OUTPUTS_DIR/cloudformation-template.yaml"
    
    print_success "CDK synthesis successful. Template saved to $OUTPUTS_DIR/cloudformation-template.yaml"
    print_status "Dry run completed. No resources were deployed."
    exit 0
fi

# Install dependencies
print_status "Installing Node.js dependencies..."
cd infra
npm install

# Deploy infrastructure
print_status "Deploying AWS infrastructure..."
print_warning "This may take 10-15 minutes..."

DEPLOYMENT_LOG="../$OUTPUTS_DIR/deployment-$(date +%Y%m%d-%H%M%S).log"

# Capture deployment outputs
npx cdk deploy \
    --outputs-file "../$OUTPUTS_DIR/cdk-outputs.json" \
    --require-approval never \
    --profile $AWS_PROFILE \
    2>&1 | tee "$DEPLOYMENT_LOG"

if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
    print_error "CDK deployment failed. Check the log file: $DEPLOYMENT_LOG"
    exit 1
fi

print_success "Infrastructure deployment completed!"

# Extract important values from CDK outputs
if [[ -f "../$OUTPUTS_DIR/cdk-outputs.json" ]]; then
    API_URL=$(jq -r '.AgentCoreQuickStartStack.ApiUrl // empty' "../$OUTPUTS_DIR/cdk-outputs.json")
    BUCKET_NAME=$(jq -r '.AgentCoreQuickStartStack.AgentCoreBucketName // empty' "../$OUTPUTS_DIR/cdk-outputs.json")
    MEMORY_TABLE=$(jq -r '.AgentCoreQuickStartStack.AgentCoreMemoryTableName // empty' "../$OUTPUTS_DIR/cdk-outputs.json")
    TAVILY_SECRET_ARN=$(jq -r '.AgentCoreQuickStartStack.TavilySecretArn // empty' "../$OUTPUTS_DIR/cdk-outputs.json")
        USER_POOL_ID=$(jq -r '.AgentCoreQuickStartStack.UserPoolId // empty' "../$OUTPUTS_DIR/cdk-outputs.json")
        USER_POOL_CLIENT_ID=$(jq -r '.AgentCoreQuickStartStack.UserPoolClientId // empty' "../$OUTPUTS_DIR/cdk-outputs.json")
        USER_POOL_CLIENT_SECRET=$(jq -r '.AgentCoreQuickStartStack.UserPoolClientSecret // empty' "../$OUTPUTS_DIR/cdk-outputs.json")
        RESOURCE_SERVER_ID=$(jq -r '.AgentCoreQuickStartStack.ResourceServerId // empty' "../$OUTPUTS_DIR/cdk-outputs.json")
    
    print_status "Deployment outputs:"
    echo "  - API Gateway URL: $API_URL"
    echo "  - S3 Bucket: $BUCKET_NAME"
    echo "  - Memory Table: $MEMORY_TABLE"
    echo "  - Tavily Secret ARN: $TAVILY_SECRET_ARN"
    echo "  - Cognito User Pool ID: $USER_POOL_ID"
    echo "  - Cognito Client ID: $USER_POOL_CLIENT_ID"
fi

if [[ -z "$API_URL" ]]; then
    print_error "Failed to get API Gateway URL from CDK outputs"
    exit 1
fi

# Deploy agent using official AgentCore CLI
print_status "Deploying AgentCore agent..."
cd ..  # Go back to root directory
cd agentcore_agents

# Check if agentcore_quickstart exists, if not create a new one
print_status "Checking for existing agent configuration..."

# Check if .bedrock_agentcore.yaml exists and contains agentcore_quickstart
if [[ -f ".bedrock_agentcore.yaml" ]] && grep -q "agentcore_quickstart" ".bedrock_agentcore.yaml"; then
    print_status "Found existing agent: agentcore_quickstart"
    
    # Get agent ARN from status
    print_status "Getting agent ARN from status..."
    AGENT_STATUS=$(agentcore status 2>/dev/null)
    if [[ $? -eq 0 ]]; then
        AGENT_ARN=$(echo "$AGENT_STATUS" | grep -o 'arn:aws:bedrock-agentcore:[^[:space:]]*' | head -1)
        if [[ -n "$AGENT_ARN" ]]; then
            print_success "Using existing agent: $AGENT_ARN"
        else
            print_warning "Agent exists but ARN not found, launching agent..."
            LAUNCH_RESULT=$(agentcore launch)
            AGENT_ARN=$(echo "$LAUNCH_RESULT" | grep -o 'arn:aws:bedrock-agentcore:[^[:space:]]*' | head -1)
            if [[ -n "$AGENT_ARN" ]]; then
                print_success "Agent launched successfully: $AGENT_ARN"
            else
                print_error "Failed to get agent ARN after launch"
                exit 1
            fi
        fi
    else
        print_warning "Agent status check failed, launching agent..."
        LAUNCH_RESULT=$(agentcore launch)
        AGENT_ARN=$(echo "$LAUNCH_RESULT" | grep -o 'arn:aws:bedrock-agentcore:[^[:space:]]*' | head -1)
        if [[ -n "$AGENT_ARN" ]]; then
            print_success "Agent launched successfully: $AGENT_ARN"
        else
            print_error "Failed to get agent ARN after launch"
            exit 1
        fi
    fi
else
    # Create new agent with short name (max 48 chars, using client name)
    AGENT_NAME="agentcore_${CLIENT_NAME_CLEAN}"
    print_status "Creating new agent: $AGENT_NAME"
    
    agentcore configure \
        --entrypoint app.py \
        --name "$AGENT_NAME" \
        --region $AWS_REGION
    
    print_status "Launching new agent..."
    LAUNCH_RESULT=$(agentcore launch)
    AGENT_ARN=$(echo "$LAUNCH_RESULT" | grep -o 'arn:aws:bedrock-agentcore:[^[:space:]]*' | head -1)
    
    if [[ -z "$AGENT_ARN" ]]; then
        print_error "Failed to get agent ARN from launch result"
        print_error "Launch result: $LAUNCH_RESULT"
        exit 1
    fi
    
    print_success "Agent created and launched successfully: $AGENT_ARN"
fi

    # Update Lambda environment with AgentCore Runtime ARN
    print_status "Updating Lambda environment with AgentCore Runtime ARN..."
    aws lambda update-function-configuration \
        --function-name "agentcore-integration" \
        --environment Variables="{AGENTCORE_RUNTIME_ARN=$AGENT_ARN,REGION=$AWS_REGION}" \
        --profile $AWS_PROFILE \
        --region $AWS_REGION > /dev/null

    if [[ $? -eq 0 ]]; then
        print_success "Lambda environment updated with AgentCore Runtime ARN"
    else
        print_warning "Failed to update Lambda environment. You may need to update it manually."
    fi

    cd ..

    # Save deployment info to client directory
    echo "{
      \"client_name\": \"$CLIENT_NAME\",
      \"aws_profile\": \"$AWS_PROFILE\",
      \"region\": \"$AWS_REGION\",
      \"environment\": \"$ENVIRONMENT\",
      \"agent_name\": \"agentcore-quickstart-$CLIENT_NAME_CLEAN\",
      \"agent_arn\": \"$AGENT_ARN\",
      \"api_url\": \"$API_URL\",
      \"s3_bucket\": \"$BUCKET_NAME\",
      \"tavily_secret_arn\": \"$TAVILY_SECRET_ARN\",
      \"user_pool_id\": \"$USER_POOL_ID\",
      \"user_pool_client_id\": \"$USER_POOL_CLIENT_ID\",
      \"user_pool_client_secret\": \"$USER_POOL_CLIENT_SECRET\",
      \"resource_server_id\": \"$RESOURCE_SERVER_ID\",
      \"deployment_time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }" > "$OUTPUTS_DIR/deployment-info.json"

# Generate client handoff documentation
print_status "Generating client documentation..."

cat > "$OUTPUTS_DIR/client-handoff-summary.md" << EOF
# $CLIENT_NAME - AgentCore QuickStart Deployment Summary

## Deployment Information
- **Client Name**: $CLIENT_NAME
- **Deployment Date**: $(date)
- **AWS Region**: $AWS_REGION
- **Environment**: $ENVIRONMENT
- **AWS Profile**: $AWS_PROFILE

## Resources Created
- **API Gateway URL**: $API_URL
- **S3 AgentCore Bucket**: $BUCKET_NAME
- **Memory Table**: $MEMORY_TABLE
- **Tavily Secret ARN**: $TAVILY_SECRET_ARN
- **Cognito User Pool ID**: $USER_POOL_ID
- **Cognito Client ID**: $USER_POOL_CLIENT_ID
- **Cognito Client Secret**: $USER_POOL_CLIENT_SECRET
- **Resource Server ID**: $RESOURCE_SERVER_ID
- **AgentCore Agent ARN**: $AGENT_ARN

## Multi-Agent Workflow
This deployment includes a multi-agent workflow with:
- **Research Agent**: Specialized in web research and information gathering
- **Analysis Agent**: Specialized in data analysis and insights generation  
- **Coordinator Agent**: Orchestrates multiple agents for complex workflows

## Authentication Setup

### 1. Get Access Token
\`\`\`bash
# Get access token using client credentials
curl -X POST https://cognito-idp.$AWS_REGION.amazonaws.com/ \\
  -H "Content-Type: application/x-amz-json-1.1" \\
  -H "X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth" \\
  -d '{
    "AuthFlow": "USER_PASSWORD_AUTH",
    "ClientId": "$USER_POOL_CLIENT_ID",
    "AuthParameters": {
      "USERNAME": "your-username",
      "PASSWORD": "your-password"
    }
  }'
\`\`\`

### 2. Test Agent API
\`\`\`bash
# Test the agent endpoint
curl -X POST $API_URL/agent \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  -d '{"prompt": "Research the latest trends in AI and provide analysis"}'
\`\`\`

### 3. Frontend Integration Example
\`\`\`javascript
// Example frontend integration
    const API_BASE_URL = '$API_URL';
    const USER_POOL_ID = '$USER_POOL_ID';
    const CLIENT_ID = '$USER_POOL_CLIENT_ID';
    const CLIENT_SECRET = '$USER_POOL_CLIENT_SECRET';
    const RESOURCE_SERVER_ID = '$RESOURCE_SERVER_ID';

// Authenticate user
const authenticateUser = async (username, password) => {
  const response = await fetch(\`https://cognito-idp.$AWS_REGION.amazonaws.com/\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password
      }
    })
  });
  return response.json();
};

// Call agent API
const callAgent = async (prompt, accessToken) => {
  const response = await fetch(\`\${API_BASE_URL}/agent\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${accessToken}\`
    },
    body: JSON.stringify({ prompt })
  });
  return response.json();
};
\`\`\`

## AgentCore Features
- **Memory Management**: Short-term and long-term memory with AgentCore Memory
- **Tool Integration**: Tavily search and other tools available
- **Session Management**: Persistent conversation context
- **Multi-Agent Orchestration**: LLM-based agent coordination
- **Observability**: Full monitoring and debugging capabilities

## Next Steps
1. Create Cognito users for client team members
2. Test the multi-agent workflow with sample queries
3. Configure custom tools and agents as needed
4. Set up monitoring and alerting
5. Train client team on AgentCore API usage

## Support Information
- **Deployment Log**: deployment-$(date +%Y%m%d-%H%M%S).log
- **CDK Outputs**: cdk-outputs.json
- **CloudFormation Template**: cloudformation-template.yaml

For detailed setup instructions, see:
- [AgentCore QuickStart Guide](../../AGENTCORE_QUICKSTART.md)
- [Client Deployment Guide](../../docs/client-deployment-guide.md)
- [AgentCore Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore.html)
EOF

# Test the deployment
print_status "Testing deployment..."
TEST_RESPONSE=$(curl -s "$API_URL/test")

if echo "$TEST_RESPONSE" | grep -q "AgentCore QuickStart API is running"; then
    print_success "Deployment test successful"
else
    print_warning "Deployment test returned unexpected response: $TEST_RESPONSE"
fi

# Create basic monitoring script
cat > "$OUTPUTS_DIR/monitor-deployment.sh" << 'EOF'
#!/bin/bash

# Basic monitoring script for the AgentCore deployment
echo "=== AgentCore QuickStart Deployment Health Check ==="
echo "Date: $(date)"
echo ""

# Check API Gateway health
if [[ -n "$API_URL" ]]; then
    echo "Testing API Gateway..."
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/sessions" -H "Content-Type: application/json" -d '{"agent_id": "multi_agent_workflow"}')
    if [[ "$HTTP_STATUS" == "401" || "$HTTP_STATUS" == "200" ]]; then
        echo "✅ API Gateway: HEALTHY (HTTP $HTTP_STATUS)"
    else
        echo "⚠️  API Gateway: HTTP $HTTP_STATUS"
    fi
fi

# Check DynamoDB tables
if [[ -n "$MEMORY_TABLE" ]]; then
    echo "Checking Memory Table..."
    aws dynamodb describe-table --table-name "$MEMORY_TABLE" > /dev/null 2>&1 && echo "✅ Memory Table: HEALTHY" || echo "❌ Memory Table: UNHEALTHY"
fi

# Check S3 bucket
if [[ -n "$BUCKET_NAME" ]]; then
    echo "Checking S3 bucket..."
    aws s3 ls "s3://$BUCKET_NAME" > /dev/null 2>&1 && echo "✅ S3 Bucket: HEALTHY" || echo "❌ S3 Bucket: UNHEALTHY"
fi

# Check Cognito User Pool
if [[ -n "$USER_POOL_ID" ]]; then
    echo "Checking Cognito User Pool..."
    aws cognito-idp describe-user-pool --user-pool-id "$USER_POOL_ID" > /dev/null 2>&1 && echo "✅ Cognito User Pool: HEALTHY" || echo "❌ Cognito User Pool: UNHEALTHY"
fi

echo ""
echo "For detailed logs, check CloudWatch: https://console.aws.amazon.com/cloudwatch/"
echo "For AgentCore management, visit: https://console.aws.amazon.com/bedrock/"
EOF

chmod +x "$OUTPUTS_DIR/monitor-deployment.sh"

# Final success message
print_success "Deployment completed successfully!"
print_status "Client handoff documentation created in: $OUTPUTS_DIR/"
print_status "Files generated:"
echo "  - client-handoff-summary.md"
echo "  - cdk-outputs.json"
echo "  - deployment-$(date +%Y%m%d-%H%M%S).log"
echo "  - monitor-deployment.sh"

print_status "Next steps:"
echo "1. Review the client handoff documentation"
echo "2. Create Cognito users for client team members"
echo "3. Test the multi-agent workflow with sample queries"
echo "4. Configure custom tools and agents as needed"
echo "5. Set up monitoring and alerting"
echo "6. Schedule client training session on AgentCore usage"

cd ..
print_success "Ready for client handoff! 🚀"