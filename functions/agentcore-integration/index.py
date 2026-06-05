"""
AgentCore Integration Lambda — POST /chat
Thin bridge: API Gateway / Lambda Function URL → AgentCore Runtime.
Streams SSE events: progress updates, then the final response.
"""

import json
import boto3
import os
import logging
import time
from datetime import datetime

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AGENTCORE_RUNTIME_ARN = os.environ.get("AGENTCORE_RUNTIME_ARN", "")
REGION = os.environ.get("REGION", "us-east-1")
USER_POOL_ID = os.environ.get("USER_POOL_ID", "")
COGNITO_CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID", "")
SSM_TEMPERATURE_PARAM = os.environ.get("SSM_TEMPERATURE_PARAM", "/everybody-counts/llm/temperature")
SSM_MAX_TOKENS_PARAM = os.environ.get("SSM_MAX_TOKENS_PARAM", "/everybody-counts/llm/max_tokens")
SSM_FORMAT_PARAM = os.environ.get("SSM_FORMAT_PARAM", "/everybody-counts/llm/format")
SSM_OUTPUT_TYPE_PARAM = os.environ.get("SSM_OUTPUT_TYPE_PARAM", "/everybody-counts/llm/output_type")

_settings_cache: dict = {}
_settings_cache_time: float = 0.0
_SETTINGS_TTL = 300


def _get_llm_settings() -> dict:
    global _settings_cache, _settings_cache_time
    if _settings_cache and (time.time() - _settings_cache_time) < _SETTINGS_TTL:
        return _settings_cache
    try:
        ssm = boto3.client("ssm", region_name=REGION)
        result = ssm.get_parameters(Names=[
            SSM_TEMPERATURE_PARAM, SSM_MAX_TOKENS_PARAM,
            SSM_FORMAT_PARAM, SSM_OUTPUT_TYPE_PARAM,
        ])
        params = {p["Name"]: p["Value"] for p in result["Parameters"]}
        _settings_cache = {
            "temperature": float(params.get(SSM_TEMPERATURE_PARAM, "0.7")),
            "max_tokens": int(params.get(SSM_MAX_TOKENS_PARAM, "2048")),
            "format": params.get(SSM_FORMAT_PARAM, "structured"),
            "output_type": params.get(SSM_OUTPUT_TYPE_PARAM, "explanation"),
        }
    except Exception as e:
        logger.warning(f"SSM settings fetch failed, using defaults: {e}")
        _settings_cache = {"temperature": 0.7, "max_tokens": 2048, "format": "structured", "output_type": "explanation"}
    _settings_cache_time = time.time()
    return _settings_cache


def _is_function_url(event: dict) -> bool:
    return "requestContext" in event and "http" in event.get("requestContext", {})


def _verify_token(event: dict) -> bool:
    if not _is_function_url(event):
        return True
    headers = event.get("headers") or {}
    auth_header = headers.get("authorization") or headers.get("Authorization") or ""
    if not auth_header.startswith("Bearer "):
        return False
    token = auth_header[7:]
    if not token:
        return False
    try:
        import base64, json as _json, time as _time
        parts = token.split(".")
        if len(parts) != 3:
            return False
        padding = 4 - len(parts[1]) % 4
        payload = _json.loads(base64.urlsafe_b64decode(parts[1] + "=" * padding))
        if payload.get("exp", 0) < _time.time():
            logger.warning("Token expired")
            return False
        return True
    except Exception as e:
        logger.warning(f"Token check failed: {e}")
        return False


def _build_prompt(user_message: str, history: list) -> str:
    # Keep only the last few turns, and TRIM long assistant answers. Full lesson
    # plans (600+ words) pasted verbatim make the model anchor to and "continue"
    # the previous answer instead of answering the new question. History is for
    # light continuity ("tell me more", "what about Year 2"), not re-feeding whole
    # responses, so assistant turns are capped to a short snippet.
    recent = history[-6:]
    if not recent:
        return user_message

    lines = [
        "You are in an ongoing chat. The earlier turns below are background only.",
        "Answer ONLY the new question in [Current Question]. If it changes topic,"
        " switch fully and do not continue the previous answer.",
        "",
        "[Earlier turns]",
    ]
    for turn in recent:
        role = turn.get("role", "user").capitalize()
        content = (turn.get("content", "") or "").strip()
        if role == "Assistant" and len(content) > 300:
            content = content[:300].rstrip() + " …[earlier answer trimmed]"
        else:
            content = content[:600]
        lines.append(f"{role}: {content}")
    lines.append("")
    lines.append(f"[Current Question]\n{user_message}")
    return "\n".join(lines)


