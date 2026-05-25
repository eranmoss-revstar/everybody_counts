"""
kb-sync Lambda — triggered by S3 ObjectCreated on uploads/*
Starts a Bedrock Knowledge Base ingestion job to index the new document.
"""

import boto3
import os
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

KB_ID = os.environ["KB_ID"]
DATA_SOURCE_ID = os.environ["DATA_SOURCE_ID"]
REGION = os.environ.get("REGION", "us-east-1")


def lambda_handler(event, context):
    bedrock = boto3.client("bedrock-agent", region_name=REGION)

    for record in event.get("Records", []):
        key = record["s3"]["object"]["key"]
        logger.info(f"New upload detected: {key} — starting ingestion job")

        response = bedrock.start_ingestion_job(
            knowledgeBaseId=KB_ID,
            dataSourceId=DATA_SOURCE_ID,
        )

        job_id = response["ingestionJob"]["ingestionJobId"]
        logger.info(f"Ingestion job started: {job_id}")

    return {"status": "ok"}
