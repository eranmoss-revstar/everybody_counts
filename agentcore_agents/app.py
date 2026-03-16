"""
AgentCore QuickStart — Full Boilerplate Agent
All components: Memory (STM+LTM), Code Interpreter, Browser, Guardrails, OTEL.
"""

import json
import os
import logging
from typing import Dict, Any
from datetime import datetime, timezone
from uuid import uuid4
from bedrock_agentcore import BedrockAgentCoreApp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# ─── Environment (set by CDK) ───────────────────────────────────────────────
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
MEMORY_ID = os.environ.get("MEMORY_ID", "")
CODE_INTERPRETER_ID = os.environ.get("CODE_INTERPRETER_ID", "")
BROWSER_ID = os.environ.get("BROWSER_ID", "")
GUARDRAIL_ID = os.environ.get("GUARDRAIL_ID", "")
GUARDRAIL_VERSION = os.environ.get("GUARDRAIL_VERSION", "")
GATEWAY_URL = os.environ.get("GATEWAY_URL", "")
MODEL_ID = os.environ.get("MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0")

# ─── Lazy-initialized globals ────────────────────────────────────────────────
_agent = None
_initialized = False


def _ensure_initialized():
    """Lazy init: build Agent with all tools on first call.
    Deferred to stay within AgentCore's 30-second init timeout.
    """
    global _agent, _initialized
    if _initialized:
        return
    _initialized = True

    import boto3
    from strands import Agent
    from strands.models.bedrock import BedrockModel
    from strands.tools import tool
    from strands_tools import tavily

    # Fetch Tavily API key from Secrets Manager (optional — agent works without it)
    tavily_available = False
    try:
        sm = boto3.client("secretsmanager", region_name=AWS_REGION)
        resp = sm.get_secret_value(SecretId="agentcore/tavily-api-key")
        secret = resp["SecretString"]
        try:
            api_key = json.loads(secret).get("api_key", secret)
        except json.JSONDecodeError:
            api_key = secret
        if api_key and api_key != "your-tavily-api-key-here":
            os.environ["TAVILY_API_KEY"] = api_key
            tavily_available = True
            logger.info("Tavily API key configured — web search enabled")
        else:
            logger.info("Tavily secret is placeholder — skipping web search tool")
    except Exception as e:
        logger.info(f"Tavily secret not available — skipping web search tool: {e}")

    # ─── Built-in Tools ──────────────────────────────────────────────
    @tool
    def calculator(expression: str) -> str:
        """Evaluate a basic math expression (e.g. '2 + 3 * 4')."""
        import re
        import ast
        import operator

        logger.info(f"TOOL INVOKED: calculator(expression='{expression}')")

        if not re.match(r"^[0-9+\-*/().\s]+$", expression):
            return "Error: Only numbers and basic operators (+, -, *, /, parentheses) are allowed."

        ops = {
            ast.Add: operator.add, ast.Sub: operator.sub,
            ast.Mult: operator.mul, ast.Div: operator.truediv,
            ast.USub: operator.neg, ast.UAdd: operator.pos,
        }

        def safe_eval(node):
            if isinstance(node, ast.Expression):
                return safe_eval(node.body)
            if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
                return node.value
            if isinstance(node, ast.BinOp) and type(node.op) in ops:
                return ops[type(node.op)](safe_eval(node.left), safe_eval(node.right))
            if isinstance(node, ast.UnaryOp) and type(node.op) in ops:
                return ops[type(node.op)](safe_eval(node.operand))
            raise ValueError(f"Unsupported: {type(node).__name__}")

        try:
            tree = ast.parse(expression, mode="eval")
            result = safe_eval(tree)
            logger.info(f"TOOL RESULT: calculator -> {result}")
            return f"Result: {result}"
        except Exception as exc:
            logger.error(f"TOOL ERROR: calculator -> {exc}")
            return f"Error: {exc}"

    @tool
    def get_current_time() -> str:
        """Get the current date and time in UTC."""
        logger.info("TOOL INVOKED: get_current_time()")
        result = f"Current time: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}"
        logger.info(f"TOOL RESULT: get_current_time -> {result}")
        return result

    tools = [calculator, get_current_time]
    if tavily_available:
        tools.insert(0, tavily.tavily_search)
        logger.info("Tavily web search tool added")
    else:
        logger.info("Agent initialized without web search tool")

    # ─── Code Interpreter (Strands wrapper) ──────────────────────────
    if CODE_INTERPRETER_ID:
        try:
            from strands_tools.code_interpreter import AgentCoreCodeInterpreter
            ci_tool = AgentCoreCodeInterpreter(region=AWS_REGION)
            tools.append(ci_tool.code_interpreter)
            logger.info(f"Code Interpreter tool loaded: {CODE_INTERPRETER_ID}")
        except Exception as e:
            logger.warning(f"Code Interpreter not available: {e}")

    # ─── Browser (Strands wrapper) ───────────────────────────────────
    if BROWSER_ID:
        try:
            from strands_tools.browser import AgentCoreBrowser
            browser_tool = AgentCoreBrowser(region=AWS_REGION)
            tools.append(browser_tool.browser)
            logger.info(f"Browser tool loaded: {BROWSER_ID}")
        except Exception as e:
            logger.warning(f"Browser not available: {e}")

    # ─── Model with Guardrails ───────────────────────────────────────
    model_kwargs = {"model_id": MODEL_ID}
    if GUARDRAIL_ID and GUARDRAIL_VERSION:
        model_kwargs["guardrail_id"] = GUARDRAIL_ID
        model_kwargs["guardrail_version"] = GUARDRAIL_VERSION
        logger.info(f"Guardrails enabled: {GUARDRAIL_ID} v{GUARDRAIL_VERSION}")

    model = BedrockModel(**model_kwargs)

    # ─── Agent ───────────────────────────────────────────────────────
    _agent = Agent(
        model=model,
        system_prompt=(
            "You are an intelligent AI assistant with access to multiple tools.\n\n"
            "Capabilities:\n"
            "- Web search: Find current information online\n"
            "- Calculator: Evaluate math expressions\n"
            "- Time: Get current date/time\n"
            "- Code execution: Run Python/JS/TS code in a sandbox (if available)\n"
            "- Web browsing: Navigate websites and extract information (if available)\n\n"
            "Use tools when needed. Be helpful, accurate, and professional."
        ),
        tools=tools,
    )
    logger.info(f"Agent initialized with {len(tools)} tools")


