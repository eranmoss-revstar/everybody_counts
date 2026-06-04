# LibreOffice-based PPTX→PDF converter on the AWS Lambda Python base (Amazon Linux 2023).
FROM public.ecr.aws/lambda/python:3.12

# LibreOffice (headless) + a few fonts so slide text renders correctly.
RUN dnf install -y \
        libreoffice-impress \
        libreoffice-core \
        google-noto-sans-fonts \
        google-noto-serif-fonts \
        dejavu-sans-fonts \
    && dnf clean all \
    && rm -rf /var/cache/dnf

COPY index.py ${LAMBDA_TASK_ROOT}/

CMD ["index.lambda_handler"]
