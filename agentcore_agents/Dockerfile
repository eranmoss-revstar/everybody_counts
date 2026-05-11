FROM python:3.12-slim-bookworm

WORKDIR /app

# Install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy agent code
COPY app.py ./
COPY tools/ ./tools/

EXPOSE 8080

CMD ["python", "app.py"]
