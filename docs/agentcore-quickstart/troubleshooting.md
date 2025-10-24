# Troubleshooting Guide

## Common Issues

### 1. Agent Launch Failures

#### Issue: Agent fails to launch
```bash
# Check CloudWatch logs
aws logs tail /aws/bedrock-agentcore/runtimes/agentcore_quickstart-XXXXX-DEFAULT \
    --log-stream-name-prefix "2025/10/24/[runtime-logs]" \
    --profile <aws-profile>
```

**Common Causes:**
- Invalid API key in Secrets Manager
- Missing IAM permissions
- Code syntax errors

**Solutions:**
```bash
# Check secrets
aws secretsmanager get-secret-value \
    --secret-id "agentcore/tavily-api-key" \
    --profile <aws-profile>

# Check IAM permissions
aws iam get-role-policy \
    --role-name AmazonBedrockAgentCoreSDKRuntime-us-east-1-XXXXX \
    --policy-name AgentCorePolicy \
    --profile <aws-profile>
```

### 2. Tool Execution Errors

#### Issue: Tools not recognized
```bash
# Check agent logs
aws logs filter-log-events \
    --log-group-name /aws/bedrock-agentcore/runtimes/agentcore_quickstart-XXXXX-DEFAULT \
    --filter-pattern "Tool" \
    --profile <aws-profile>
```

**Common Causes:**
- Missing `@tool` decorator
- Import errors
- Function signature issues

**Solutions:**
```python
# Ensure proper tool registration
from strands.tools import tool

@tool
def calculator(expression: str) -> str:
    """Tool with proper decorator."""
    return f"Result: {eval(expression)}"
```

### 3. Memory Issues

#### Issue: Memory operations fail
```bash
# Check DynamoDB table
aws dynamodb describe-table \
    --table-name agentcore-memory \
    --profile <aws-profile>
```

**Common Causes:**
- DynamoDB permissions
- Invalid memory_id format
- Table not created

**Solutions:**
```bash
# Check table status
aws dynamodb describe-table \
    --table-name agentcore-memory \
    --query 'Table.TableStatus' \
    --profile <aws-profile>

# Check permissions
aws iam get-role-policy \
    --role-name AgentCoreIntegrationLambdaRole \
    --policy-name DynamoDBPolicy \
    --profile <aws-profile>
```

### 4. API Gateway Issues

#### Issue: 500 Internal Server Error
```bash
# Check Lambda logs
aws logs tail /aws/lambda/AgentCoreIntegrationLambda \
    --profile <aws-profile>
```

**Common Causes:**
- Lambda function errors
- Missing environment variables
- IAM permission issues

**Solutions:**
```bash
# Check Lambda configuration
aws lambda get-function \
    --function-name AgentCoreIntegrationLambda \
    --profile <aws-profile>

# Check environment variables
aws lambda get-function-configuration \
    --function-name AgentCoreIntegrationLambda \
    --query 'Environment.Variables' \
    --profile <aws-profile>
```

## Debug Commands

### 1. Test API Endpoint
```bash
# Test API Gateway
curl -X POST https://your-api-gateway-url/agent \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer your-jwt-token" \
    -d '{"prompt": "test message"}'
```

### 2. Test Agent Directly
```bash
# Test agent without API Gateway
cd agentcore_agents
agentcore invoke '{"prompt": "test message"}'
```

### 3. Check Resource Status
```bash
# Check all resources
aws cloudformation describe-stacks \
    --stack-name AgentCoreQuickStartStack \
    --query 'Stacks[0].StackStatus' \
    --profile <aws-profile>

# Check specific resources
aws lambda list-functions --profile <aws-profile>
aws apigateway get-rest-apis --profile <aws-profile>
aws dynamodb list-tables --profile <aws-profile>
```

## Log Analysis

### 1. Filter Logs by Error
```bash
# Lambda errors
aws logs filter-log-events \
    --log-group-name /aws/lambda/AgentCoreIntegrationLambda \
    --filter-pattern "ERROR" \
    --profile <aws-profile>

# Agent errors
aws logs filter-log-events \
    --log-group-name /aws/bedrock-agentcore/runtimes/agentcore_quickstart-XXXXX-DEFAULT \
    --filter-pattern "ERROR" \
    --profile <aws-profile>
```

### 2. Search by Session ID
```bash
# Find specific session
aws logs filter-log-events \
    --log-group-name /aws/bedrock-agentcore/runtimes/agentcore_quickstart-XXXXX-DEFAULT \
    --filter-pattern "session-12345" \
    --profile <aws-profile>
```

