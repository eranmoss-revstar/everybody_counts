"""
Admin Settings Lambda — GET /admin/settings, PUT /admin/settings
Reads and writes LLM behaviour parameters (temperature, max_tokens) in SSM.
Only accessible to members of the Cognito 'admins' group.
"""

import json
import boto3
import os
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.environ.get("REGION", "us-east-1")
SSM_TEMPERATURE_PARAM = os.environ.get("SSM_TEMPERATURE_PARAM", "/everybody-counts/llm/temperature")
SSM_MAX_TOKENS_PARAM = os.environ.get("SSM_MAX_TOKENS_PARAM", "/everybody-counts/llm/max_tokens")
SSM_FORMAT_PARAM = os.environ.get("SSM_FORMAT_PARAM", "/everybody-counts/llm/format")
SSM_OUTPUT_TYPE_PARAM = os.environ.get("SSM_OUTPUT_TYPE_PARAM", "/everybody-counts/llm/output_type")

VALID_FORMATS = {"structured", "prose", "step_by_step"}
VALID_OUTPUT_TYPES = {"explanation", "lesson_plan", "activity_ideas"}


def _is_admin(event: dict) -> bool:
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    groups_raw = claims.get("cognito:groups", "")
    groups = groups_raw if isinstance(groups_raw, list) else [g.strip() for g in groups_raw.split(",") if g.strip()]
    return "admins" in groups


def _response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    if not _is_admin(event):
        return _response(403, {"error": "Admin access required"})

    method = event.get("httpMethod", "GET")
    ssm = boto3.client("ssm", region_name=REGION)

    if method == "GET":
        try:
            result = ssm.get_parameters(Names=[
                SSM_TEMPERATURE_PARAM, SSM_MAX_TOKENS_PARAM,
                SSM_FORMAT_PARAM, SSM_OUTPUT_TYPE_PARAM,
            ])
            params = {p["Name"]: p["Value"] for p in result["Parameters"]}
            return _response(200, {
                "temperature": float(params.get(SSM_TEMPERATURE_PARAM, "0.7")),
                "maxTokens": int(params.get(SSM_MAX_TOKENS_PARAM, "2048")),
                "format": params.get(SSM_FORMAT_PARAM, "structured"),
                "outputType": params.get(SSM_OUTPUT_TYPE_PARAM, "explanation"),
            })
        except Exception as e:
            logger.error(f"GET settings error: {e}")
            return _response(500, {"error": "Failed to read settings"})

    if method == "PUT":
        try:
            body = json.loads(event.get("body") or "{}")
            temperature = float(body.get("temperature", 0.7))
            max_tokens = int(body.get("maxTokens", 2048))
            fmt = body.get("format", "structured")
            output_type = body.get("outputType", "explanation")

            if not (0.0 <= temperature <= 1.0):
                return _response(400, {"error": "temperature must be 0.0–1.0"})
            if not (1024 <= max_tokens <= 4096):
                return _response(400, {"error": "maxTokens must be 1024–4096"})
            if fmt not in VALID_FORMATS:
                return _response(400, {"error": f"format must be one of {sorted(VALID_FORMATS)}"})
            if output_type not in VALID_OUTPUT_TYPES:
                return _response(400, {"error": f"outputType must be one of {sorted(VALID_OUTPUT_TYPES)}"})

            ssm.put_parameter(Name=SSM_TEMPERATURE_PARAM, Value=str(temperature), Overwrite=True, Type="String")
            ssm.put_parameter(Name=SSM_MAX_TOKENS_PARAM, Value=str(max_tokens), Overwrite=True, Type="String")
            ssm.put_parameter(Name=SSM_FORMAT_PARAM, Value=fmt, Overwrite=True, Type="String")
            ssm.put_parameter(Name=SSM_OUTPUT_TYPE_PARAM, Value=output_type, Overwrite=True, Type="String")

            logger.info(f"Settings updated: temperature={temperature}, maxTokens={max_tokens}, format={fmt}, outputType={output_type}")
            return _response(200, {"temperature": temperature, "maxTokens": max_tokens, "format": fmt, "outputType": output_type})
        except Exception as e:
            logger.error(f"PUT settings error: {e}")
            return _response(500, {"error": "Failed to save settings"})

    return _response(405, {"error": f"Method {method} not allowed"})
