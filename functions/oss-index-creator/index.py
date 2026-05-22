"""
Custom Resource Lambda — creates the OpenSearch Serverless vector index
required by Bedrock Knowledge Base before the KB is created.
Bedrock does NOT auto-create the index in custom OSS collections.
"""

import json
import os
import time
import logging
import urllib.request
import urllib.error
import boto3
import botocore.auth
import botocore.awsrequest
import cfnresponse

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.environ.get("REGION", "us-east-1")

INDEX_BODY = {
    "settings": {"index.knn": True},
    "mappings": {
        "properties": {
            "embedding": {
                "type": "knn_vector",
                "dimension": 1024,
                "method": {
                    "name": "hnsw",
                    "space_type": "l2",
                    "engine": "faiss",
                    "parameters": {"ef_construction": 512, "m": 16},
                },
            },
            "text": {"type": "text"},
            "metadata": {"type": "text"},
        }
    },
}


def lambda_handler(event, context):
    logger.info(f"Event: {json.dumps(event)}")
    request_type = event.get("RequestType")
    props = event.get("ResourceProperties", {})
    endpoint = props.get("CollectionEndpoint", "").rstrip("/")
    index_name = props.get("IndexName", "")

    try:
        if request_type == "Create":
            _create_index(endpoint, index_name)
            physical_id = f"{endpoint}/{index_name}"
        elif request_type == "Update":
            physical_id = event.get("PhysicalResourceId", f"{endpoint}/{index_name}")
        else:  # Delete
            _delete_index(endpoint, index_name)
            physical_id = event.get("PhysicalResourceId", f"{endpoint}/{index_name}")

        cfnresponse.send(event, context, cfnresponse.SUCCESS, {}, physical_id)

    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
        cfnresponse.send(event, context, cfnresponse.FAILED, {"Error": str(e)})


def _signed_http(method, url, body=None):
    """Make a SigV4-signed request to OpenSearch Serverless."""
    session = boto3.Session()
    creds = session.get_credentials().get_frozen_credentials()

    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"} if body else {}

    aws_req = botocore.awsrequest.AWSRequest(
        method=method, url=url, data=data, headers=headers
    )
    botocore.auth.SigV4Auth(creds, "aoss", REGION).add_auth(aws_req)
    prepared = aws_req.prepare()

    req = urllib.request.Request(
        url=url,
        data=data,
        headers=dict(prepared.headers),
        method=method,
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, json.loads(raw) if raw else {}


def _create_index(endpoint, index_name):
    url = f"{endpoint}/{index_name}"

    # OSS access policies take up to 60s to propagate after creation.
    # Retry with backoff on 403 before giving up.
    max_attempts = 10
    for attempt in range(1, max_attempts + 1):
        status, body = _signed_http("GET", url)
        if status == 200:
            logger.info(f"Index '{index_name}' already exists — skipping creation")
            return
        if status == 403:
            wait = min(5 * attempt, 30)
            logger.info(
                f"Access policy not yet propagated (attempt {attempt}/{max_attempts}), "
                f"retrying in {wait}s..."
            )
            time.sleep(wait)
            continue
        # Any other status (404 = doesn't exist yet) → break and create
        break
    else:
        raise Exception(
            f"OSS access policy never propagated after {max_attempts} attempts "
            f"— last GET returned 403"
        )

    logger.info(f"Creating index '{index_name}' at {endpoint}")
    # Also retry the PUT in case the access policy propagates between the GET and PUT
    for attempt in range(1, max_attempts + 1):
        status, body = _signed_http("PUT", url, INDEX_BODY)
        if status in (200, 201):
            logger.info(f"Index '{index_name}' created successfully: {body}")
            return
        if status == 403:
            wait = min(5 * attempt, 30)
            logger.info(
                f"PUT also got 403 (attempt {attempt}/{max_attempts}), "
                f"retrying in {wait}s..."
            )
            time.sleep(wait)
            continue
        raise Exception(
            f"Failed to create index '{index_name}': HTTP {status} — {body}"
        )

    raise Exception(
        f"Failed to create index '{index_name}': PUT still 403 after "
        f"{max_attempts} attempts"
    )


def _delete_index(endpoint, index_name):
    url = f"{endpoint}/{index_name}"
    status, body = _signed_http("DELETE", url)
    logger.info(f"Delete index '{index_name}': HTTP {status}")
