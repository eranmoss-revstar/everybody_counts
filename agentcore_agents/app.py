"""
Everybody Counts — AgentCore Agent
KS1 maths teaching assistant backed by a Bedrock Knowledge Base.
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

# ─── Environment ─────────────────────────────────────────────────────────────
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
MEMORY_ID = os.environ.get("MEMORY_ID", "")
GUARDRAIL_ID = os.environ.get("GUARDRAIL_ID", "")
GUARDRAIL_VERSION = os.environ.get("GUARDRAIL_VERSION", "")
KB_ID = os.environ.get("KB_ID", "")
MODEL_ID = os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")

SYSTEM_PROMPT = """You are a friendly, expert KS1 mathematics teaching assistant.
You help UK primary school teachers (Key Stage 1, ages 5–7, Year 1 and Year 2) with step-by-step, classroom-ready guidance on teaching maths concepts.
Your tone is pedagogical, clarifying, and playful — encouraging for both teachers and young learners.

Always use the retrieve_teaching_materials tool to search the knowledge base before answering any question about maths teaching.
When citing or attributing ideas, say they are drawn from the Everybody Counts knowledge base.
If the retrieved materials do not cover the question, politely say that this information is not currently available in the knowledge base.
If the question is not related to KS1 mathematics teaching (Year 1 or Year 2), politely explain that this assistant currently supports Year 1 and Year 2 maths teaching only.
Do not end your responses with follow-up questions or prompts asking if the teacher wants more information.

After your response, if you retrieved documents, append a final line in exactly this format (no extra text):
SOURCES: filename1.pdf, filename2.pdf"""

# ─── Lazy-initialised globals ─────────────────────────────────────────────────
_agent = None
_initialized = False


def _ensure_initialized():
    global _agent, _initialized
    if _initialized:
        return
    _initialized = True

    import boto3
    from strands import Agent
    from strands.models.bedrock import BedrockModel
    from strands.tools import tool

    @tool
    def retrieve_teaching_materials(query: str) -> str:
        """Retrieve relevant KS1 maths teaching materials from the Everybody Counts knowledge base."""
        logger.info(f"TOOL: retrieve_teaching_materials(query='{query[:80]}...')")

        if not KB_ID:
            return "Knowledge base not configured."

        try:
            client = boto3.client("bedrock-agent-runtime", region_name=AWS_REGION)
            response = client.retrieve(
                knowledgeBaseId=KB_ID,
                retrievalQuery={"text": query},
                retrievalConfiguration={
                    "vectorSearchConfiguration": {"numberOfResults": 5}
                },
            )
            results = response.get("retrievalResults", [])
        except Exception as e:
            logger.error(f"KB retrieve error: {e}")
            return "Could not retrieve teaching materials at this time."

        if not results:
            return "No relevant teaching materials found in the knowledge base."

        sources = []
        chunks = []
        seen = set()
        for r in results:
            text = r.get("content", {}).get("text", "")
            uri = r.get("location", {}).get("s3Location", {}).get("uri", "")
            if uri:
                name = uri.split("/")[-1]
                if name and name not in seen:
                    seen.add(name)
                    sources.append(name)
            if text:
                chunks.append(text)

        context = "\n\n---\n\n".join(chunks)
        sources_str = ", ".join(sources) if sources else "unknown"
        logger.info(f"TOOL: retrieved {len(chunks)} chunks from {sources}")
        return f"[Retrieved from: {sources_str}]\n\n{context}"

    model_kwargs: Dict[str, Any] = {"model_id": MODEL_ID}
    if GUARDRAIL_ID and GUARDRAIL_VERSION:
        model_kwargs["guardrail_id"] = GUARDRAIL_ID
        model_kwargs["guardrail_version"] = GUARDRAIL_VERSION
        logger.info(f"Guardrails enabled: {GUARDRAIL_ID} v{GUARDRAIL_VERSION}")

    model = BedrockModel(**model_kwargs)

    _agent = Agent(
        model=model,
        system_prompt=SYSTEM_PROMPT,
        tools=[retrieve_teaching_materials],
    )
    logger.info("Agent initialised")


# ─── Entrypoint ───────────────────────────────────────────────────────────────

app = BedrockAgentCoreApp()


@app.entrypoint
def invoke(payload: Dict[str, Any]) -> Dict[str, Any]:
    session_id = None
    try:
        _ensure_initialized()

        if not payload or not isinstance(payload, dict):
            raise ValueError("Invalid payload")

        user_message = payload.get("prompt", "")
        if not isinstance(user_message, str) or not user_message.strip():
            raise ValueError("Invalid prompt: must be a non-empty string")

        user_message = user_message.strip()[:2000]
        session_id = payload.get("sessionId") or f"session-{uuid4().hex[:12]}"
        actor_id = payload.get("actorId", "default")

        logger.info(f"Invoked — session={session_id}, len={len(user_message)}")

        if MEMORY_ID:
            try:
                from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
                from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager

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

        # Extract sources from SOURCES: line appended by the agent
        sources = []
        if "SOURCES:" in response_text:
            parts = response_text.rsplit("SOURCES:", 1)
            response_text = parts[0].strip()
            sources = [s.strip() for s in parts[1].strip().split(",") if s.strip()]

        return {
            "result": response_text,
            "sources": sources,
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