### 3. Tool Execution Logs
```bash
# Find tool invocations
aws logs filter-log-events \
    --log-group-name /aws/bedrock-agentcore/runtimes/agentcore_quickstart-XXXXX-DEFAULT \
    --filter-pattern "Tool #" \
    --profile <aws-profile>
```

## Performance Issues

### 1. Slow Response Times
```bash
# Check Lambda duration
aws cloudwatch get-metric-statistics \
    --namespace "AWS/Lambda" \
    --metric-name "Duration" \
    --dimensions Name=FunctionName,Value=AgentCoreIntegrationLambda \
    --start-time 2025-10-24T00:00:00Z \
    --end-time 2025-10-24T23:59:59Z \
    --period 3600 \
    --statistics Average \
    --profile <aws-profile>
```

### 2. High Error Rates
```bash
# Check error rate
aws cloudwatch get-metric-statistics \
    --namespace "AWS/Lambda" \
    --metric-name "Errors" \
    --dimensions Name=FunctionName,Value=AgentCoreIntegrationLambda \
    --start-time 2025-10-24T00:00:00Z \
    --end-time 2025-10-24T23:59:59Z \
    --period 3600 \
    --statistics Sum \
    --profile <aws-profile>
```

## Security Issues

### 1. Permission Denied
```bash
# Check IAM policies
aws iam get-role-policy \
    --role-name AgentCoreIntegrationLambdaRole \
    --policy-name AgentCorePolicy \
    --profile <aws-profile>

# Check role trust policy
aws iam get-role \
    --role-name AgentCoreIntegrationLambdaRole \
    --query 'Role.AssumeRolePolicyDocument' \
    --profile <aws-profile>
```

### 2. Authentication Failures
```bash
# Check Cognito configuration
aws cognito-idp describe-user-pool \
    --user-pool-id us-east-1_XXXXXXXXX \
    --profile <aws-profile>

# Check API Gateway authorizer
aws apigateway get-authorizers \
    --rest-api-id your-api-id \
    --profile <aws-profile>
```

## Recovery Procedures

### 1. Rollback Deployment
```bash
# Rollback CDK stack
npx cdk rollback --profile <aws-profile>

# Rollback agent
agentcore delete agentcore_quickstart
agentcore launch --version previous
```

### 2. Restore from Backup
```bash
# Restore DynamoDB table
aws dynamodb restore-table-from-backup \
    --target-table-name agentcore-memory-restored \
    --backup-arn arn:aws:dynamodb:us-east-1:ACCOUNT:table/agentcore-memory/backup/BACKUP_ID \
    --profile <aws-profile>
```

### 3. Emergency Procedures
```bash
# Disable API Gateway
aws apigateway update-rest-api \
    --rest-api-id your-api-id \
    --patch-ops op=replace,path=/disableExecuteApiEndpoint,value=true \
    --profile <aws-profile>

# Scale down Lambda
aws lambda put-provisioned-concurrency-config \
    --function-name AgentCoreIntegrationLambda \
    --provisioned-concurrency-config ProvisionedConcurrencyConfig='{ProvisionedConcurrencyCount=0}' \
    --profile <aws-profile>
```

## Monitoring Commands

### 1. Real-time Monitoring
```bash
# Tail logs in real-time
aws logs tail /aws/lambda/AgentCoreIntegrationLambda --follow --profile <aws-profile>

# Monitor metrics
watch -n 5 "aws cloudwatch get-metric-statistics \
    --namespace 'AWS/Lambda' \
    --metric-name 'Invocations' \
    --dimensions Name=FunctionName,Value=AgentCoreIntegrationLambda \
    --start-time \$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time \$(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 300 \
    --statistics Sum \
    --profile <aws-profile>"
```

### 2. Health Checks
```bash
# API health check
curl -f https://your-api-gateway-url/health || echo "API unhealthy"

# Agent health check
agentcore status || echo "Agent unhealthy"

# Database health check
aws dynamodb describe-table \
    --table-name agentcore-memory \
    --query 'Table.TableStatus' \
    --profile <aws-profile>
```

## Best Practices

1. **Log Everything**: Enable comprehensive logging
2. **Monitor Early**: Set up monitoring before issues occur
3. **Test Recovery**: Regularly test recovery procedures
4. **Document Issues**: Keep a knowledge base of solutions
5. **Automate Checks**: Use scripts for common health checks
6. **Alert on Trends**: Monitor trends, not just thresholds
7. **Regular Backups**: Backup critical data regularly
8. **Security Audits**: Regular security reviews
