#!/usr/bin/env node
import "source-map-support/register.js";
import * as cdk from "aws-cdk-lib";
import { OSSFoundationStack } from "../lib/oss-foundation-stack";
import { AgentCoreStack } from "../lib/agentcore-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Deploy OSSFoundationStack FIRST, then AgentCoreQuickStartStack.
// The foundation stack creates the OSS collection and data access policy so
// they are fully propagated before the main stack's IAM roles and KB are created.
const foundation = new OSSFoundationStack(app, "EverybodyCountsOSSFoundation", {
  env,
  description: "Everybody Counts — OSS collection and access policy (deploy before main stack)",
});

const mainStack = new AgentCoreStack(app, "AgentCoreQuickStartStack", {
  env,
  description:
    "AgentCore QuickStart — full boilerplate with Runtime, Memory, Gateway, Code Interpreter, Browser, Guardrails, and Observability",
});
mainStack.addDependency(foundation);
