# CDK Infrastructure Guide

## Overview

AWS CDK stack that provisions all infrastructure for the AgentCore QuickStart.

## Stack Components

### 1. API Gateway
```typescript
const api = new apigw.RestApi(this, 'AgentCoreApi', {
  restApiName: 'AgentCore API',
  defaultCorsPreflightOptions: {
    allowOrigins: apigw.Cors.ALL_ORIGINS,
    allowMethods: apigw.Cors.ALL_METHODS,
    allowHeaders: ['Content-Type', 'Authorization']
  }
});
```

### 2. Lambda Integration
```typescript
const agentCoreLambda = new lambda.Function(this, 'AgentCoreIntegrationLambda', {
  runtime: lambda.Runtime.PYTHON_3_12,
  handler: 'index.lambda_handler',
  code: lambda.Code.fromAsset('functions/agentcore-integration'),
  environment: {
    REGION: 'us-east-1',
    AGENTCORE_RUNTIME_ARN: agentRuntimeArn
  }
});
```

### 3. Cognito Authentication
```typescript
const userPool = new cognito.UserPool(this, 'AgentCoreUserPool', {
  userPoolName: 'AgentCoreUserPool',
  selfSignUpEnabled: true,
  signInAliases: { email: true }
});

const userPoolClient = new cognito.UserPoolClient(this, 'AgentCoreUserPoolClient', {
  userPool,
  authFlows: { userPassword: true, userSrp: true }
});
```

### 4. DynamoDB Memory Store
```typescript
const memoryTable = new dynamodb.Table(this, 'AgentCoreMemoryTable', {
  tableName: 'agentcore-memory',
  partitionKey: { name: 'memory_id', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'ttl'
});
```

### 5. Secrets Management
```typescript
const tavilySecret = new secretsmanager.Secret(this, 'TavilyApiKey', {
  secretName: 'agentcore/tavily-api-key',
  description: 'Tavily API key for web search',
  generateSecretString: {
    secretStringTemplate: JSON.stringify({ api_key: 'your-tavily-api-key' }),
    generateStringKey: 'api_key'
  }
});
```

## Deployment

### 1. Bootstrap CDK
```bash
npx cdk bootstrap --profile <aws-profile>
```

### 2. Deploy Stack
```bash
npx cdk deploy --profile <aws-profile>
```

### 3. Verify Resources
```bash
# Check API Gateway
aws apigateway get-rest-apis --profile <aws-profile>

# Check Lambda
aws lambda list-functions --profile <aws-profile>

# Check DynamoDB
aws dynamodb list-tables --profile <aws-profile>
```

## Configuration

### Environment Variables
```bash
# .env
AWS_REGION=us-east-1
ACCOUNT_ID=123456789012
STACK_NAME=AgentCoreQuickStartStack
```

### IAM Permissions
```typescript
// AgentCore Runtime permissions
agentCoreLambda.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['bedrock-agentcore:InvokeAgentRuntime'],
  resources: ['*']
}));

// Secrets Manager permissions
tavilySecret.grantRead(agentCoreLambda);
```

## Outputs

The stack outputs:
- `ApiUrl` - API Gateway endpoint URL
- `UserPoolId` - Cognito User Pool ID
- `UserPoolClientId` - Cognito User Pool Client ID
- `MemoryTableName` - DynamoDB table name
- `TavilySecretArn` - Secrets Manager ARN

## Monitoring

### CloudWatch Alarms
```typescript
new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
  metric: agentCoreLambda.metricErrors(),
  threshold: 10,
  evaluationPeriods: 2
});
```

### X-Ray Tracing
```typescript
agentCoreLambda.addTracingConfig({
  tracingMode: lambda.TracingMode.ACTIVE
});
```

## Customization

### Add New Resources
```typescript
// Add RDS database
const database = new rds.DatabaseInstance(this, 'AgentCoreDatabase', {
  engine: rds.DatabaseInstanceEngine.mysql({
    version: rds.MysqlEngineVersion.VER_8_0
  }),
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO)
});
```

### Modify Existing Resources
```typescript
// Update Lambda timeout
agentCoreLambda.addEnvironment('TIMEOUT', '30');
```

## Cleanup

```bash
# Destroy stack
npx cdk destroy --profile <aws-profile>

# Confirm deletion
npx cdk destroy --profile <aws-profile> --force
```