def _parse_agentcore_response(raw: bytes):
    """Parse raw AgentCore response bytes → (reply_text, sources, source_uris)."""
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = {"result": raw.decode("utf-8", errors="replace")}

    if isinstance(parsed, dict) and parsed.get("status") == "error":
        raise RuntimeError(parsed.get("error", "Agent error"))

    reply = ""
    sources = []
    source_uris = []
    if isinstance(parsed, dict):
        result = parsed.get("result")
        if isinstance(result, dict):
            content_blocks = result.get("content", [])
            if isinstance(content_blocks, list):
                reply = "\n".join(
                    b["text"] for b in content_blocks
                    if isinstance(b, dict) and "text" in b
                )
            else:
                reply = str(content_blocks)
        elif isinstance(result, str):
            reply = result
        else:
            reply = parsed.get("response") or parsed.get("output") or parsed.get("text") or ""
        sources = parsed.get("sources", [])
        source_uris = parsed.get("source_uris", [])
    elif isinstance(parsed, str):
        reply = parsed

    if not isinstance(reply, str):
        reply = json.dumps(reply)

    return reply, sources, source_uris


def _build_source_links(source_uris: list) -> list:
    """Generate presigned S3 URLs for source documents so teachers can open the originals."""
    if not source_uris:
        return []
    links = []
    try:
        s3 = boto3.client("s3", region_name=REGION)
    except Exception as e:
        logger.warning(f"S3 client init failed: {e}")
        return []
    for item in source_uris:
        uri = (item or {}).get("uri", "")
        name = (item or {}).get("name", "")
        if not uri.startswith("s3://"):
            continue
        bucket, _, key = uri[5:].partition("/")
        if not bucket or not key:
            continue
        try:
            url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=3600,
            )
            links.append({"name": name or key.split("/")[-1], "url": url})
        except Exception as e:
            logger.warning(f"Presign failed for {key}: {e}")
    return links


# ─── Streaming handler ─────────────────────────────────────────────────────────

try:
    from awslambdaric import streaming_response as _streaming_response_decorator

    @_streaming_response_decorator
    def lambda_handler(event, response_stream, context):
        request_id = context.aws_request_id
        logger.info(f"Streaming request {request_id}")

        def sse(data: dict):
            response_stream.write(f"data: {json.dumps(data)}\n\n".encode("utf-8"))

        if not _verify_token(event):
            sse({"error": "Unauthorized", "status": 401})
            return

        add_cors = not _is_function_url(event)

        try:
            body = json.loads(event.get("body") or "{}")
            user_message = body.get("userMessage", "").strip()[:2000]
            conversation_history = body.get("conversationHistory", [])
            raw_session = body.get("sessionId") or request_id
            session_id = raw_session if len(raw_session) >= 33 else f"ec-session-{raw_session}-{'x' * (22 - len(raw_session))}"

            if not user_message:
                sse({"error": "userMessage is required", "status": 400})
                return

            if not AGENTCORE_RUNTIME_ARN or not AGENTCORE_RUNTIME_ARN.startswith("arn:aws:bedrock-agentcore:"):
                sse({"error": "AgentCore Runtime not configured", "status": 500})
                return

            # ── Progress event 1 — sent immediately ───────────────────────────
            sse({"progress": "Searching teaching materials..."})

            prompt = _build_prompt(user_message, conversation_history)
            settings = _get_llm_settings()
            payload = json.dumps({
                "prompt": prompt,
                "sessionId": session_id,
                "temperature": settings["temperature"],
                "max_tokens": settings["max_tokens"],
                "format": settings["format"],
                "output_type": settings["output_type"],
            }).encode("utf-8")

            logger.info(f"Invoking AgentCore: {AGENTCORE_RUNTIME_ARN}, session={session_id}")

            client = boto3.client("bedrock-agentcore", region_name=REGION)
            response = client.invoke_agent_runtime(
                agentRuntimeArn=AGENTCORE_RUNTIME_ARN,
                runtimeSessionId=session_id,
                payload=payload,
                qualifier="DEFAULT",
            )

            # ── Progress event 2 — AgentCore has responded, generating text ──
            sse({"progress": "Generating response..."})

            raw = b""
            if "response" in response and response["response"]:
                for chunk in response["response"]:
                    if isinstance(chunk, bytes):
                        raw += chunk
                    else:
                        raw += str(chunk).encode("utf-8")

            if not raw:
                sse({"error": "Empty response from AgentCore", "status": 500})
                return

            reply, sources, source_uris = _parse_agentcore_response(raw)
            source_links = _build_source_links(source_uris)

            logger.info(f"Response ready for {request_id}, sources={sources}, links={len(source_links)}")

            # ── Final event with full response ────────────────────────────────
            sse({
                "done": True,
                "response": reply,
                "sources": sources,
                "sourceLinks": source_links,
                "sessionId": session_id,
                "timestamp": datetime.utcnow().isoformat(),
            })

        except RuntimeError as re:
            logger.error(f"Agent error: {re}")
            sse({"error": str(re), "status": 500})
        except Exception as e:
            logger.error(f"Unexpected error: {e}", exc_info=True)
            sse({"error": "An unexpected error occurred.", "status": 500})

