# Deployment Guide

## Prerequisites

1. **AWS CLI Setup**
```bash
aws configure --profile <aws-profile>
# Enter: Access Key ID, Secret Access Key, Region (<aws-region>), Output (json)
```

2. **Required Tools**
```bash
# Node.js 18+
node --version

# AWS CDK
npm install -g aws-cdk

# AgentCore CLI
pip install bedrock-agentcore-starter-toolkit
```

## Quick Deployment

### 1. Deploy Infrastructure
```bash
cd infra
npm install
npx cdk deploy --profile <aws-profile>
```

### 2. Deploy Agent
```bash
cd ../agentcore_agents
agentcore configure --entrypoint app.py --name agentcore_quickstart --region <aws-region> --non-interactive
agentcore launch
```

### 3. Test Deployment
```bash
agentcore invoke '{"prompt": "Calculate 15 * 8 + 42"}'
agentcore invoke '{"prompt": "What time is it now?"}'
```

## Production Deployment

### 1. Use Deployment Script
```bash
cd scripts
./deploy-agentcore.sh <client-name> <aws-profile>
```

### 2. Verify Resources
```bash
# Check API Gateway
aws apigateway get-rest-apis --profile <aws-profile>

# Check Lambda functions
aws lambda list-functions --profile <aws-profile>

# Check DynamoDB tables
aws dynamodb list-tables --profile <aws-profile>
```

## Environment Configuration

### 1. Secrets Management
```bash
# Store Tavily API key
aws secretsmanager create-secret \
    --name "agentcore/tavily-api-key" \
    --secret-string "your-tavily-api-key" \
    --profile <aws-profile>
```

### 2. Environment Variables
```bash
# Set in Lambda function
aws lambda update-function-configuration \
    --function-name AgentCoreIntegrationLambda \
    --environment Variables='{
        "REGION":"us-east-1",
        "AGENTCORE_RUNTIME_ARN":"arn:aws:bedrock-agentcore:us-east-1:ACCOUNT:runtime/agentcore_quickstart-XXXXX"
    }' \
    --profile <aws-profile>
```

## Monitoring Setup

### 1. CloudWatch Alarms
```bash
# Check existing alarms
aws cloudwatch describe-alarms --profile <aws-profile>
```

### 2. Log Monitoring
```bash
# Monitor agent logs
aws logs tail /aws/bedrock-agentcore/runtimes/agentcore_quickstart-XXXXX-DEFAULT \
    --log-stream-name-prefix "2025/10/24/[runtime-logs]" \
    --profile <aws-profile>
```

## Scaling Configuration

### 1. Lambda Concurrency
```typescript
// In CDK stack
const agentCoreLambda = new lambda.Function(this, 'AgentCoreIntegrationLambda', {
  reservedConcurrentExecutions: 100
});
```

### 2. DynamoDB Auto-scaling
```typescript
// In CDK stack
const memoryTable = new dynamodb.Table(this, 'AgentCoreMemoryTable', {
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
});
```

## Troubleshooting

### Common Issues

1. **Agent Launch Fails**
```bash
# Check CloudWatch logs
aws logs tail /aws/bedrock-agentcore/runtimes/agentcore_quickstart-XXXXX-DEFAULT \
    --log-stream-name-prefix "2025/10/24/[runtime-logs]" \
    --profile <aws-profile>
```

2. **Tool Execution Errors**
```bash
# Check Lambda logs
aws logs tail /aws/lambda/AgentCoreIntegrationLambda \
    --profile <aws-profile>
```

3. **API Gateway Issues**
```bash
# Test API endpoint
curl -X POST https://your-api-gateway-url/agent \
    -H "Content-Type: application/json" \
    -d '{"prompt": "test"}'
```

### Debug Commands

```bash
# Test agent directly
cd agentcore_agents
agentcore invoke '{"prompt": "test message"}'

# Check resource status
aws cloudformation describe-stacks \
    --stack-name AgentCoreQuickStartStack \
    --profile <aws-profile>
```

## Rollback Procedures

### 1. Rollback CDK Stack
```bash
npx cdk rollback --profile <aws-profile>
```

### 2. Rollback Agent
```bash
# Delete current agent
agentcore delete agentcore_quickstart

# Deploy previous version
agentcore launch --version previous
```

## Security Checklist

- [ ] IAM roles follow least privilege principle
- [ ] Secrets stored in AWS Secrets Manager
- [ ] API Gateway has proper authentication
- [ ] Lambda functions have proper VPC configuration
- [ ] DynamoDB tables have encryption enabled
- [ ] CloudWatch logs are encrypted
- [ ] X-Ray tracing is properly configured
