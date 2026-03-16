#!/usr/bin/env node
import "source-map-support/register.js";
import * as cdk from "aws-cdk-lib";
import { AgentCoreStack } from "../lib/agentcore-stack.js";

const app = new cdk.App();

new AgentCoreStack(app, "AgentCoreQuickStartStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description:
    "AgentCore QuickStart — full boilerplate with Runtime, Memory, Gateway, Code Interpreter, Browser, Guardrails, and Observability",
});
