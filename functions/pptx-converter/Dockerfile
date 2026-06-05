# LibreOffice-based PPTX→PDF converter, with Ghostscript for downsizing large PDFs.
# The AWS Lambda / Amazon Linux 2023 base images don't carry LibreOffice in their
# repos, so we build on Debian (which does) and add the Lambda Runtime Interface
# Client to make the image Lambda-compatible.
FROM python:3.12-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-impress \
        libreoffice-core \
        ghostscript \
        fonts-dejavu \
        fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir awslambdaric boto3

WORKDIR /var/task
COPY index.py /var/task/

ENTRYPOINT ["python", "-m", "awslambdaric"]
CMD ["index.lambda_handler"]
