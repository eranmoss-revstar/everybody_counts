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

## Recovery Procedures

### 1. Rollback Deployment
```bash
# Rollback CDK stack
npx cdk rollback --profile <aws-profile>

# Rollback agent
agentcore delete agentcore_quickstart
agentcore launch --version previous
```

### 2. Emergency Procedures
```bash
# Disable API Gateway
aws apigateway update-rest-api \
    --rest-api-id your-api-id \
    --patch-ops op=replace,path=/disableExecuteApiEndpoint,value=true \
    --profile <aws-profile>
```

## Health Checks

### 1. API Health Check
```bash
curl -f https://your-api-gateway-url/health || echo "API unhealthy"
```

### 2. Agent Health Check
```bash
agentcore status || echo "Agent unhealthy"
```

### 3. Database Health Check
```bash
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
