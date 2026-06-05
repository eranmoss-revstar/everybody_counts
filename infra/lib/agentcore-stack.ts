import {
  Stack,
  StackProps,
  Duration,
  CfnOutput,
  RemovalPolicy,
  Tags,
  Size,
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
import * as ssm from "aws-cdk-lib/aws-ssm";
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

    // Cognito admins group — members can configure LLM behaviour via /admin/settings
    new cognito.CfnUserPoolGroup(this, "AdminsGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "admins",
      description: "Administrators who can configure LLM behaviour",
    });

    // ─── SSM Parameters (admin-configurable LLM settings) ─────────────────
    const temperatureParam = new ssm.StringParameter(this, "LlmTemperature", {
      parameterName: "/everybody-counts/llm/temperature",
      stringValue: "0.7",
      description: "LLM temperature: 0.2=precise, 0.7=balanced, 0.9=creative",
    });

    const maxTokensParam = new ssm.StringParameter(this, "LlmMaxTokens", {
      parameterName: "/everybody-counts/llm/max_tokens",
      stringValue: "2048",
      description: "LLM max tokens: 1024=brief, 2048=standard, 4096=detailed",
    });

    const formatParam = new ssm.StringParameter(this, "LlmFormat", {
      parameterName: "/everybody-counts/llm/format",
      stringValue: "structured",
      description: "Response format: structured, prose, step_by_step",
    });

    const outputTypeParam = new ssm.StringParameter(this, "LlmOutputType", {
      parameterName: "/everybody-counts/llm/output_type",
      stringValue: "explanation",
      description: "Output type: explanation, lesson_plan, activity_ideas",
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
      // Topic policy — backstop for the system prompt: deny common off-scope
      // categories so the assistant stays on KS1 teaching even under adversarial prompts.
      topicPolicyConfig: {
        topicsConfig: [
          {
            name: "Medical or Health Advice",
            definition:
              "Requests for medical diagnosis, treatment, medication, mental-health, or physical-health advice for children or adults.",
            examples: [
              "What medication should I give a child with ADHD?",
              "Is this rash on a pupil dangerous?",
            ],
            type: "DENY",
          },
          {
            name: "Legal Advice",
            definition:
              "Requests for interpretation of laws, legal rights, safeguarding-law specifics, or other legal guidance.",
            examples: [
              "Can I legally restrain a pupil?",
              "What are my legal rights if a parent sues the school?",
            ],
            type: "DENY",
          },
          {
            name: "Financial or Investment Advice",
            definition:
              "Requests for financial, investment, tax, pension, or money-management advice.",
            examples: [
              "How should I invest my teaching pension?",
              "What stocks should I buy?",
            ],
            type: "DENY",
          },
          {
            name: "Non-Educational Topics",
            definition:
              "Requests unrelated to teaching, education, or the school curriculum — including general knowledge, entertainment, celebrities, sports, current events, politics, or personal-life advice.",
            examples: [
              "Who is going to win the election?",
              "Write me a poem about football.",
              "What should I cook for dinner tonight?",
            ],
            type: "DENY",
          },
        ],
      },
      // Profanity filter (managed list) — appropriate for a tool used in a primary-school context.
      wordPolicyConfig: {
        managedWordListsConfig: [{ type: "PROFANITY" }],
      },
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: [
          // Anonymise contact/identity details that may appear in pupil data.
          { type: "EMAIL", action: "ANONYMIZE" },
          { type: "NAME", action: "ANONYMIZE" },
          { type: "PHONE", action: "ANONYMIZE" },
          { type: "ADDRESS", action: "ANONYMIZE" },
          // Block high-risk identifiers outright.
          { type: "PASSWORD", action: "BLOCK" },
          { type: "US_SOCIAL_SECURITY_NUMBER", action: "BLOCK" },
          { type: "CREDIT_DEBIT_CARD_NUMBER", action: "BLOCK" },
          { type: "UK_NATIONAL_INSURANCE_NUMBER", action: "BLOCK" },
          { type: "UK_NATIONAL_HEALTH_SERVICE_NUMBER", action: "BLOCK" },
        ],
      },
    });

    // Bumped logical ID to V2 to force CFN to publish a NEW version snapshotting
    // the updated DRAFT (topic policy, expanded PII, profanity). A new logical ID
    // creates a new version; editing the description in place would not.
    const guardrailVersion = new bedrock.CfnGuardrailVersion(
      this,
      "AgentCoreGuardrailVersionV2",
      {
        guardrailIdentifier: guardrail.attrGuardrailId,
        description: "Topic policy, expanded PII, profanity filter",
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
        MODEL_ID: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
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
    // KB_ID is set after knowledgeBase is declared (further down this file)
    // — see the override below the knowledgeBase declaration.

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
          USER_POOL_ID: userPool.userPoolId,
          COGNITO_CLIENT_ID: frontendClient.userPoolClientId,
          SSM_TEMPERATURE_PARAM: temperatureParam.parameterName,
          SSM_MAX_TOKENS_PARAM: maxTokensParam.parameterName,
          SSM_FORMAT_PARAM: formatParam.parameterName,
          SSM_OUTPUT_TYPE_PARAM: outputTypeParam.parameterName,
        },
        tracing: lambda.Tracing.ACTIVE,
      }
    );

    temperatureParam.grantRead(agentCoreLambda);
    maxTokensParam.grantRead(agentCoreLambda);
    formatParam.grantRead(agentCoreLambda);
    outputTypeParam.grantRead(agentCoreLambda);

    // Read access so the Lambda can generate presigned URLs for source documents
    agentCoreBucket.grantRead(agentCoreLambda);

    // ─── Lambda Function URL (bypasses API Gateway 29s hard limit for AgentCore) ─
    const chatFunctionUrl = agentCoreLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,  // Cognito JWT verified inside the Lambda
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['Content-Type', 'Authorization'],
      },
    });

    new CfnOutput(this, "ChatFunctionUrl", {
      value: chatFunctionUrl.url,
      description: "Lambda Function URL for POST /chat (no API GW timeout)",
    });

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

    // S3 access is added here because the bucket lives in this stack.
    // bedrock:InvokeModel lets the KB run the foundation-model parser at ingestion.
    const kbRolePolicy = new iam.Policy(this, "KBRoleS3Policy", {
      statements: [
        new iam.PolicyStatement({
          actions: ["s3:GetObject", "s3:ListBucket"],
          resources: [agentCoreBucket.bucketArn, `${agentCoreBucket.bucketArn}/uploads/*`],
        }),
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeModel", "bedrock:GetInferenceProfile"],
          // Inference profile + the underlying foundation model in each region the
          // us. profile can route to (cross-region inference requires all of them).
          resources: [
            `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0`,
            "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0",
            "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0",
            "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0",
          ],
        }),
      ],
    });
    kbRole.attachInlinePolicy(kbRolePolicy);

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
    // Parsing model — a multimodal FM reads each document at ingestion and writes
    // text descriptions of diagrams, charts, tables and visual layouts, so the KB
    // captures visual content as searchable text (no image-display pipeline needed).
    // Uses the Claude Sonnet 4.5 cross-region inference profile (on-demand).
    const parsingModelArn = `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0`;

    const dataSource = new bedrock.CfnDataSource(this, "EverybodyCountsDataSource", {
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      // Renamed when foundation-model parsing was added: changing the ingestion
      // config forces a CFN replacement, and a new name avoids the create-before-
      // delete name collision. The old data source has dataDeletionPolicy DELETE,
      // so its vectors are purged on replacement (re-ingest repopulates).
      name: "everybody-counts-uploads-multimodal",
      description: "Admin-uploaded teaching materials (PDF, DOCX, PPTX) — multimodal parsing",
      dataDeletionPolicy: "DELETE",
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: {
          bucketArn: agentCoreBucket.bucketArn,
          inclusionPrefixes: ["uploads/"],
        },
      },
      vectorIngestionConfiguration: {
        parsingConfiguration: {
          parsingStrategy: "BEDROCK_FOUNDATION_MODEL",
          bedrockFoundationModelConfiguration: {
            modelArn: parsingModelArn,
            parsingPrompt: {
              parsingPromptText:
                "Transcribe all text from this page of a UK KS1 (Year 1–2) maths teaching document. " +
                "In addition, for every MEANINGFUL mathematical diagram, chart, table, model, or visual layout on the page, " +
                "write a clear text description of what it shows and how it is arranged, on its own line prefixed with 'VISUAL: '. " +
                "Describe place-value charts, part-whole models, number lines, arrays, ten-frames, bead strings, and manipulative " +
                "arrangements precisely enough that a teacher could picture and recreate them without seeing the original image. " +
                "Do NOT write a VISUAL line for logos, branding, watermarks, copyright notices, page numbers, headers, footers, " +
                "or decorative page furniture — ignore those entirely. " +
                "Preserve the reading order of the page.",
            },
          },
        },
      },
    });

    // The KB role must have GetInferenceProfile/InvokeModel BEFORE the data source
    // is validated — without this dependency CFN can validate the data source first
    // and fail, rolling the policy back and leaving us stuck in a loop.
    dataSource.node.addDependency(kbRolePolicy);

    // ─── Wire KB into AgentCore Runtime ───────────────────────────────────
    // Now that knowledgeBase exists, inject its ID into the Runtime env and
    // grant the Runtime permission to retrieve from it.
    cfnRuntime.addPropertyOverride(
      "EnvironmentVariables.KB_ID",
      knowledgeBase.attrKnowledgeBaseId
    );

    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:Retrieve"],
        resources: [knowledgeBase.attrKnowledgeBaseArn],
      })
    );

    // ─── PPTX → PDF Converter Lambda (LibreOffice container) ───────────────
    // PowerPoint isn't a KB-supported format. This converts uploaded .pptx/.ppt
    // to PDF (KB-supported, and parsed by the multimodal model), then deletes the
    // original. Runs before kb-sync via the S3 event; the produced PDF re-triggers
    // kb-sync for ingestion.
    const pptxConverter = new lambda.DockerImageFunction(this, "PptxConverterLambda", {
      functionName: "everybody-counts-pptx-converter",
      code: lambda.DockerImageCode.fromImageAsset(
        join(__dirname, "../../functions/pptx-converter"),
      ),
      timeout: Duration.minutes(5),
      memorySize: 2048,
      ephemeralStorageSize: Size.gibibytes(2),
    });
    agentCoreBucket.grantReadWrite(pptxConverter);
    agentCoreBucket.grantDelete(pptxConverter);
    // Note: no direct S3 trigger here — S3 forbids overlapping prefix/suffix rules
    // for the same event. kb-sync is the single uploads/ trigger and dispatches
    // PPTX to this converter (see below).

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
        CONVERTER_FUNCTION_NAME: pptxConverter.functionName,
      },
    });

    // kb-sync dispatches PPTX uploads to the converter instead of ingesting them.
    pptxConverter.grantInvoke(kbSyncLambda);

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
    chatHandlerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["aws-marketplace:ViewSubscriptions", "aws-marketplace:Subscribe"],
      resources: ["*"],
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
        MODEL_ID: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        GUARDRAIL_ID: guardrail.attrGuardrailId,
        GUARDRAIL_VERSION: guardrailVersion.attrVersion,
        REGION: this.region,
      },
    });

    // ─── Admin Settings Lambda ─────────────────────────────────────────────
    const adminSettingsLambda = new lambda.Function(this, "AdminSettingsLambda", {
      functionName: "everybody-counts-admin-settings",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(join(__dirname, "../../functions/admin-settings")),
      timeout: Duration.seconds(10),
      memorySize: 128,
      environment: {
        REGION: this.region,
        SSM_TEMPERATURE_PARAM: temperatureParam.parameterName,
        SSM_MAX_TOKENS_PARAM: maxTokensParam.parameterName,
        SSM_FORMAT_PARAM: formatParam.parameterName,
        SSM_OUTPUT_TYPE_PARAM: outputTypeParam.parameterName,
      },
    });
    temperatureParam.grantRead(adminSettingsLambda);
    temperatureParam.grantWrite(adminSettingsLambda);
    maxTokensParam.grantRead(adminSettingsLambda);
    maxTokensParam.grantWrite(adminSettingsLambda);
    formatParam.grantRead(adminSettingsLambda);
    formatParam.grantWrite(adminSettingsLambda);
    outputTypeParam.grantRead(adminSettingsLambda);
    outputTypeParam.grantWrite(adminSettingsLambda);

    const adminResource = api.root.addResource("admin");
    const adminSettingsResource = adminResource.addResource("settings");
    adminSettingsResource.addMethod("GET", new apigw.LambdaIntegration(adminSettingsLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    adminSettingsResource.addMethod("PUT", new apigw.LambdaIntegration(adminSettingsLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    const chatResource = api.root.addResource("chat");
    chatResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(agentCoreLambda),
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
