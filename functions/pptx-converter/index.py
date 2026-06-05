"""
pptx-converter Lambda (container image with LibreOffice + Ghostscript)
Triggered (via kb-sync dispatch) for uploads/*.pptx and *.ppt.
Converts the PowerPoint to PDF, downsizes it below the KB file-size limit if
needed, writes the PDF alongside it, and deletes the original. The resulting
PDF re-triggers kb-sync and is parsed by the multimodal KB parser.
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

# Bedrock KB rejects files larger than 50 MB. Compress when we get close, and
# target comfortably under the limit.
KB_MAX_BYTES = 50 * 1024 * 1024
COMPRESS_THRESHOLD = 45 * 1024 * 1024


def _ghostscript_compress(src: str, workdir: str, setting: str) -> str:
    """Downsample a PDF with Ghostscript. setting: /ebook (150dpi) or /screen (72dpi)."""
    out = os.path.join(workdir, f"compressed{setting.replace('/', '_')}.pdf")
    subprocess.run(
        ["gs", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5",
         f"-dPDFSETTINGS={setting}", "-dNOPAUSE", "-dQUIET", "-dBATCH",
         f"-sOutputFile={out}", src],
        check=True, timeout=240,
    )
    return out


def _ensure_under_limit(pdf_path: str, workdir: str) -> str:
    """If the PDF is too large, compress it. /ebook keeps diagrams legible for the
    multimodal parser; fall back to /screen only if /ebook isn't enough."""
    size = os.path.getsize(pdf_path)
    if size <= COMPRESS_THRESHOLD:
        return pdf_path

    logger.info(f"PDF is {size/1e6:.1f} MB — compressing")
    best = pdf_path
    for setting in ("/ebook", "/screen"):
        try:
            candidate = _ghostscript_compress(pdf_path, workdir, setting)
        except Exception as e:
            logger.warning(f"Ghostscript {setting} failed: {e}")
            continue
        csize = os.path.getsize(candidate)
        logger.info(f"  {setting} -> {csize/1e6:.1f} MB")
        best = candidate
        if csize <= KB_MAX_BYTES:
            break
    return best


def _convert_one(bucket: str, key: str) -> None:
    if not key.lower().endswith((".pptx", ".ppt")):
        return

    workdir = tempfile.mkdtemp(dir="/tmp")
    local_in = os.path.join(workdir, os.path.basename(key))

    logger.info(f"Downloading s3://{bucket}/{key}")
    s3.download_file(bucket, key, local_in)

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

    local_pdf = _ensure_under_limit(local_pdf, workdir)

    pdf_key = os.path.splitext(key)[0] + ".pdf"
    logger.info(f"Uploading s3://{bucket}/{pdf_key} ({os.path.getsize(local_pdf)/1e6:.1f} MB)")
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
