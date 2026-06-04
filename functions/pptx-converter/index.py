"""
pptx-converter Lambda (container image with LibreOffice)
Triggered by S3 ObjectCreated on uploads/*.pptx (and .ppt).
Converts the PowerPoint to PDF, writes the PDF alongside it, deletes the original.
The resulting PDF re-triggers kb-sync and is parsed by the multimodal KB parser.
"""

import os
import logging
import subprocess
import tempfile
import urllib.parse

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")


def _convert_one(bucket: str, key: str) -> None:
    if not key.lower().endswith((".pptx", ".ppt")):
        return

    workdir = tempfile.mkdtemp(dir="/tmp")
    local_in = os.path.join(workdir, os.path.basename(key))

    logger.info(f"Downloading s3://{bucket}/{key}")
    s3.download_file(bucket, key, local_in)

    # LibreOffice needs a writable HOME for its user profile.
    env = {**os.environ, "HOME": "/tmp"}
    logger.info(f"Converting {os.path.basename(key)} to PDF")
    result = subprocess.run(
        ["libreoffice", "--headless", "--norestore",
         "--convert-to", "pdf", "--outdir", workdir, local_in],
        capture_output=True, text=True, env=env, timeout=270,
    )
    logger.info(f"libreoffice stdout: {result.stdout.strip()}")
    if result.returncode != 0:
        logger.error(f"libreoffice failed ({result.returncode}): {result.stderr.strip()}")
        raise RuntimeError(f"Conversion failed for {key}")

    local_pdf = os.path.splitext(local_in)[0] + ".pdf"
    if not os.path.exists(local_pdf):
        raise RuntimeError(f"No PDF produced for {key}")

    pdf_key = os.path.splitext(key)[0] + ".pdf"
    logger.info(f"Uploading s3://{bucket}/{pdf_key}")
    s3.upload_file(local_pdf, bucket, pdf_key)

    logger.info(f"Deleting original s3://{bucket}/{key}")
    s3.delete_object(Bucket=bucket, Key=key)


def lambda_handler(event, context):
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        try:
            _convert_one(bucket, key)
        except Exception as e:
            logger.error(f"Failed to convert {key}: {e}", exc_info=True)
            # Do not raise — one bad file shouldn't fail the whole batch event
    return {"status": "ok"}
