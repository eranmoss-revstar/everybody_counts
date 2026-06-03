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
Your tone is warm, practical, and direct — a knowledgeable colleague helping a teacher prepare for tomorrow's lesson.

Always use the retrieve_teaching_materials tool to search the knowledge base before answering any question about maths teaching.

## Formatting rules — follow these exactly:

1. **Use bullet lists for list-shaped content.** If you are describing a set of items (manipulatives, steps, activities, strategies), write each item as a bullet point — never as a prose paragraph. A heading that promises a list must deliver a list.

2. **Include at least one worked example for procedural or conceptual topics.** Show the maths, not just the method. For example, when explaining fact families, write out the actual equations: 3 + 2 = 5, 2 + 3 = 5, 5 − 2 = 3, 5 − 3 = 2. When explaining place value, show a specific number broken down. One concrete example is worth three sentences of explanation.

3. **Humanise source citations.** Do not refer to filenames. Instead write naturally, e.g. "According to the Year 1 Unit 7 teacher notes..." or "The Year 2 Unit 4 materials suggest...".

4. **Flag gaps honestly.** If the knowledge base does not cover something a teacher might reasonably expect (e.g. a specific manipulative, a particular lesson structure), add a brief italicised note: *Note: [topic] is not covered in the current knowledge base.*

5. **No trailing questions.** Do not end responses by asking if the teacher wants more information.

6. **Distinguish activities from teaching strategies.** An *activity* is hands-on, pupil-facing, and fun — something children do that feels like a game or challenge (e.g. a spinner game, hoops on the floor, sorting objects into groups). A *teaching strategy* is a method the teacher applies consistently across lessons (e.g. always using a part-whole model, always asking "What do you notice?"). When asked for *activities*, return only genuine activities. If you include a teaching strategy, label it clearly with *Teaching strategy:* so the teacher knows what they are getting.

7. **Search for related topic variants.** If a question names a specific number set (e.g. number bonds to 10), also draw on materials for closely related number sets (e.g. number bonds to 5, 6, 7, 8, 9). The activities across these lessons are interchangeable with minor numerical adjustments. Use the retrieve_teaching_materials tool more than once if needed — first for the specific topic, then for related variants. When an activity comes from a related lesson, note it briefly: *(also works for number bonds to 5)*.

8. **Generate variations — do not copy.** Use retrieved materials as inspiration, not as text to reproduce. Describe activities in your own words. Where possible, suggest a practical variation or extension that goes slightly beyond what is written in the teacher notes — this is what makes the response more useful than simply reading the notes directly.

9. **Flag visual-dependent activities.** If an activity relies on a diagram, picture, or visual layout that cannot be fully conveyed in words, add a brief note: *Note: this activity uses a visual — see the original teacher notes linked below.* The original document is automatically linked beneath your response, so the teacher can open it to view the diagram.

10. **Keep it focused.** Return no more than 5 activities unless the teacher asks for more. Keep each activity description to a few short bullet points — enough to run it, not a full transcript of the notes.

If the question is not related to KS1 mathematics teaching (Year 1 or Year 2), politely explain that this assistant currently supports Year 1 and Year 2 maths only. Do not suggest alternative resources, tools, websites, or other services — simply state the scope limitation and invite the teacher to ask a maths question instead.

