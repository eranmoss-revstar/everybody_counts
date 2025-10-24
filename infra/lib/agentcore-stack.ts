import {
  Stack,
  StackProps,
  Duration,
  CfnOutput,
  RemovalPolicy,
  Tags,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as sns from "aws-cdk-lib/aws-sns";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as xray from "aws-cdk-lib/aws-xray";
import { join } from "path";

export class AgentCoreStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Tags
    Tags.of(this).add("Project", "AgentCore-QuickStart");
    Tags.of(this).add("ManagedBy", "CDK");
    Tags.of(this).add("Environment", "production");


    // S3 Bucket for AgentCore artifacts and logs
    const agentCoreBucket = new s3.Bucket(this, "AgentCoreBucket", {
      bucketName: `agentcore-quickstart-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: "DeleteOldVersions",
          enabled: true,
          noncurrentVersionExpiration: Duration.days(30),
        },
        {
          id: "DeleteIncompleteMultipartUploads",
          enabled: true,
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
    });

    // Note: AgentCore Memory is managed by AWS Bedrock AgentCore service
    // No custom DynamoDB tables needed for official pattern

    // Cognito User Pool for authentication (following LLM Ops pattern)
    const userPool = new cognito.UserPool(this, "AgentCoreUserPool", {
      userPoolName: "agentcore-quickstart-user-pool",
      mfa: cognito.Mfa.OFF,
      selfSignUpEnabled: false, // More secure for production
      signInAliases: {
        email: true,
        username: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Resource Server for scoped permissions (following LLM Ops pattern)
    const readScope = new cognito.ResourceServerScope({ 
      scopeName: "read", 
      scopeDescription: "Read access to agent endpoints" 
    });
    const writeScope = new cognito.ResourceServerScope({ 
      scopeName: "write", 
      scopeDescription: "Write access to agent endpoints" 
    });

    const resourceServer = userPool.addResourceServer("AgentCoreResourceServer", {
      identifier: "agentcore-quickstart-api",
      userPoolResourceServerName: "AgentCore QuickStart API",
      scopes: [readScope, writeScope],
    });

    const userPoolClient = new cognito.UserPoolClient(this, "AgentCoreUserPoolClient", {
      userPool,
      userPoolClientName: "agentcore-quickstart-client",
      generateSecret: true,
      oAuth: {
        flows: {
          clientCredentials: true, // For API-to-API authentication (matching LLM Ops pattern)
        },
        scopes: [
          cognito.OAuthScope.resourceServer(resourceServer, readScope),
          cognito.OAuthScope.resourceServer(resourceServer, writeScope),
        ],
      },
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
    });

    // IAM Role for Lambda Functions
    const lambdaExecutionRole = new iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
      inlinePolicies: {
        AgentCorePolicy: new iam.PolicyDocument({
          statements: [
            // AgentCore Runtime permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "bedrock-agentcore:InvokeAgentRuntime",
              ],
              resources: ["*"],
            }),
            // Bedrock model access for AgentCore
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream",
              ],
              resources: [
                "arn:aws:bedrock:*::foundation-model/*",
              ],
            }),
            // Secrets Manager access for API keys
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "secretsmanager:GetSecretValue",
              ],
              resources: [
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:agentcore/*`,
              ],
            }),
            // CloudWatch Logs permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
              ],
              resources: [
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/agentcore-integration*`,
              ],
            }),
            // X-Ray tracing permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "xray:PutTraceSegments",
                "xray:PutTelemetryRecords",
              ],
              resources: ["*"],
            }),
          ],
        }),
      },
    });


    // Secrets Manager for API keys
    const tavilySecret = new secretsmanager.Secret(this, "TavilyApiKeySecret", {
      secretName: "agentcore/tavily-api-key",
      description: "Tavily API key for web search tool",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ api_key: "your-tavily-api-key-here" }),
        generateStringKey: "api_key",
        excludeCharacters: '"@/\\',
      },
    });

    // API Gateway for AgentCore (following LLM Ops professional pattern)
    const api = new apigw.RestApi(this, "AgentCoreApi", {
      restApiName: "agentcore-quickstart-api",
      description: "API for AgentCore QuickStart agents",
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "X-Api-Key", "Authorization", "X-Session-ID"],
      },
      deployOptions: {
        stageName: "prod",
        tracingEnabled: true,
        // Note: Disabled logging to avoid CloudWatch Logs role requirement
        // loggingLevel: apigw.MethodLoggingLevel.INFO,
        // dataTraceEnabled: true,
      },
    });

    // Cognito Authorizer (following LLM Ops pattern)
    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, "AgentCoreAuthorizer", {
      cognitoUserPools: [userPool],
      authorizerName: "AgentCoreAuthorizer",
    });

    // Default authorization for all methods (following LLM Ops pattern)
    const defaultMethodOptions: apigw.MethodOptions = {
      authorizer: authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    };

    // Note: Agent Gateway Lambda removed - using direct AgentCore Runtime integration
    // Official pattern: API Gateway → AgentCore Runtime (direct)

    // Note: Tavily search is integrated directly in the AgentCore agent
    // No separate Lambda function needed for simplified approach

    // API Routes - Direct AgentCore Integration
    
    // Test endpoint (no authentication required)
    api.root.addMethod(
      "GET",
      new apigw.MockIntegration({
        integrationResponses: [{
          statusCode: "200",
          responseTemplates: {
            "application/json": JSON.stringify({
              message: "AgentCore QuickStart API is running",
              status: "healthy",
              timestamp: new Date().toISOString()
            })
          }
        }],
        requestTemplates: {
          "application/json": JSON.stringify({ statusCode: 200 })
        }
      }),
      {
        methodResponses: [{ statusCode: "200" }],
        authorizer: undefined,
        authorizationType: apigw.AuthorizationType.NONE,
      }
    );
    
    // AgentCore endpoints for client integration
    const agentResource = api.root.addResource("agent");
    
    // Create a Lambda function for AgentCore integration (following best practices)
    const agentCoreLambda = new lambda.Function(this, "AgentCoreIntegrationLambda", {
      functionName: "agentcore-integration",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(join(__dirname, "../../functions/agentcore-integration"), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            "bash", "-c",
            "pip install -r requirements.txt -t /asset-output && cp -au . /asset-output"
          ],
        },
      }),
      role: lambdaExecutionRole,
      timeout: Duration.seconds(29),
      memorySize: 512,
      environment: {
        AGENTCORE_RUNTIME_ARN: process.env.AGENTCORE_RUNTIME_ARN || "TBD",
        REGION: this.region,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant AgentCore runtime role permissions to access the Tavily API key secret
    // This is needed for direct agentcore launch usage (Lambda doesn't need this permission)
    const agentCoreRuntimeRole = iam.Role.fromRoleName(
      this,
      "AgentCoreRuntimeRole",
      "AmazonBedrockAgentCoreSDKRuntime-us-east-1-2589fb40ff"
    );
    tavilySecret.grantRead(agentCoreRuntimeRole);
    
    // Agent invocation endpoint with scoped permissions (following LLM Ops pattern)
    agentResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(agentCoreLambda),
      {
        authorizer: authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
        authorizationScopes: [`${resourceServer.userPoolResourceServerId}/write`],
      }
    );
    
    // Note: OPTIONS method is automatically created by defaultCorsPreflightOptions

    // Usage Plan for API throttling (following LLM Ops pattern)
    api.addUsagePlan("AgentCoreUsagePlan", {
      name: "agentcore-quickstart-usage-plan",
      description: "Usage plan for AgentCore QuickStart",
      apiStages: [
        {
          api: api,
          stage: api.deploymentStage,
        },
      ],
      throttle: {
        rateLimit: 100, // requests per second
        burstLimit: 200, // burst capacity
      },
    });

    // CloudWatch Log Group for API Gateway
    const apiGatewayLogGroup = new logs.LogGroup(this, "AgentCoreApiGatewayLogGroup", {
      logGroupName: `/aws/apigateway/${api.restApiId}/${api.deploymentStage.stageName}`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // CloudWatch Log Group for AgentCore Lambda
    const agentCoreLogGroup = new logs.LogGroup(this, "AgentCoreLambdaLogGroup", {
      logGroupName: "/aws/lambda/agentcore-integration",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // CloudWatch Error Alarms (following LLM Ops pattern)
    const apiErrorAlarm = new logs.MetricFilter(this, "AgentCoreApiErrorMetric", {
      logGroup: apiGatewayLogGroup,
      filterPattern: logs.FilterPattern.literal('{ $.status >= 500 }'),
      metricNamespace: "AgentCoreAPI",
      metricName: "5xxErrors",
    });

    // Lambda Error Alarm
    const lambdaErrorAlarm = new logs.MetricFilter(this, "AgentCoreLambdaErrorMetric", {
      logGroup: agentCoreLogGroup,
      filterPattern: logs.FilterPattern.literal('[timestamp, request_id, level, message, ...]'),
      metricNamespace: "AgentCoreLambda",
      metricName: "LambdaErrors",
    });

    // Lambda Duration Alarm
    const lambdaDurationAlarm = new logs.MetricFilter(this, "AgentCoreLambdaDurationMetric", {
      logGroup: agentCoreLogGroup,
      filterPattern: logs.FilterPattern.literal('{ $.duration > 25000 }'),
      metricNamespace: "AgentCoreLambda",
      metricName: "HighDuration",
    });

    // CloudWatch Alarms for monitoring
    const apiErrorRateAlarm = new cloudwatch.Alarm(this, "AgentCoreApiErrorRateAlarm", {
      metric: new cloudwatch.Metric({
        namespace: "AgentCoreAPI",
        metricName: "5xxErrors",
        statistic: "Sum",
      }),
      threshold: 5,
      evaluationPeriods: 2,
      alarmDescription: "High error rate in API Gateway",
    });

    const lambdaErrorRateAlarm = new cloudwatch.Alarm(this, "AgentCoreLambdaErrorRateAlarm", {
      metric: new cloudwatch.Metric({
        namespace: "AgentCoreLambda",
        metricName: "LambdaErrors",
        statistic: "Sum",
      }),
      threshold: 3,
      evaluationPeriods: 2,
      alarmDescription: "High error rate in Lambda function",
    });

    // SNS Topic for alerts (optional - can be configured later)
    const alertTopic = new sns.Topic(this, "AgentCoreAlertTopic", {
      topicName: "agentcore-quickstart-alerts",
      displayName: "AgentCore QuickStart Alerts",
    });

    // Outputs
    new CfnOutput(this, "ApiUrl", {
      value: api.url,
      description: "AgentCore API Gateway URL",
    });

    new CfnOutput(this, "UserPoolId", {
      value: userPool.userPoolId,
      description: "Cognito User Pool ID",
    });

        new CfnOutput(this, "UserPoolClientId", {
          value: userPoolClient.userPoolClientId,
          description: "Cognito User Pool Client ID",
        });

        new CfnOutput(this, "UserPoolClientSecret", {
          value: userPoolClient.userPoolClientSecret.unsafeUnwrap(),
          description: "Cognito User Pool Client Secret",
        });

        new CfnOutput(this, "ResourceServerId", {
          value: resourceServer.userPoolResourceServerId,
          description: "Cognito Resource Server ID for scoped permissions",
        });

    new CfnOutput(this, "AgentCoreBucketName", {
      value: agentCoreBucket.bucketName,
      description: "S3 bucket for AgentCore artifacts",
    });

        new CfnOutput(this, "TavilySecretArn", {
          value: tavilySecret.secretArn,
          description: "Tavily API key secret ARN",
        });

        new CfnOutput(this, "AgentCoreLambdaArn", {
          value: agentCoreLambda.functionArn,
          description: "AgentCore Integration Lambda ARN",
        });
  }
}
