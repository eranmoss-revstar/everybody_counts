# Bedrock AgentCore Walkthrough

## Complete System Overview

This walkthrough covers the entire Bedrock AgentCore QuickStart system from architecture to deployment.

## System Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│   Frontend      │    │   API Gateway    │    │  AgentCore Runtime  │
│   (React)       │◄──►│   + Cognito      │◄──►│   (Bedrock)         │
└─────────────────┘    └──────────────────┘    └─────────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────────┐
                       │  Lambda Function │    │   Memory Store      │
                       │  (Integration)   │    │   (DynamoDB)        │
                       └──────────────────┘    └─────────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │   External APIs  │
                       │   (Tavily, etc.) │
                       └──────────────────┘
```

## Component Details

### 1. API Gateway
- **Purpose**: RESTful API endpoint with authentication
- **Authentication**: Amazon Cognito User Pool
- **CORS**: Configured for frontend integration
- **Monitoring**: CloudWatch metrics and alarms

### 2. Lambda Integration Layer
- **Purpose**: Bridge between API Gateway and AgentCore Runtime
- **Functions**: Request validation, authentication, tool coordination
- **Permissions**: IAM roles for AgentCore and external services

### 3. AgentCore Runtime
- **Purpose**: Serverless AI agent execution environment
- **Memory**: Short-term (DynamoDB) and long-term (S3) storage
- **Tools**: Custom functions and external API integrations
- **Observability**: X-Ray tracing and CloudWatch logs

### 4. Memory Management
- **Short-term Memory**: Recent conversation context (30 days)
- **Long-term Memory**: Persistent knowledge and preferences
- **Storage**: DynamoDB for STM, S3 for LTM artifacts

## Data Flow

1. **Request**: User sends message via frontend
2. **Authentication**: Cognito validates user identity
3. **Routing**: API Gateway routes to Lambda function
4. **Processing**: Lambda prepares payload for AgentCore
5. **Execution**: AgentCore Runtime processes with tools and memory
6. **Response**: Result flows back through Lambda to frontend

## Key Features

### 1. AgentCore Runtime
```python
from bedrock_agentcore import BedrockAgentCoreApp
from strands import Agent

app = BedrockAgentCoreApp()
agent = Agent(
    system_prompt="You are a helpful AI assistant.",
    tools=[calculator, get_current_time, tavily_search]
)

@app.entrypoint
def invoke(payload: dict) -> dict:
    result = agent(payload.get('prompt', 'Hello'))
    return {"result": result.message, "status": "success"}
```

### 2. Memory Management
```python
from bedrock_agentcore.memory import MemorySessionManager

def get_short_term_memory(session_id: str) -> str:
    memory_manager = MemorySessionManager(
        memory_id=f"agentcore-quickstart-{session_id}",
        region_name="us-east-1"
    )
    recent_turns = memory_manager.get_last_k_turns(
        actor_id="user", session_id=session_id, k=3
    )
    return format_context(recent_turns)
```

### 3. Tool Integration
```python
from strands.tools import tool

@tool
def calculator(expression: str) -> str:
    """Simple calculator tool."""
    try:
        result = eval(expression)
        return f"Result: {result}"
    except Exception as e:
        return f"Error: {str(e)}"
```

## Deployment Process

### 1. Infrastructure Deployment
```bash
# Deploy CDK stack
cd infra
npm install
npx cdk deploy --profile <aws-profile>
```

### 2. Agent Deployment
```bash
# Configure and deploy agent
cd agentcore_agents
agentcore configure --entrypoint app.py --name agentcore_quickstart --region <aws-region> --non-interactive
agentcore launch
```

### 3. Testing
```bash
# Test agent functionality
agentcore invoke '{"prompt": "Calculate 15 * 8 + 42"}'
agentcore invoke '{"prompt": "What time is it now?"}'
agentcore invoke '{"prompt": "Search for latest AI developments"}'
```

## Monitoring & Observability

### 1. CloudWatch Metrics
- Lambda invocations, errors, duration
- API Gateway requests, 4xx/5xx errors
- DynamoDB read/write capacity

### 2. X-Ray Tracing
- End-to-end request tracing
- Performance bottleneck identification
- Error root cause analysis

### 3. Custom Metrics
- Agent execution time
- Tool usage patterns
- Memory utilization

## Security Features

### 1. Authentication
- Cognito User Pool with JWT tokens
- API Gateway authorizer integration
- Role-based access control

### 2. Authorization
- IAM roles with least privilege access
- Resource-level permissions
- Cross-service access controls

### 3. Data Protection
- Encryption in transit and at rest
- Secrets management with AWS Secrets Manager
- VPC endpoints for private communication

## Scaling Considerations

### 1. Auto-scaling
- Lambda functions scale automatically
- DynamoDB auto-scaling for memory storage
- API Gateway throttling controls

### 2. Performance
- CloudFront for static content
- Connection pooling for databases
- Caching strategies for external APIs

### 3. Monitoring
- CloudWatch alarms for performance thresholds
- Custom dashboards for business metrics
- Automated alerting for critical issues

## Troubleshooting

### Common Issues
1. **Agent Launch Failures**: Check CloudWatch logs and IAM permissions
2. **Tool Execution Errors**: Verify tool registration and error handling
3. **Memory Issues**: Check DynamoDB permissions and table configuration
4. **API Gateway Issues**: Verify Lambda integration and authentication

### Debug Commands
```bash
# Check agent logs
aws logs tail /aws/bedrock-agentcore/runtimes/agentcore_quickstart-XXXXX-DEFAULT \
    --log-stream-name-prefix "2025/10/24/[runtime-logs]" \
    --profile <aws-profile>

# Test API endpoint
curl -X POST https://your-api-gateway-url/agent \
    -H "Content-Type: application/json" \
    -d '{"prompt": "test"}'
```

## Best Practices

1. **Modular Design**: Separate tools and utilities
2. **Error Handling**: Comprehensive error handling and logging
3. **Security**: Use IAM roles and secrets management
4. **Monitoring**: Set up comprehensive monitoring and alerting
5. **Testing**: Unit and integration tests for all components
6. **Documentation**: Clear documentation for all components
7. **Performance**: Monitor and optimize performance regularly
8. **Backup**: Regular backups of critical data and configurations
