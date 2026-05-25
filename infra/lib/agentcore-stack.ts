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
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import { Fn } from "aws-cdk-lib";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { join } from "path";
import { OSS_EXPORTS, KB_ROLE_NAME } from "./oss-foundation-stack";

export class AgentCoreStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ─── Tags ──────────────────────────────────────────────────────────────
    Tags.of(this).add("Project", "AgentCore-QuickStart");
    Tags.of(this).add("ManagedBy", "CDK");

    // ─── S3 Bucket ─────────────────────────────────────────────────────────
    const agentCoreBucket = new s3.Bucket(this, "AgentCoreBucket", {
      bucketName: `agentcore-quickstart-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
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

    // ─── Cognito (shared across Runtime, Gateway, and API GW) ──────────────
    const userPool = new cognito.UserPool(this, "AgentCoreUserPool", {
      userPoolName: "agentcore-quickstart-user-pool",
      mfa: cognito.Mfa.OFF,
      selfSignUpEnabled: false,
      signInAliases: { email: true, username: true },
      standardAttributes: {
        email: { required: true, mutable: true },
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

    const readScope = new cognito.ResourceServerScope({
      scopeName: "read",
      scopeDescription: "Read access to agent endpoints",
    });
    const writeScope = new cognito.ResourceServerScope({
      scopeName: "write",
      scopeDescription: "Write access to agent endpoints",
    });

    const resourceServer = userPool.addResourceServer(
      "AgentCoreResourceServer",
      {
        identifier: "agentcore-quickstart-api",
        userPoolResourceServerName: "AgentCore QuickStart API",
        scopes: [readScope, writeScope],
      }
    );

    const userPoolClient = new cognito.UserPoolClient(
      this,
      "AgentCoreUserPoolClient",
      {
        userPool,
        userPoolClientName: "agentcore-quickstart-client",
        generateSecret: true,
        oAuth: {
          flows: { clientCredentials: true },
          scopes: [
            cognito.OAuthScope.resourceServer(resourceServer, readScope),
            cognito.OAuthScope.resourceServer(resourceServer, writeScope),
          ],
        },
        authFlows: { userPassword: true, userSrp: true },
      }
    );

    // Frontend client — no secret (amazon-cognito-identity-js SRP auth doesn't support client secrets)
    const frontendClient = new cognito.UserPoolClient(this, "FrontendUserPoolClient", {
      userPool,
      userPoolClientName: "everybody-counts-frontend",
      generateSecret: false,
      authFlows: { userSrp: true, userPassword: true },
    });

    // Cognito domain for OAuth token endpoint (required for client_credentials flow)
    userPool.addDomain("AgentCoreDomain", {
      cognitoDomain: {
        domainPrefix: `agentcore-qs-${this.account}`,
      },
    });

    // ─── Secrets Manager ───────────────────────────────────────────────────
    const tavilySecret = new secretsmanager.Secret(
      this,
      "TavilyApiKeySecret",
      {
        secretName: "agentcore/tavily-api-key",
        description: "Tavily API key for web search tool",
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            api_key: "your-tavily-api-key-here",
          }),
          generateStringKey: "api_key",
          excludeCharacters: '"@/\\',
        },
      }
    );

    // ─── CloudTrail ────────────────────────────────────────────────────────
    const trailLogGroup = new logs.LogGroup(this, "CloudTrailLogGroup", {
      logGroupName: "/aws/cloudtrail/agentcore-quickstart",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new cloudtrail.Trail(this, "AgentCoreTrail", {
      trailName: "agentcore-quickstart-trail",
      bucket: agentCoreBucket,
      s3KeyPrefix: "cloudtrail",
      cloudWatchLogGroup: trailLogGroup,
      sendToCloudWatchLogs: true,
      isMultiRegionTrail: false,
    });

    // ─── Bedrock Guardrail (CfnGuardrail) ──────────────────────────────────
    const guardrail = new bedrock.CfnGuardrail(this, "AgentCoreGuardrail", {
      name: "agentcore-quickstart-guardrail",
      description: "Content safety guardrail for AgentCore QuickStart",
      blockedInputMessaging:
        "Your request was blocked by our content safety policy.",
      blockedOutputsMessaging:
        "The response was blocked by our content safety policy.",
      contentPolicyConfig: {
        filtersConfig: [
          {
            type: "SEXUAL",
            inputStrength: "HIGH",
            outputStrength: "HIGH",
          },
          {
            type: "VIOLENCE",
            inputStrength: "HIGH",
            outputStrength: "HIGH",
          },
          {
            type: "HATE",
            inputStrength: "HIGH",
            outputStrength: "HIGH",
          },
          {
            type: "INSULTS",
            inputStrength: "HIGH",
            outputStrength: "HIGH",
          },
          {
            type: "MISCONDUCT",
            inputStrength: "HIGH",
            outputStrength: "HIGH",
          },
          {
            type: "PROMPT_ATTACK",
            inputStrength: "HIGH",
            outputStrength: "NONE",
          },
        ],
      },
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: [
          { type: "EMAIL", action: "ANONYMIZE" },
          { type: "US_SOCIAL_SECURITY_NUMBER", action: "BLOCK" },
          { type: "CREDIT_DEBIT_CARD_NUMBER", action: "BLOCK" },
        ],
      },
    });

    const guardrailVersion = new bedrock.CfnGuardrailVersion(
      this,
      "AgentCoreGuardrailVersion",
      {
        guardrailIdentifier: guardrail.attrGuardrailId,
        description: "Initial version",
      }
    );

    // ─── AgentCore Memory ──────────────────────────────────────────────────
    const memory = new agentcore.Memory(this, "AgentCoreMemory", {
      memoryName: "agentcore_quickstart_memory",
      memoryStrategies: [
        agentcore.MemoryStrategy.usingBuiltInSemantic(),
        agentcore.MemoryStrategy.usingBuiltInSummarization(),
        agentcore.MemoryStrategy.usingBuiltInUserPreference(),
      ],
      expirationDuration: Duration.days(90),
      description: "Memory for AgentCore QuickStart",
    });

    // ─── AgentCore Code Interpreter ────────────────────────────────────────
    const codeInterpreter = new agentcore.CodeInterpreterCustom(
      this,
      "AgentCoreCodeInterpreter",
      {
        codeInterpreterCustomName: "agentcore_quickstart_code_interpreter",
        networkConfiguration:
          agentcore.CodeInterpreterNetworkConfiguration.usingPublicNetwork(),
        description: "Code interpreter for AgentCore QuickStart",
      }
    );

    // ─── AgentCore Browser ─────────────────────────────────────────────────
    const browser = new agentcore.BrowserCustom(this, "AgentCoreBrowser", {
      browserCustomName: "agentcore_quickstart_browser",
      networkConfiguration:
        agentcore.BrowserNetworkConfiguration.usingPublicNetwork(),
      description: "Browser tool for AgentCore QuickStart",
      recordingConfig: {
        enabled: true,
        s3Location: {
          bucketName: agentCoreBucket.bucketName,
          objectKey: "browser-recordings/",
        },
      },
    });

    // ─── AgentCore Runtime ─────────────────────────────────────────────────
    // AgentCore Runtime requires ARM64. Set the target platform on the CDK
    // asset so the build is host-agnostic (works on x86 CI, Intel Mac, Apple
    // Silicon) via docker buildx + QEMU instead of pinning the Dockerfile FROM.
    const agentRuntimeArtifact = agentcore.AgentRuntimeArtifact.fromAsset(
      join(__dirname, "../../agentcore_agents"),
      {
        platform: Platform.LINUX_ARM64,
      },
    );

    const runtime = new agentcore.Runtime(this, "AgentCoreRuntime", {
      runtimeName: "agentcore_quickstart_runtime",
      agentRuntimeArtifact,
      networkConfiguration:
        agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      description: "AgentCore Runtime for QuickStart",
      // IAM auth: Lambda bridge invokes Runtime via IAM (grantInvokeRuntime)
      // Cognito auth is handled at API Gateway level, not on Runtime
      authorizerConfiguration:
        agentcore.RuntimeAuthorizerConfiguration.usingIAM(),
      environmentVariables: {
        MEMORY_ID: memory.memoryId,
        CODE_INTERPRETER_ID: codeInterpreter.codeInterpreterId,
        BROWSER_ID: browser.browserId,
        GUARDRAIL_ID: guardrail.attrGuardrailId,
        GUARDRAIL_VERSION: guardrailVersion.attrVersion,
        MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        GATEWAY_URL: "TBD",
        AGENT_OBSERVABILITY_ENABLED: "true",
        OTEL_PYTHON_DISTRO: "aws_distro",
        OTEL_PYTHON_CONFIGURATOR: "aws_configurator",
        AWS_REGION: this.region,
      },
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: Duration.minutes(15),
        maxLifetime: Duration.hours(8),
      },
    });

    // Grant Runtime access to Memory (read + write for STM/LTM)
    memory.grantRead(runtime);
    memory.grantWrite(runtime);

    // Grant Runtime explicit LTM batch write (not covered by grantWrite)
    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock-agentcore:BatchCreateMemoryRecords"],
        resources: [memory.memoryArn],
      })
    );

    // Grant Runtime access to Code Interpreter
    codeInterpreter.grantUse(runtime);

    // Grant Runtime access to Browser
    browser.grantUse(runtime);

    // Grant Runtime Bedrock model access (foundation models + cross-region inference profiles)
    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: [
          "arn:aws:bedrock:*::foundation-model/*",
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      })
    );

    // Grant Runtime access to Bedrock Guardrails
    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:ApplyGuardrail",
          "bedrock:GetGuardrail",
        ],
        resources: [guardrail.attrGuardrailArn],
      })
    );

    // Grant Runtime access to Secrets Manager (Tavily API key)
    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        resources: [`${tavilySecret.secretArn}*`],
      })
    );

    // ─── AgentCore Gateway ─────────────────────────────────────────────────
    const gateway = new agentcore.Gateway(this, "AgentCoreGateway", {
      gatewayName: "agentcore-quickstart-gateway",
      description: "MCP Gateway for AgentCore QuickStart",
      protocolConfiguration: agentcore.GatewayProtocol.mcp({
        searchType: agentcore.McpGatewaySearchType.SEMANTIC,
      }),
      authorizerConfiguration: agentcore.GatewayAuthorizer.usingCognito({
        userPool,
        allowedClients: [userPoolClient],
      }),
    });

    // No targets added — developer adds their own (OpenAPI, MCP Server, API GW, etc.)
    // See: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-supported-targets.html

    // ─── AgentCore Policy ──────────────────────────────────────────────────
    // Policy (Cedar authorization on Gateway) is a post-deploy step because:
    // 1. PolicyEngine must be associated with Gateway via update_gateway API (not in CFN)
    // 2. Cedar policies reference the Gateway ARN which requires the association first
    // See: scripts/post-deploy.sh and
    // https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-getting-started.html

    // Pass Gateway URL to Runtime so agent code can connect via MCP client
    const cfnRuntime = runtime.node.defaultChild as any;
    cfnRuntime.addPropertyOverride(
      "EnvironmentVariables.GATEWAY_URL",
      gateway.gatewayUrl
    );

    // ─── Lambda Bridge (API GW → Lambda → AgentCore Runtime) ───────────────
    const lambdaRole = new iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });

    // Grant Lambda permission to invoke the AgentCore Runtime (scoped)
    runtime.grantInvokeRuntime(lambdaRole);

    const agentCoreLambda = new lambda.Function(
      this,
      "AgentCoreIntegrationLambda",
      {
        functionName: "agentcore-integration",
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "index.lambda_handler",
        code: lambda.Code.fromAsset(
          join(__dirname, "../../functions/agentcore-integration"),
          {
            bundling: {
              image: lambda.Runtime.PYTHON_3_12.bundlingImage,
              command: [
                "bash",
                "-c",
                "pip install -r requirements.txt -t /asset-output && cp -au . /asset-output",
              ],
            },
          }
        ),
        role: lambdaRole,
        timeout: Duration.seconds(120),
        memorySize: 512,
        environment: {
          AGENTCORE_RUNTIME_ARN: runtime.agentRuntimeArn,
          REGION: this.region,
        },
        tracing: lambda.Tracing.ACTIVE,
      }
    );

    // ─── API Gateway ───────────────────────────────────────────────────────
    const api = new apigw.RestApi(this, "AgentCoreApi", {
      restApiName: "agentcore-quickstart-api",
      description: "AgentCore QuickStart API",
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "X-Api-Key",
          "Authorization",
          "X-Session-ID",
        ],
      },
      deployOptions: {
        stageName: "prod",
        tracingEnabled: true,
      },
    });

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(
      this,
      "AgentCoreAuthorizer",
      {
        cognitoUserPools: [userPool],
        authorizerName: "AgentCoreAuthorizer",
      }
    );

    // Health check endpoint (no auth)
    api.root.addMethod(
      "GET",
      new apigw.MockIntegration({
        integrationResponses: [
          {
            statusCode: "200",
            responseTemplates: {
              "application/json": JSON.stringify({
                message: "AgentCore QuickStart API is running",
                status: "healthy",
              }),
            },
          },
        ],
        requestTemplates: {
          "application/json": JSON.stringify({ statusCode: 200 }),
        },
      }),
      {
        methodResponses: [{ statusCode: "200" }],
        authorizer: undefined,
        authorizationType: apigw.AuthorizationType.NONE,
      }
    );

    // Agent invocation endpoint (Cognito auth with write scope)
    const agentResource = api.root.addResource("agent");
    agentResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(agentCoreLambda),
      {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
        authorizationScopes: [
          `${resourceServer.userPoolResourceServerId}/write`,
        ],
      }
    );

    // Usage plan for throttling
    api.addUsagePlan("AgentCoreUsagePlan", {
      name: "agentcore-quickstart-usage-plan",
      description: "Usage plan for AgentCore QuickStart",
      apiStages: [{ api, stage: api.deploymentStage }],
      throttle: { rateLimit: 100, burstLimit: 200 },
    });

    // ─── CloudWatch ────────────────────────────────────────────────────────
    const apiGatewayLogGroup = new logs.LogGroup(
      this,
      "AgentCoreApiGatewayLogGroup",
      {
        logGroupName: `/aws/apigateway/${api.restApiId}/${api.deploymentStage.stageName}`,
        removalPolicy: RemovalPolicy.DESTROY,
        retention: logs.RetentionDays.ONE_WEEK,
      }
    );

    const agentCoreLogGroup = new logs.LogGroup(
      this,
      "AgentCoreLambdaLogGroup",
      {
        logGroupName: "/aws/lambda/agentcore-integration",
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    const alertTopic = new sns.Topic(this, "AgentCoreAlertTopic", {
      topicName: "agentcore-quickstart-alerts",
      displayName: "AgentCore QuickStart Alerts",
    });

    // ─── CloudWatch Alarms ─────────────────────────────────────────────────
    // Each alarm publishes to alertTopic so subscribers (email, Slack, pager)
    // are notified. Dimension keys/values use CDK token refs so they resolve
    // to the actual deployed resource at synth.

    const userErrorsAlarm = new cloudwatch.Alarm(this, "AgentCoreUserErrorsAlarm", {
      alarmName: "agentcore-runtime-user-errors-high",
      alarmDescription:
        "AgentCore Runtime is returning a high number of user errors (malformed requests, auth failures, etc.).",
      metric: new cloudwatch.Metric({
        namespace: "bedrock-agentcore",
        metricName: "UserErrors",
        dimensionsMap: {
          ResourceArn: runtime.agentRuntimeArn,
          Operation: "InvokeAgentRuntime",
        },
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const guardrailInterventionsAlarm = new cloudwatch.Alarm(this, "GuardrailInterventionsAlarm", {
      alarmName: "bedrock-guardrail-interventions-high",
      alarmDescription:
        "Bedrock Guardrails is intervening on a high number of invocations.",
      metric: new cloudwatch.Metric({
        namespace: "AWS/Bedrock/Guardrails",
        metricName: "InvocationsIntervened",
        dimensionsMap: {
          GuardrailArn: guardrail.attrGuardrailArn,
        },
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const snsAction = new cw_actions.SnsAction(alertTopic);
    userErrorsAlarm.addAlarmAction(snsAction);
    guardrailInterventionsAlarm.addAlarmAction(snsAction);

    // ─── Outputs ───────────────────────────────────────────────────────────
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

    new CfnOutput(this, "RuntimeArn", {
      value: runtime.agentRuntimeArn,
      description: "AgentCore Runtime ARN",
    });

    new CfnOutput(this, "RuntimeId", {
      value: runtime.agentRuntimeId,
      description: "AgentCore Runtime ID",
    });

    new CfnOutput(this, "MemoryId", {
      value: memory.memoryId,
      description: "AgentCore Memory ID",
    });

    new CfnOutput(this, "MemoryArn", {
      value: memory.memoryArn,
      description: "AgentCore Memory ARN",
    });

    new CfnOutput(this, "GatewayId", {
      value: gateway.gatewayId,
      description: "AgentCore Gateway ID",
    });

    new CfnOutput(this, "GatewayUrl", {
      value: gateway.gatewayUrl ?? "N/A",
      description: "AgentCore Gateway URL",
    });

    new CfnOutput(this, "CodeInterpreterId", {
      value: codeInterpreter.codeInterpreterId,
      description: "AgentCore Code Interpreter ID",
    });

    new CfnOutput(this, "BrowserId", {
      value: browser.browserId,
      description: "AgentCore Browser ID",
    });

    new CfnOutput(this, "GuardrailId", {
      value: guardrail.attrGuardrailId,
      description: "Bedrock Guardrail ID",
    });

    new CfnOutput(this, "GuardrailVersion", {
      value: guardrailVersion.attrVersion,
      description: "Bedrock Guardrail Version",
    });

    new CfnOutput(this, "TavilySecretArn", {
      value: tavilySecret.secretArn,
      description: "Tavily API key secret ARN",
    });

    new CfnOutput(this, "BucketName", {
      value: agentCoreBucket.bucketName,
      description: "S3 bucket for AgentCore artifacts",
    });

    new CfnOutput(this, "BridgeLambdaArn", {
      value: agentCoreLambda.functionArn,
      description: "AgentCore Integration Lambda ARN",
    });

    // ─── OSS Foundation (deployed separately as OSSFoundationStack) ───────
    // Roles, collection, and access policy all live in the foundation stack.
    // Importing them here ensures the access policy was created after the roles
    // existed, so AOSS has already validated these principals.
    const collectionArn = Fn.importValue(OSS_EXPORTS.collectionArn);
    const collectionEndpoint = Fn.importValue(OSS_EXPORTS.collectionEndpoint);

    // ─── Import pre-existing IAM roles from OSSFoundationStack ────────────
    const kbRole = iam.Role.fromRoleName(this, "KnowledgeBaseRole", KB_ROLE_NAME);

    // S3 access is added here because the bucket lives in this stack
    kbRole.attachInlinePolicy(new iam.Policy(this, "KBRoleS3Policy", {
      statements: [new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:ListBucket"],
        resources: [agentCoreBucket.bucketArn, `${agentCoreBucket.bucketArn}/uploads/*`],
      })],
    }));

    // ─── Bedrock Knowledge Base ────────────────────────────────────────────
    // The vector index "everybody-counts-index" must exist in the AOSS collection
    // before this KB is created. It was created once via the console (AOSS has no
    // native CFN resource for vector indices, and the Custom Resource Lambda was
    // blocked by the OpenSearch security plugin layer).
    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, "EverybodyCountsKB", {
      name: "everybody-counts-kb",
      description: "Everybody Counts KS1 math teaching materials",
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        },
      },
      storageConfiguration: {
        type: "OPENSEARCH_SERVERLESS",
        opensearchServerlessConfiguration: {
          collectionArn: collectionArn,
          vectorIndexName: "everybody-counts-index",
          fieldMapping: {
            vectorField: "embedding",
            textField: "text",
            metadataField: "metadata",
          },
        },
      },
    });
    const dataSource = new bedrock.CfnDataSource(this, "EverybodyCountsDataSource", {
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      name: "everybody-counts-uploads",
      description: "Admin-uploaded teaching materials (PDF, DOCX, PPTX)",
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: {
          bucketArn: agentCoreBucket.bucketArn,
          inclusionPrefixes: ["uploads/"],
        },
      },
    });

    // ─── KB Sync Lambda ────────────────────────────────────────────────────
    const kbSyncRole = new iam.Role(this, "KBSyncRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });
    kbSyncRole.addToPolicy(new iam.PolicyStatement({
      actions: ["bedrock:StartIngestionJob"],
      resources: [knowledgeBase.attrKnowledgeBaseArn],
    }));

    const kbSyncLambda = new lambda.Function(this, "KBSyncLambda", {
      functionName: "everybody-counts-kb-sync",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(join(__dirname, "../../functions/kb-sync")),
      role: kbSyncRole,
      timeout: Duration.minutes(1),
      environment: {
        KB_ID: knowledgeBase.attrKnowledgeBaseId,
        DATA_SOURCE_ID: dataSource.attrDataSourceId,
        REGION: this.region,
      },
    });

    agentCoreBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(kbSyncLambda),
      { prefix: "uploads/" },
    );

    // ─── Chat Handler Lambda (RAG + Claude) ────────────────────────────────
    const chatHandlerRole = new iam.Role(this, "ChatHandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });
    chatHandlerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["bedrock:Retrieve"],
      resources: [knowledgeBase.attrKnowledgeBaseArn],
    }));
    chatHandlerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      resources: [
        "arn:aws:bedrock:*::foundation-model/*",
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    }));
    chatHandlerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["bedrock:ApplyGuardrail"],
      resources: [guardrail.attrGuardrailArn],
    }));

    const chatHandlerLambda = new lambda.Function(this, "ChatHandlerLambda", {
      functionName: "everybody-counts-chat-handler",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(join(__dirname, "../../functions/chat-handler")),
      role: chatHandlerRole,
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: {
        KB_ID: knowledgeBase.attrKnowledgeBaseId,
        MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        GUARDRAIL_ID: guardrail.attrGuardrailId,
        GUARDRAIL_VERSION: guardrailVersion.attrVersion,
        REGION: this.region,
      },
    });

    const chatResource = api.root.addResource("chat");
    chatResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(chatHandlerLambda),
      {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      }
    );

    new CfnOutput(this, "KnowledgeBaseId", {
      value: knowledgeBase.attrKnowledgeBaseId,
      description: "Bedrock Knowledge Base ID",
    });

    new CfnOutput(this, "DataSourceId", {
      value: dataSource.attrDataSourceId,
      description: "Bedrock KB Data Source ID",
    });

    new CfnOutput(this, "OSSCollectionArn", {
      value: collectionArn,
      description: "OpenSearch Serverless Collection ARN (from OSSFoundationStack)",
    });

    new CfnOutput(this, "FrontendClientId", {
      value: frontendClient.userPoolClientId,
      description: "Cognito App Client ID for the React frontend (no secret)",
    });
  }
}
