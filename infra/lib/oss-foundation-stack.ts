import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as oss from "aws-cdk-lib/aws-opensearchserverless";

const COLLECTION_NAME = "everybody-counts-kb";
const ACCOUNT_ID = "111974299507";

export const KB_ROLE_NAME = "everybody-counts-kb-role";
export const OSS_CREATOR_ROLE_NAME = "everybody-counts-oss-creator-role";

export const OSS_EXPORTS = {
  collectionArn: "EverybodyCountsOSSCollectionArn",
  collectionEndpoint: "EverybodyCountsOSSCollectionEndpoint",
};

export class OSSFoundationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // IAM roles are created HERE so they exist before the OSS access policy is created.
    // AOSS validates principals at access policy creation time — roles that don't exist
    // yet are silently ignored, causing persistent 403s when the Lambda runs later.
    const kbRole = new iam.Role(this, "KnowledgeBaseRole", {
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com"),
      roleName: KB_ROLE_NAME,
    });
    kbRole.addToPolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`],
    }));

    const ossCreatorRole = new iam.Role(this, "OSSIndexCreatorRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      roleName: OSS_CREATOR_ROLE_NAME,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });

    const ossEncryptionPolicy = new oss.CfnSecurityPolicy(this, "OSSEncryptionPolicy", {
      name: "everybody-counts-enc",
      type: "encryption",
      policy: JSON.stringify({
        Rules: [{ ResourceType: "collection", Resource: [`collection/${COLLECTION_NAME}`] }],
        AWSOwnedKey: true,
      }),
    });

    const ossNetworkPolicy = new oss.CfnSecurityPolicy(this, "OSSNetworkPolicy", {
      name: "everybody-counts-net",
      type: "network",
      policy: JSON.stringify([{
        Rules: [
          { ResourceType: "collection", Resource: [`collection/${COLLECTION_NAME}`] },
          { ResourceType: "dashboard",  Resource: [`collection/${COLLECTION_NAME}`] },
        ],
        AllowFromPublic: true,
      }]),
    });

    // Access policy created AFTER the roles exist — AOSS validates principals at creation time.
    const ossAccessPolicy = new oss.CfnAccessPolicy(this, "OSSAccessPolicy", {
      name: "everybody-counts-access",
      type: "data",
      policy: JSON.stringify([{
        Rules: [
          {
            ResourceType: "collection",
            Resource: [`collection/${COLLECTION_NAME}`],
            Permission: [
              "aoss:CreateCollectionItems",
              "aoss:DeleteCollectionItems",
              "aoss:UpdateCollectionItems",
              "aoss:DescribeCollectionItems",
            ],
          },
          {
            ResourceType: "index",
            Resource: [`index/${COLLECTION_NAME}/*`],
            Permission: [
              "aoss:CreateIndex",
              "aoss:DeleteIndex",
              "aoss:UpdateIndex",
              "aoss:DescribeIndex",
              "aoss:ReadDocument",
              "aoss:WriteDocument",
            ],
          },
        ],
        Principal: [
          `arn:aws:iam::${ACCOUNT_ID}:role/${KB_ROLE_NAME}`,
          `arn:aws:iam::${ACCOUNT_ID}:role/${OSS_CREATOR_ROLE_NAME}`,
          `arn:aws:iam::${ACCOUNT_ID}:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_AdministratorAccess_c2f50ea59aec207a`,
        ],
      }]),
    });
    // Explicit ordering: roles must exist before the access policy is created
    ossAccessPolicy.node.addDependency(kbRole);
    ossAccessPolicy.node.addDependency(ossCreatorRole);

    const ossCollection = new oss.CfnCollection(this, "OSSCollection", {
      name: COLLECTION_NAME,
      type: "VECTORSEARCH",
      description: "Vector store for Everybody Counts Knowledge Base",
    });
    ossCollection.addDependency(ossEncryptionPolicy);
    ossCollection.addDependency(ossNetworkPolicy);

    // Add aoss:APIAccessAll to both roles after the collection ARN is known
    kbRole.addToPolicy(new iam.PolicyStatement({
      actions: ["aoss:APIAccessAll"],
      resources: [ossCollection.attrArn],
    }));
    ossCreatorRole.addToPolicy(new iam.PolicyStatement({
      actions: ["aoss:APIAccessAll"],
      resources: [ossCollection.attrArn],
    }));

    new CfnOutput(this, "CollectionArn", {
      value: ossCollection.attrArn,
      exportName: OSS_EXPORTS.collectionArn,
    });

    new CfnOutput(this, "CollectionEndpoint", {
      value: ossCollection.attrCollectionEndpoint,
      exportName: OSS_EXPORTS.collectionEndpoint,
    });
  }
}
