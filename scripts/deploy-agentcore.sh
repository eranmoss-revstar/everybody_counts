#!/bin/bash

# AgentCore QuickStart - Deployment Script
# Wraps CDK deploy + post-deploy steps into a single command

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Configuration
AWS_REGION="us-east-1"
AWS_PROFILE=""
DRY_RUN=false
STACK_NAME="AgentCoreQuickStartStack"

show_help() {
    cat << EOF
AgentCore QuickStart - Deployment Script

Usage: ./scripts/deploy-agentcore.sh [OPTIONS]

OPTIONS:
    -p, --profile PROFILE   AWS profile to use (required)
    -r, --region REGION     AWS region (default: us-east-1)
    -d, --dry-run           Validate and synth only, no deploy
    -h, --help              Show this help message

Examples:
    ./scripts/deploy-agentcore.sh -p agentcoreqs
    ./scripts/deploy-agentcore.sh -p agentcoreqs -r us-west-2
    ./scripts/deploy-agentcore.sh -p agentcoreqs --dry-run

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--profile) AWS_PROFILE="$2"; shift 2 ;;
        -r|--region) AWS_REGION="$2"; shift 2 ;;
        -d|--dry-run) DRY_RUN=true; shift ;;
        -h|--help) show_help; exit 0 ;;
        *) print_error "Unknown option: $1"; show_help; exit 1 ;;
    esac
done

if [[ -z "$AWS_PROFILE" ]]; then
    print_error "AWS profile is required. Use -p or --profile"
    exit 1
fi

# Find project root (script may be called from any directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo " AgentCore QuickStart — Deploy"
echo "=========================================="
echo ""
print_status "Profile: $AWS_PROFILE"
print_status "Region:  $AWS_REGION"
print_status "Root:    $PROJECT_ROOT"
echo ""

# ─── Pre-deploy checks ──────────────────────────────────────────────────────
print_status "Running pre-deploy checks..."

if ! command -v aws &> /dev/null; then
    print_error "AWS CLI not installed"
    exit 1
fi

if ! aws sts get-caller-identity --profile "$AWS_PROFILE" &> /dev/null; then
    print_error "AWS credentials not configured for profile '$AWS_PROFILE'"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query "Account" --output text)
print_success "AWS Account: $ACCOUNT_ID"

if ! command -v npx &> /dev/null; then
    print_error "Node.js/npm not installed"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    print_error "Docker not installed (required for Runtime container build)"
    exit 1
fi

if ! docker info &> /dev/null; then
    print_error "Docker daemon not running. Start Docker Desktop first."
    exit 1
fi
print_success "Docker running"

if [[ ! -f "$PROJECT_ROOT/infra/package.json" ]]; then
    print_error "Must be run from the AgentCore QuickStart project (infra/package.json not found)"
    exit 1
fi

if [[ ! -f "$PROJECT_ROOT/agentcore_agents/app.py" ]]; then
    print_error "Agent code not found (agentcore_agents/app.py)"
    exit 1
fi

if [[ ! -f "$PROJECT_ROOT/agentcore_agents/Dockerfile" ]]; then
    print_error "Dockerfile not found (agentcore_agents/Dockerfile)"
    exit 1
fi

print_success "Pre-deploy checks passed"
echo ""

# ─── Install CDK dependencies ───────────────────────────────────────────────
print_status "Installing CDK dependencies..."
cd "$PROJECT_ROOT/infra"
npm install --silent 2>&1 | tail -1
print_success "Dependencies installed"

# ─── Build TypeScript ────────────────────────────────────────────────────────
print_status "Compiling TypeScript..."
npx tsc --noEmit
print_success "TypeScript compiled"

# ─── Dry run: synth only ────────────────────────────────────────────────────
if [[ "$DRY_RUN" == "true" ]]; then
    print_warning "DRY RUN — synthesizing CloudFormation template only"
    RESOURCE_COUNT=$(npx cdk synth --json --profile "$AWS_PROFILE" 2>/dev/null | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('Resources',{})))")
    print_success "CDK synth successful — $RESOURCE_COUNT resources"
    print_status "Run without --dry-run to deploy"
    exit 0
fi

# ─── Bootstrap (if needed) ──────────────────────────────────────────────────
BOOTSTRAP_VERSION=$(aws ssm get-parameter --name "/cdk-bootstrap/hnb659fds/version" --profile "$AWS_PROFILE" --region "$AWS_REGION" --query "Parameter.Value" --output text 2>/dev/null || echo "0")
if [[ "$BOOTSTRAP_VERSION" -lt 30 ]]; then
    print_warning "CDK bootstrap version $BOOTSTRAP_VERSION < 30. Bootstrapping..."
    npx cdk bootstrap --profile "$AWS_PROFILE"
    print_success "Bootstrap complete"
else
    print_success "CDK bootstrap up to date (v$BOOTSTRAP_VERSION)"
fi

# ─── Deploy ──────────────────────────────────────────────────────────────────
print_status "Deploying AgentCore stack..."
print_warning "This takes 5-10 minutes (Docker build + CloudFormation)..."
echo ""

npx cdk deploy \
    --require-approval never \
    --profile "$AWS_PROFILE" \
    --outputs-file "$PROJECT_ROOT/cdk-outputs.json"

DEPLOY_EXIT=$?
if [[ $DEPLOY_EXIT -ne 0 ]]; then
    print_error "CDK deploy failed (exit code $DEPLOY_EXIT)"
    exit 1
fi

print_success "Stack deployed successfully!"
echo ""

# ─── Display outputs ────────────────────────────────────────────────────────
print_status "Stack Outputs:"
echo ""

if [[ -f "$PROJECT_ROOT/cdk-outputs.json" ]]; then
    python3 -c "
import json
with open('$PROJECT_ROOT/cdk-outputs.json') as f:
    outputs = json.load(f).get('$STACK_NAME', {})
for k, v in sorted(outputs.items()):
    print(f'  {k}: {v}')
"
fi

echo ""

# Extract key URLs
API_URL=$(python3 -c "import json; print(json.load(open('$PROJECT_ROOT/cdk-outputs.json')).get('$STACK_NAME',{}).get('ApiUrl','N/A'))" 2>/dev/null || echo "N/A")
GATEWAY_URL=$(python3 -c "import json; print(json.load(open('$PROJECT_ROOT/cdk-outputs.json')).get('$STACK_NAME',{}).get('GatewayUrl','N/A'))" 2>/dev/null || echo "N/A")

echo "Quick Access:"
echo "  REST API (human):    $API_URL"
echo "  MCP Gateway (agent): $GATEWAY_URL"
echo ""

# ─── Health check ────────────────────────────────────────────────────────────
print_status "Running health check..."
HEALTH=$(curl -s "$API_URL" 2>/dev/null)
if echo "$HEALTH" | grep -q "healthy"; then
    print_success "API health check passed"
else
    print_warning "API health check returned: $HEALTH"
fi
echo ""

# ─── Post-deploy ─────────────────────────────────────────────────────────────
print_status "For post-deploy setup (Observability, Policy), run:"
echo "     AWS_PROFILE=$AWS_PROFILE bash $SCRIPT_DIR/post-deploy.sh"
echo ""

echo "=========================================="
print_success "Deployment complete!"
echo "=========================================="