After your response, if you retrieved documents, append a final line in exactly this format (no extra text):
SOURCES: filename1.pdf, filename2.pdf"""

# ─── Format / output-type prompt additions ────────────────────────────────────
_FORMAT_INSTRUCTIONS = {
    "structured": "Structure your response with clear ## headings and bullet points for list-shaped content.",
    "prose": "Write in flowing prose paragraphs. Avoid bullet points and headings unless absolutely necessary.",
    "step_by_step": "Present your response as numbered steps. Each step must be a clear, actionable instruction.",
}

_OUTPUT_TYPE_INSTRUCTIONS = {
    "explanation": "Answer the teacher's question with a clear explanation grounded in the teaching materials.",
    "lesson_plan": (
        "Format your response as a classroom lesson plan with these sections: "
        "**Learning Objective**, **Resources Needed**, **Warm-Up (5 min)**, "
        "**Main Activity**, and **Plenary**."
    ),
    "activity_ideas": (
        "Provide a set of practical classroom activity ideas. "
        "For each activity include: the activity name, what concept it teaches, and how to run it."
    ),
}

# ─── Lazy-initialised globals ─────────────────────────────────────────────────
_agent = None
_agent_temperature: float = -1.0
_agent_max_tokens: int = -1
_agent_format: str = ""
_agent_output_type: str = ""
_retrieve_tool = None

# Maps source filename → full S3 URI for the current invocation (reset each invoke).
# Used to build clickable links to the original teaching documents.
_retrieval_source_map: Dict[str, str] = {}


def _ensure_tool():
    global _retrieve_tool
    if _retrieve_tool is not None:
        return
    import boto3
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
                    "vectorSearchConfiguration": {"numberOfResults": 12}
                },
            )
            results = response.get("retrievalResults", [])
        except Exception as e:
            logger.error(f"KB retrieve error: {e}")
            return "Could not retrieve teaching materials at this time."

        if not results:
            return "No relevant teaching materials found in the knowledge base."

        global _retrieval_source_map
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
                    _retrieval_source_map[name] = uri
            if text:
                chunks.append(text)

        context = "\n\n---\n\n".join(chunks)
        sources_str = ", ".join(sources) if sources else "unknown"
        logger.info(f"TOOL: retrieved {len(chunks)} chunks from {sources}")
        return f"[Retrieved from: {sources_str}]\n\n{context}"

    _retrieve_tool = retrieve_teaching_materials


def _get_agent(temperature: float, max_tokens: int, fmt: str = "structured", output_type: str = "explanation"):
    global _agent, _agent_temperature, _agent_max_tokens, _agent_format, _agent_output_type
    _ensure_tool()
    if (
        _agent is not None
        and _agent_temperature == temperature
        and _agent_max_tokens == max_tokens
        and _agent_format == fmt
        and _agent_output_type == output_type
    ):
        return _agent

    from strands import Agent
    from strands.models.bedrock import BedrockModel

    model_kwargs: Dict[str, Any] = {
        "model_id": MODEL_ID,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if GUARDRAIL_ID and GUARDRAIL_VERSION:
        model_kwargs["guardrail_id"] = GUARDRAIL_ID
        model_kwargs["guardrail_version"] = GUARDRAIL_VERSION
        logger.info(f"Guardrails enabled: {GUARDRAIL_ID} v{GUARDRAIL_VERSION}")

    format_instruction = _FORMAT_INSTRUCTIONS.get(fmt, _FORMAT_INSTRUCTIONS["structured"])
    output_instruction = _OUTPUT_TYPE_INSTRUCTIONS.get(output_type, _OUTPUT_TYPE_INSTRUCTIONS["explanation"])
    system_prompt = f"{SYSTEM_PROMPT}\n\n## Response style\n{format_instruction}\n\n## Output type\n{output_instruction}"

    model = BedrockModel(**model_kwargs)
    _agent = Agent(
        model=model,
        system_prompt=system_prompt,
        tools=[_retrieve_tool],
    )
    _agent_temperature = temperature
    _agent_max_tokens = max_tokens
    _agent_format = fmt
    _agent_output_type = output_type
    logger.info(f"Agent initialised: temperature={temperature}, max_tokens={max_tokens}, format={fmt}, output_type={output_type}")
    return _agent


# ─── Entrypoint ───────────────────────────────────────────────────────────────

app = BedrockAgentCoreApp()


@app.entrypoint
def invoke(payload: Dict[str, Any]) -> Dict[str, Any]:
    session_id = None
    try:
        if not payload or not isinstance(payload, dict):
            raise ValueError("Invalid payload")

        user_message = payload.get("prompt", "")
        if not isinstance(user_message, str) or not user_message.strip():
            raise ValueError("Invalid prompt: must be a non-empty string")

        user_message = user_message.strip()[:2000]
        session_id = payload.get("sessionId") or f"session-{uuid4().hex[:12]}"
        actor_id = payload.get("actorId", "default")
        temperature = float(payload.get("temperature", 0.7))
        max_tokens = int(payload.get("max_tokens", 2048))
        fmt = payload.get("format", "structured")
        output_type = payload.get("output_type", "explanation")

        logger.info(f"Invoked — session={session_id}, temperature={temperature}, max_tokens={max_tokens}, format={fmt}, output_type={output_type}")

        global _retrieval_source_map
        _retrieval_source_map = {}

        agent = _get_agent(temperature, max_tokens, fmt, output_type)

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
                    agent.session_manager = session_manager
                    result = agent(user_message)
                    agent.session_manager = None
            except Exception as e:
                logger.warning(f"Memory session failed, invoking without memory: {e}")
                result = agent(user_message)
        else:
            result = agent(user_message)

        response_text = result.message if hasattr(result, "message") and result.message else str(result)

        # Extract sources from SOURCES: line appended by the agent
        sources = []
        if "SOURCES:" in response_text:
            parts = response_text.rsplit("SOURCES:", 1)
            response_text = parts[0].strip()
            sources = [s.strip() for s in parts[1].strip().split(",") if s.strip()]

        # Build source_uris (filename → full S3 URI) for clickable document links.
        # Prefer the cited sources; fall back to all retrieved docs if none cited.
        source_uris = []
        for name in sources:
            uri = _retrieval_source_map.get(name)
            if uri:
                source_uris.append({"name": name, "uri": uri})
        if not source_uris and _retrieval_source_map:
            source_uris = [{"name": n, "uri": u} for n, u in _retrieval_source_map.items()]

        return {
            "result": response_text,
            "sources": sources,
            "source_uris": source_uris,
            "session_id": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "success",
        }

    except ValueError as ve:
        logger.error(f"Validation error: {ve}")
        return {"error": str(ve), "session_id": session_id or "unknown", "status": "error"}
    except Exception as e:
        if "MaxTokensReachedException" in type(e).__name__ or "max_tokens" in str(e).lower():
            logger.error(f"Max tokens exceeded: {e}")
            return {
                "error": "The response was too long to complete. Please try asking a shorter or more specific question.",
                "session_id": session_id or "unknown",
                "status": "error",
            }
        logger.error(f"Unexpected error: {e}", exc_info=True)
        return {"error": "An unexpected error occurred.", "session_id": session_id or "unknown", "status": "error"}


if __name__ == "__main__":
    app.run()