except ImportError:
    # ─── Fallback: non-streaming handler (used if awslambdaric not available) ─
    logger.warning("awslambdaric streaming not available — using buffered handler")

    def lambda_handler(event, context):
        request_id = context.aws_request_id
        logger.info(f"Processing request {request_id}")
        add_cors = not _is_function_url(event)

        if not _verify_token(event):
            return _error(401, "Unauthorized", request_id, add_cors)

        try:
            body = json.loads(event.get("body") or "{}")
            user_message = body.get("userMessage", "").strip()[:2000]
            conversation_history = body.get("conversationHistory", [])
            raw_session = body.get("sessionId") or request_id
            session_id = raw_session if len(raw_session) >= 33 else f"ec-session-{raw_session}-{'x' * (22 - len(raw_session))}"

            if not user_message:
                return _error(400, "userMessage is required", request_id, add_cors)

            if not AGENTCORE_RUNTIME_ARN or not AGENTCORE_RUNTIME_ARN.startswith("arn:aws:bedrock-agentcore:"):
                return _error(500, "AgentCore Runtime not configured", request_id, add_cors)

            prompt = _build_prompt(user_message, conversation_history)
            settings = _get_llm_settings()
            payload = json.dumps({
                "prompt": prompt,
                "sessionId": session_id,
                "temperature": settings["temperature"],
                "max_tokens": settings["max_tokens"],
                "format": settings["format"],
                "output_type": settings["output_type"],
            }).encode("utf-8")

            logger.info(f"Invoking AgentCore: {AGENTCORE_RUNTIME_ARN}, session={session_id}")

            client = boto3.client("bedrock-agentcore", region_name=REGION)
            response = client.invoke_agent_runtime(
                agentRuntimeArn=AGENTCORE_RUNTIME_ARN,
                runtimeSessionId=session_id,
                payload=payload,
                qualifier="DEFAULT",
            )

            raw = b""
            if "response" in response and response["response"]:
                for chunk in response["response"]:
                    if isinstance(chunk, bytes):
                        raw += chunk
                    else:
                        raw += str(chunk).encode("utf-8")

            if not raw:
                return _error(500, "Empty response from AgentCore Runtime", request_id, add_cors)

            reply, sources, source_uris = _parse_agentcore_response(raw)
            source_links = _build_source_links(source_uris)

            logger.info(f"Response ready for {request_id}, sources={sources}, links={len(source_links)}")

            # Function URL in RESPONSE_STREAM mode sends the return value as-is
            # (no API GW proxy unwrapping), so return raw data for Function URL calls.
            if _is_function_url(event):
                return {
                    "response": reply,
                    "sessionId": session_id,
                    "timestamp": datetime.utcnow().isoformat(),
                    "sources": sources,
                    "sourceLinks": source_links,
                }

            headers = {"Content-Type": "application/json"}
            if add_cors:
                headers["Access-Control-Allow-Origin"] = "*"

            return {
                "statusCode": 200,
                "headers": headers,
                "body": json.dumps({
                    "response": reply,
                    "sessionId": session_id,
                    "timestamp": datetime.utcnow().isoformat(),
                    "sources": sources,
                    "sourceLinks": source_links,
                }),
            }

        except Exception as e:
            logger.error(f"Error: {e}", exc_info=True)
            if _is_function_url(event):
                return {"error": "Internal server error", "sessionId": request_id}
            return _error(500, "Internal server error", request_id, add_cors)


def _error(status_code, message, request_id, add_cors=True):
    headers = {"Content-Type": "application/json"}
    if add_cors:
        headers["Access-Control-Allow-Origin"] = "*"
    return {
        "statusCode": status_code,
        "headers": headers,
        "body": json.dumps({
            "error": message,
            "sessionId": request_id,
            "timestamp": datetime.utcnow().isoformat(),
        }),
    }