# ─── Entrypoint ──────────────────────────────────────────────────────────────

app = BedrockAgentCoreApp()


@app.entrypoint
def invoke(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Main agent entrypoint with Memory (STM+LTM) integration."""
    session_id = None
    try:
        _ensure_initialized()

        if not payload or not isinstance(payload, dict):
            raise ValueError("Invalid payload: must be a non-empty dictionary")

        user_message = payload.get("prompt", "")
        if not isinstance(user_message, str) or not user_message.strip():
            raise ValueError("Invalid prompt: must be a non-empty string")

        user_message = user_message.strip()[:2000]
        session_id = payload.get("sessionId") or f"session-{uuid4().hex[:12]}"
        actor_id = payload.get("actorId", "default")

        logger.info(f"Invoked — session={session_id}, actor={actor_id}, len={len(user_message)}")

        # ─── Memory-integrated invocation ────────────────────────────
        if MEMORY_ID:
            try:
                from bedrock_agentcore.memory.integrations.strands.config import (
                    AgentCoreMemoryConfig,
                )
                from bedrock_agentcore.memory.integrations.strands.session_manager import (
                    AgentCoreMemorySessionManager,
                )

                config = AgentCoreMemoryConfig(
                    memory_id=MEMORY_ID,
                    session_id=session_id,
                    actor_id=actor_id,
                )
                with AgentCoreMemorySessionManager(config, region_name=AWS_REGION) as session_manager:
                    _agent.session_manager = session_manager
                    result = _agent(user_message)
                    _agent.session_manager = None
            except Exception as e:
                logger.warning(f"Memory session failed, invoking without memory: {e}")
                result = _agent(user_message)
        else:
            result = _agent(user_message)

        response_text = result.message if hasattr(result, "message") and result.message else str(result)

        return {
            "result": response_text,
            "session_id": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "success",
        }

    except ValueError as ve:
        logger.error(f"Validation error: {ve}")
        return {"error": str(ve), "session_id": session_id or "unknown", "status": "error"}
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        return {"error": "An unexpected error occurred.", "session_id": session_id or "unknown", "status": "error"}


if __name__ == "__main__":
    app.run()
