# AgentCore QuickStart - Infrastructure

This CDK project sets up a complete AgentCore infrastructure using Amazon Bedrock for multi-agent AI systems with tool orchestration, memory management, and comprehensive observability.

## Architecture Components

The infrastructure includes:

- **Agent Runtime** - Multi-agent orchestration with reasoning loops
- **Tool System** - Secure tool registry and invocation framework
- **Memory Management** - Short-term (DynamoDB) and long-term (S3) memory
- **API Gateway** - Session-based API with authentication
- **Lambda Functions** - Serverless agent and tool execution
- **DynamoDB** - Session state and conversation history
- **CloudWatch** - Monitoring, logging, and observability
- **X-Ray** - Distributed tracing across all components

## Prerequisites

- [AWS CDK](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html) installed
- AWS CLI configured with appropriate credentials
- Node.js and npm installed
- Python 3.10 or higher installed
- Amazon Bedrock model access enabled

## Lambda Function Implementation

The infrastructure uses Python Lambda functions organized by purpose:

- `agent_gateway/` - Main agent orchestration and routing
- `tools/` - Individual tool implementations
  - `web_search/` - Web search tool
  - `datasheet_lookup/` - Document lookup tool
  - `cost_insights/` - AWS cost analysis tool

Each Lambda function should have an `index.py` file with a `lambda_handler` function.

### Dependencies

All Lambda functions share the same dependencies defined in `lambda/dependencies/requirements.txt`. The CDK deployment process will automatically:

1. Copy this requirements.txt file to each Lambda's deployment package
2. Install the dependencies in the package
3. Deploy the Lambda with all necessary dependencies

If you need to add a new dependency, just update the shared requirements.txt file.

## Deployment

### 1. Install dependencies:
```bash
npm install
```

### 2. Deploy the AgentCore infrastructure:
```bash
# Deploy with AgentCore endpoint
npx cdk deploy BackendStack --context agentcoreEndpointUrl=https://your-agentcore-endpoint.com

# Deploy with additional tool configuration
npx cdk deploy BackendStack \
  --context agentcoreEndpointUrl=https://your-agentcore-endpoint.com \
  --context webSearchApiUrl=https://api.search.example.com \
  --context webSearchApiKey=your-api-key
```

### 3. Deploy AgentCore runtime:
```bash
cd ../code/agentcore
pip install -r requirements.txt
agentcore deploy --name agentcore-quickstart
```

## Configuration

### Environment Variables

The following environment variables are available for configuration:

- `AGENTCORE_ENDPOINT_URL` - AgentCore runtime endpoint
- `WEB_SEARCH_API_URL` - External web search API URL
- `WEB_SEARCH_API_KEY` - External web search API key
- `DOCS_BUCKET_NAME` - S3 bucket for document storage

### CDK Context Variables

Use CDK context to pass configuration during deployment:

```bash
npx cdk deploy BackendStack \
  --context agentcoreEndpointUrl=https://your-agentcore-endpoint.com \
  --context webSearchApiUrl=https://api.search.example.com \
  --context webSearchApiKey=your-api-key
```

## API Endpoints

The deployed infrastructure provides the following API endpoints:

### Session Management
- `POST /sessions` - Start new agent session
- `POST /sessions/{id}/turn` - Run conversation turn
- `GET /sessions/{id}/stream` - Stream agent responses
- `DELETE /sessions/{id}` - End agent session
- `GET /sessions/{id}/trace` - Get session observability data

### Tool Invocation
- `POST /tools/web-search` - Web search tool
- `POST /tools/datasheet-lookup` - Datasheet lookup tool
- `POST /tools/cost-insights` - Cost insights tool

### Administration
- `POST /admin/tools/reload` - Reload tool registry

## Security

### Authentication
- **Cognito User Pool** for user authentication
- **JWT tokens** for API access
- **Scope-based authorization** (read, write, admin)

### IAM Permissions
- **Least privilege** access for all components
- **Tool-specific permissions** for external API access
- **Bedrock model access** for AI operations

### Data Protection
- **Encryption at rest** for all data stores
- **Encryption in transit** for all communications
- **VPC integration** available for enhanced security

## Monitoring and Observability

### CloudWatch Integration
- **Structured logging** with correlation IDs
- **Custom metrics** for agent performance
- **CloudWatch alarms** for error rates and latency
- **X-Ray tracing** for distributed request tracking

### Key Metrics
- Agent execution time and success rates
- Tool invocation counts and errors
- Token usage and costs
- User session activity

## Development

### Local Development

```bash
# Run CDK tests
npm test

# Synthesize CloudFormation templates
npx cdk synth

# Check for differences
npx cdk diff

# Deploy to development environment
npx cdk deploy BackendStack --context environment=development
```

### Adding New Tools

1. Create tool Lambda function in `code/lambda/tools/{tool_name}/`
2. Add tool definition to `tools.yaml`
3. Update CDK stack to include tool Lambda
4. Deploy with `npx cdk deploy BackendStack`

### Adding New Agents

1. Create agent implementation in `examples/{agent_name}/`
2. Update agent registry in `code/lambda/agent_gateway/agents.json`
3. Deploy AgentCore runtime with new agent

## Troubleshooting

### Common Issues

1. **Bedrock Access Denied**
   - Ensure Bedrock models are enabled in your AWS account
   - Check IAM permissions for Bedrock access

2. **Lambda Timeout Errors**
   - Increase Lambda timeout in CDK configuration
   - Check tool execution time and optimize

3. **DynamoDB Throttling**
   - Increase read/write capacity units
   - Check for hot partitions

4. **API Gateway CORS Issues**
   - Verify CORS configuration in CDK
   - Check frontend request headers

### Debug Commands

```bash
# Check CloudWatch logs
aws logs tail /aws/lambda/agentcore-gateway --follow

# Check DynamoDB table status
aws dynamodb describe-table --table-name agentcore-sessions

# Test API endpoints
curl -X POST https://your-api-gateway-url/sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"user_id": "test", "tenant_id": "test", "agent_id": "default"}'
```

## Cleanup

To remove all resources:

```bash
# Delete CDK stack
npx cdk destroy BackendStack

# Delete S3 buckets manually (if needed)
aws s3 rb s3://agentcore-docs-123456789012-us-east-1 --force

# Delete DynamoDB tables manually (if needed)
aws dynamodb delete-table --table-name agentcore-sessions
aws dynamodb delete-table --table-name agentcore-tool-registry
aws dynamodb delete-table --table-name agentcore-observability
```

## Support

For additional help:
- [Architecture Guide](../ARCHITECTURE.md)
- [Deployment Guide](../DEPLOYMENT.md)
- [Tool Definition Guide](../TOOL_DEFINITION.md)