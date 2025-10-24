# Bedrock AgentCore QuickStart

A production-ready template for deploying AWS Bedrock AgentCore agents with tools, memory, and observability.

## Quick Start

```bash
# 1. Deploy infrastructure
cd infra && npm install && npx cdk deploy --profile <aws-profile>

# 2. Deploy agent
cd ../agentcore_agents && agentcore launch

# 3. Test agent
agentcore invoke '{"prompt": "Calculate 15 * 8 + 42"}'
```

## Documentation

- **[CDK Infrastructure](cdk-infrastructure.md)** - AWS infrastructure setup and configuration
- **[AgentCore Development](agentcore-development.md)** - Building and deploying agents
- **[Tool Integration](tool-integration.md)** - Adding custom tools and external APIs
- **[Deployment Guide](deployment-guide.md)** - Production deployment and scaling
- **[Bedrock AgentCore Walkthrough](bedrock-agentcore-walkthrough.md)** - Complete system overview

## Architecture

```
Frontend → API Gateway → Lambda → AgentCore Runtime → Tools & Memory
```

## Features

- ✅ **AgentCore Runtime** - Serverless AI agent execution
- ✅ **Custom Tools** - Calculator, time, web search
- ✅ **Memory Management** - Short-term and long-term memory
- ✅ **Authentication** - Cognito User Pool integration
- ✅ **Monitoring** - CloudWatch, X-Ray, custom metrics
- ✅ **Security** - IAM roles, secrets management

## Prerequisites

- AWS CLI configured
- Node.js 18+
- Python 3.12+
- Docker (optional)

## Support

For issues and questions, check the [Troubleshooting](troubleshooting.md) guide.
