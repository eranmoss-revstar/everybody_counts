"""
kb-sync Lambda — triggered by S3 ObjectCreated on uploads/*
- PowerPoint (.pptx/.ppt): not a KB-supported format → dispatch to the
  pptx-converter Lambda, which writes a PDF (re-triggering this function).
- Everything else: start a Bedrock Knowledge Base ingestion job.
"""

import json
import boto3
import os
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

KB_ID = os.environ["KB_ID"]
DATA_SOURCE_ID = os.environ["DATA_SOURCE_ID"]
REGION = os.environ.get("REGION", "us-east-1")
CONVERTER_FUNCTION_NAME = os.environ.get("CONVERTER_FUNCTION_NAME", "")


def lambda_handler(event, context):
    pptx_records = []
    has_other = False

    for record in event.get("Records", []):
        key = record["s3"]["object"]["key"]
        if key.lower().endswith((".pptx", ".ppt")):
            pptx_records.append(record)
        else:
            has_other = True

    # Hand PowerPoint files to the converter (async); the resulting PDF will
    # re-trigger this function and be ingested then.
    if pptx_records and CONVERTER_FUNCTION_NAME:
        lambda_client = boto3.client("lambda", region_name=REGION)
        lambda_client.invoke(
            FunctionName=CONVERTER_FUNCTION_NAME,
            InvocationType="Event",
            Payload=json.dumps({"Records": pptx_records}).encode("utf-8"),
        )
        logger.info(f"Dispatched {len(pptx_records)} PowerPoint file(s) to the converter")

    # Ingest supported formats.
    if has_other:
        bedrock = boto3.client("bedrock-agent", region_name=REGION)
        response = bedrock.start_ingestion_job(
            knowledgeBaseId=KB_ID,
            dataSourceId=DATA_SOURCE_ID,
        )
        job_id = response["ingestionJob"]["ingestionJobId"]
        logger.info(f"Ingestion job started: {job_id}")

    return {"status": "ok"}
