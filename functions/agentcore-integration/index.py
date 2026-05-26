"""
AgentCore Integration Lambda — POST /chat
Thin bridge: API Gateway → AgentCore Runtime (Everybody Counts agent).
Accepts { userMessage, conversationHistory, sessionId } from the frontend.
Supports both API Gateway proxy events and Lambda Function URL events.
"""

import json
import boto3
import os
import logging
from datetime import datetime

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AGENTCORE_RUNTIME_ARN = os.environ.get("AGENTCORE_RUNTIME_ARN", "")
REGION = os.environ.get("REGION", "us-east-1")
USER_POOL_ID = os.environ.get("USER_POOL_ID", "")
COGNITO_CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID", "")

# Detect Lambda Function URL invocation (requestContext has http key, not resourcePath)
def _is_function_url(event: dict) -> bool:
    return "requestContext" in event and "http" in event.get("requestContext", {})


def _verify_token(event: dict) -> bool:
    """Verify Cognito JWT when invoked via Function URL (no API Gateway authorizer)."""
    if not _is_function_url(event):
        return True  # API Gateway Cognito authorizer already validated

    headers = event.get("headers") or {}
    auth_header = headers.get("authorization") or headers.get("Authorization") or ""
    if not auth_header.startswith("Bearer "):
        return False

    token = auth_header[7:]
    if not USER_POOL_ID:
        return True  # No pool configured — skip verification

    try:
        import jwt
        from jwt import PyJWKClient

        jwks_url = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"
        jwks_client = PyJWKClient(jwks_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_aud": False},  # ID tokens use client_id as aud
        )
        return True
    except Exception as e:
        logger.warning(f"Token verification failed: {e}")
        return False


def lambda_handler(event, context):
    request_id = context.aws_request_id
    logger.info(f"Processing request {request_id}")

    # Auth check for Function URL invocations
    if not _verify_token(event):
        return _error(401, "Unauthorized", request_id)

    try:
        body = json.loads(event.get("body") or "{}")
        user_message = body.get("userMessage", "").strip()[:2000]
        conversation_history = body.get("conversationHistory", [])
        raw_session = body.get("sessionId") or request_id
        # runtimeSessionId min length is 33 — pad short IDs with a fixed prefix
        session_id = raw_session if len(raw_session) >= 33 else f"ec-session-{raw_session}-{'x' * (22 - len(raw_session))}"

        if not user_message:
            return _error(400, "userMessage is required", request_id)

        if not AGENTCORE_RUNTIME_ARN or not AGENTCORE_RUNTIME_ARN.startswith("arn:aws:bedrock-agentcore:"):
            return _error(500, "AgentCore Runtime not configured", request_id)

        # Prepend recent conversation history to the prompt so the agent has context
        prompt = _build_prompt(user_message, conversation_history)

        payload = json.dumps({
            "prompt": prompt,
            "sessionId": session_id,
        }).encode("utf-8")

        logger.info(f"Invoking AgentCore Runtime: {AGENTCORE_RUNTIME_ARN}, session={session_id}")

        client = boto3.client("bedrock-agentcore", region_name=REGION)
        response = client.invoke_agent_runtime(
            agentRuntimeArn=AGENTCORE_RUNTIME_ARN,
            runtimeSessionId=session_id,
            payload=payload,
            qualifier="DEFAULT",
        )

        # Collect streaming response chunks
        raw = b""
        if "response" in response and response["response"]:
            for chunk in response["response"]:
                if isinstance(chunk, bytes):
                    raw += chunk
                else:
                    raw += str(chunk).encode("utf-8")

        if not raw:
            return _error(500, "Empty response from AgentCore Runtime", request_id)

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"result": raw.decode("utf-8", errors="replace")}

        if parsed.get("status") == "error":
            return _error(500, parsed.get("error", "Agent error"), request_id)

        reply = parsed.get("result", "")
        sources = parsed.get("sources", [])

        logger.info(f"Response generated for request {request_id}, sources={sources}")

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps({
                "response": reply,
                "sessionId": session_id,
                "timestamp": datetime.utcnow().isoformat(),
                "sources": sources,
            }),
        }

    except Exception as e:
        logger.error(f"Error processing request {request_id}: {e}", exc_info=True)
        return _error(500, "Internal server error", request_id)


def _build_prompt(user_message: str, history: list) -> str:
    """Prepend the last 7 exchanges of conversation history to the user message."""
    recent = history[-14:]  # last 14 turns = 7 exchanges
    if not recent:
        return user_message

    lines = ["[Conversation History]"]
    for turn in recent:
        role = turn.get("role", "user").capitalize()
        content = turn.get("content", "")
        lines.append(f"{role}: {content}")
    lines.append("")
    lines.append(f"[Current Message]\n{user_message}")
    return "\n".join(lines)


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
