"""
chat-handler Lambda — POST /chat
Retrieves relevant chunks from Bedrock KB, calls Claude with context + STM history.
"""

import json
import boto3
import os
import logging
from datetime import datetime

logger = logging.getLogger()
logger.setLevel(logging.INFO)

KB_ID = os.environ["KB_ID"]
MODEL_ID = os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-5-20251001-v1:0")
GUARDRAIL_ID = os.environ["GUARDRAIL_ID"]
GUARDRAIL_VERSION = os.environ["GUARDRAIL_VERSION"]
REGION = os.environ.get("REGION", "us-east-1")

SYSTEM_PROMPT = """You are a friendly, expert KS1 mathematics teaching assistant.
You help UK primary school teachers (Key Stage 1, ages 5–7, Year 1 and Year 2) with step-by-step, classroom-ready guidance on teaching maths concepts.
Your tone is pedagogical, clarifying, and playful — encouraging for both teachers and young learners.
Base your answers on the provided teaching materials. When citing or attributing ideas, say they are drawn from the Everybody Counts knowledge base, not that they originate from or belong to the Everybody Counts programme.
If the teaching materials do not cover the question, politely say that this information is not currently available in the knowledge base.
If the question is not related to KS1 mathematics teaching (Year 1 or Year 2), politely explain that this assistant currently supports Year 1 and Year 2 maths teaching only, and you are unable to help with that topic.
Do not end your responses with follow-up questions or prompts asking if the teacher wants more information."""


def lambda_handler(event, context):
    request_id = context.aws_request_id
    logger.info(f"Processing request {request_id}")

    try:
        body = json.loads(event.get("body") or "{}")
        user_message = body.get("userMessage", "").strip()[:2000]
        conversation_history = body.get("conversationHistory", [])

        if not user_message:
            return _error(400, "userMessage is required", request_id)

        bedrock_agent_runtime = boto3.client("bedrock-agent-runtime", region_name=REGION)
        bedrock_runtime = boto3.client("bedrock-runtime", region_name=REGION)

        # Retrieve relevant chunks from Knowledge Base
        retrieve_resp = bedrock_agent_runtime.retrieve(
            knowledgeBaseId=KB_ID,
            retrievalQuery={"text": user_message},
            retrievalConfiguration={
                "vectorSearchConfiguration": {"numberOfResults": 5}
            },
        )

        results = retrieve_resp.get("retrievalResults", [])
        chunks = [r["content"]["text"] for r in results if r.get("content", {}).get("text")]

        # Extract unique source document names from S3 URIs
        sources = []
        seen = set()
        for r in results:
            uri = r.get("location", {}).get("s3Location", {}).get("uri", "")
            if uri:
                name = uri.split("/")[-1]
                if name and name not in seen:
                    seen.add(name)
                    sources.append(name)

        context_block = "\n\n".join(chunks) if chunks else "No relevant materials found."
        logger.info(f"Retrieved {len(chunks)} KB chunks from: {sources}")

        # Build messages (STM from client + new user message)
        messages = list(conversation_history[-14:])  # last 14 turns (7 exchanges)
        messages.append({"role": "user", "content": user_message})

        # Call Claude with KB context injected into system prompt
        full_system = f"{SYSTEM_PROMPT}\n\n<teaching_materials>\n{context_block}\n</teaching_materials>"

        invoke_resp = bedrock_runtime.invoke_model(
            modelId=MODEL_ID,
            guardrailIdentifier=GUARDRAIL_ID,
            guardrailVersion=GUARDRAIL_VERSION,
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1024,
                "system": full_system,
                "messages": messages,
            }),
        )

        response_body = json.loads(invoke_resp["body"].read())
        reply = response_body["content"][0]["text"]

        # TEMPORARY: append raw KB chunks for validation — remove before go-live
        if chunks:
            chunk_lines = "\n\n".join(
                f"**[Source {i+1}: {sources[i] if i < len(sources) else 'unknown'}]**\n{c}"
                for i, c in enumerate(chunks)
            )
            reply += f"\n\n---\n_KB chunks retrieved (temp — for validation):_\n\n{chunk_lines}"

        logger.info(f"Response generated for request {request_id}")

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps({
                "response": reply,
                "sessionId": request_id,
                "timestamp": datetime.utcnow().isoformat(),
                "sources": sources,
            }),
        }

    except Exception as e:
        logger.error(f"Error processing request {request_id}: {e}", exc_info=True)
        return _error(500, "Internal server error", request_id)


def _error(status_code, message, request_id):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps({
            "error": message,
            "sessionId": request_id,
            "timestamp": datetime.utcnow().isoformat(),
        }),
    }
