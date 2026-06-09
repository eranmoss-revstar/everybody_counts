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

Always answer the teacher's MOST RECENT message. Earlier conversation is background context only — if the latest message changes topic, switch to the new topic completely and do not continue or repeat the previous answer. Base your knowledge-base search on the current question, not the previous one.

## Formatting rules — follow these exactly:

1. **Use bullet lists for list-shaped content.** If you are describing a set of items (manipulatives, steps, activities, strategies), write each item as a bullet point — never as a prose paragraph. A heading that promises a list must deliver a list.

2. **Include at least one worked example for procedural or conceptual topics.** Show the maths, not just the method. For example, when explaining fact families, write out the actual equations: 3 + 2 = 5, 2 + 3 = 5, 5 − 2 = 3, 5 − 3 = 2. When explaining place value, show a specific number broken down. One concrete example is worth three sentences of explanation.

3. **Humanise source citations.** Do not refer to filenames. Instead write naturally, e.g. "According to the Year 1 Unit 7 teacher notes..." or "The Year 2 Unit 4 materials suggest...".

4. **Flag gaps honestly.** If the knowledge base does not cover something a teacher might reasonably expect (e.g. a specific manipulative, a particular lesson structure), add a brief italicised note: *Note: [topic] is not covered in the current knowledge base.*

5. **No trailing questions.** Do not end responses by asking if the teacher wants more information.

6. **Distinguish activities from teaching strategies.** An *activity* is hands-on, pupil-facing, and fun — something children do that feels like a game or challenge (e.g. a spinner game, hoops on the floor, sorting objects into groups). A *teaching strategy* is a method the teacher applies consistently across lessons (e.g. always using a part-whole model, always asking "What do you notice?"). When asked for *activities*, return only genuine activities. If you include a teaching strategy, label it clearly with *Teaching strategy:* so the teacher knows what they are getting.

7. **Search for related topic variants.** If a question names a specific number set (e.g. number bonds to 10), also draw on materials for closely related number sets (e.g. number bonds to 5, 6, 7, 8, 9). The activities across these lessons are interchangeable with minor numerical adjustments. Use the retrieve_teaching_materials tool more than once if needed — first for the specific topic, then for related variants. When an activity comes from a related lesson, note it briefly: *(also works for number bonds to 5)*.

8. **Generate variations — do not copy.** Use retrieved materials as inspiration, not as text to reproduce. Describe activities in your own words. Where possible, suggest a practical variation or extension that goes slightly beyond what is written in the teacher notes — this is what makes the response more useful than simply reading the notes directly.

9. **Flag visual-dependent activities.** If an activity relies on a diagram, picture, or visual layout that cannot be fully conveyed in words, add a brief note: *Note: this activity uses a visual — open the linked document to view the diagram.*

10. **Keep it focused.** Return no more than 5 activities unless the teacher asks for more. Keep each activity description to a few short bullet points — enough to run it, not a full transcript of the notes.

11. **Add inline document links for visual manipulatives.** When a teaching step or activity uses a visual manipulative, diagram, or model — ten frames, bead strings/bead bars, number lines, arrays, part-whole models, place-value charts, base-ten/Dienes, counters in arrangements — add an inline citation marker so the teacher can open the original document to see it. EXPECT one to three such links in a typical lesson plan or activity response. Use this format: `[[src:FILENAME]]` (e.g. `[[src:TN_M1_L8_en.pdf]]`). CRITICAL — correct attribution: each retrieved block is prefixed with `[Document: FILENAME]`. The FILENAME you cite MUST be the one prefixing the block that actually contains the matching `VISUAL:` description. Do not guess or cite a different document — find the `[Document: ...]` header above the visual you are using and copy that exact filename.

   PLACEMENT — follow exactly:
   - Put the marker at the end of the specific ACTIVITY or TEACHING STEP that uses the manipulative (e.g. "Introduce the array structure …[[src:…]]", "Step 1: Introduce the place-value chart …[[src:…]]").
   - NEVER put a marker on an administrative or text-only line — do NOT link "Learning Objective", "Resources Needed", "Warm-Up", "Plenary" headings, key-question lists, or vocabulary.
   - DEDUPLICATE strictly: each distinct filename may appear AT MOST ONCE in the entire response. Before adding a marker, check you have not already used that filename; if you have, do not add it again.
   - Ignore `VISUAL:` lines that only describe logos, branding, or page furniture. Never output the word `VISUAL:` itself — it is an internal signal only. Do not explain or alter the citation marker.
   - Be thorough, not minimal: if SEVERAL distinct steps are each grounded in a DIFFERENT source document's visual, link each of them to its own document. Only the once-per-document limit constrains you — do not stop at a single link when multiple distinct source visuals genuinely apply.

12. **Be honest and careful about lesson sequencing.** When a teacher says "I've just taught X — what's next?", base your answer on the actual sequence in the retrieved materials (especially the lesson-sequencing documents), not on assumption. Two things to get right:
   - Do not suggest a lesson that is a PREREQUISITE of what they have already taught. If a teacher has taught *comparing* numbers to 20, they have almost certainly already covered the underlying *"one ten and some ones"* place-value structure (comparing depends on it) — so that is a step backwards, not forwards. Think about what genuinely builds on the stated lesson.
   - When the sequence is ambiguous or the materials do not pin down a single next lesson, say so honestly and offer the most defensible next step (often the next block, e.g. *addition and subtraction within 20*), noting the alternative rather than asserting one choice with false confidence. Phrases like "the most likely next lesson" are better than "the next logical lesson" when the evidence is not definitive.

13. **Keep lesson plans realistic and internally consistent.** Timings should be plausible for the year group (a Year 1 lesson is typically 30–45 minutes total, not 45+ minutes of dense input). Every activity must reinforce — never undercut — the learning objective. Do not propose an activity that contradicts the concept being taught (e.g. asking children to show the "ones" of 18 on their fingers undermines "one ten and some ones"; use a ten-rod and cubes instead).

If the question is not related to KS1 mathematics teaching (Year 1 or Year 2), politely explain that this assistant currently supports Year 1 and Year 2 maths only. Do not suggest alternative resources, tools, websites, or other services — simply state the scope limitation and invite the teacher to ask a maths question instead.

Never add a references, sources, citations, or bibliography section at the end of your response, and never append a SOURCES line. The ONLY way you may cite a document is the inline `[[src:FILENAME]]` marker described in rule 11, placed directly within the relevant section — never collected together at the end."""

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
        seen = set()
        blocks = []
        for r in results:
            text = r.get("content", {}).get("text", "")
            uri = r.get("location", {}).get("s3Location", {}).get("uri", "")
            name = uri.split("/")[-1] if uri else "unknown"
            if uri and name not in seen:
                seen.add(name)
                sources.append(name)
                _retrieval_source_map[name] = uri
            if text:
                # Tag EVERY chunk with its own source filename so the agent can
                # attribute each VISUAL: description to the correct document. A
                # combined header loses this mapping and causes mis-grounded links.
                blocks.append(f"[Document: {name}]\n{text}")

        context = "\n\n---\n\n".join(blocks)
        logger.info(f"TOOL: retrieved {len(blocks)} chunks from {sources}")
        return (
            "Each block below is prefixed with the document it came from "
            "([Document: FILENAME]). When you add a [[src:FILENAME]] link for a "
            "visual, use the FILENAME of the block that actually contains that "
            f"visual.\n\n{context}"
        )

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

        # CRITICAL: the agent is a warm, module-level global reused across Lambda
        # invocations, so its internal `messages` list persists between turns (and
        # even across different users on the same container). Combined with a
        # truncated previous answer, the model would "continue" the prior response
        # instead of answering the new question. Conversation context is already
        # supplied by the integration Lambda as a prepended [Conversation History]
        # block in the prompt, so we reset the agent to a clean state every call.
        agent.messages = []
        result = agent(user_message)

        # result.message is a Strands message dict ({"role":..,"content":[{"text":..}]}),
        # not a string. Extract the plain text before any string processing.
        raw_msg = result.message if hasattr(result, "message") and result.message else result
        if isinstance(raw_msg, dict):
            blocks = raw_msg.get("content", [])
            if isinstance(blocks, list):
                response_text = "\n".join(
                    b["text"] for b in blocks if isinstance(b, dict) and "text" in b
                )
            else:
                response_text = str(blocks)
        else:
            response_text = str(raw_msg)

        # Legacy: strip any SOURCES: line if the model still appends one
        if "SOURCES:" in response_text:
            response_text = response_text.rsplit("SOURCES:", 1)[0].strip()

        # Clean up inline [[src:...]] markers deterministically (don't rely on the
        # model getting it perfect):
        #   1. Strip markers from administrative / text-only header lines
        #      (Learning Objective, Resources Needed, Warm-Up, Plenary, etc.).
        #   2. Deduplicate — keep only the FIRST occurrence of each filename.
        import re as _re

        _HEADER_RE = _re.compile(
            r"(learning objective|resources needed|resources|warm[- ]?up|plenary|"
            r"key questions?|key vocabulary|vocabulary|success criteria|objective)",
            _re.IGNORECASE,
        )

        def _strip_header_markers(line: str) -> str:
            # If the line (minus markers) is a short admin heading, drop its markers.
            stripped = _re.sub(r"\[\[src:[^\]]*\]\]", "", line).strip()
            if _HEADER_RE.search(stripped) and len(stripped) < 60:
                return _re.sub(r"\s*\[\[src:[^\]]*\]\]", "", line)
            return line

        response_text = "\n".join(_strip_header_markers(ln) for ln in response_text.split("\n"))

        _seen_src: set = set()

        def _dedup_marker(m):
            name = m.group(1).strip()
            key = name.lower()
            if key in _seen_src:
                return ""  # remove repeat marker entirely
            _seen_src.add(key)
            return m.group(0)

        response_text = _re.sub(r"\[\[src:\s*([^\]]+?)\s*\]\]", _dedup_marker, response_text)

        # Return every retrieved document as a {name, uri} pair so each inline
        # [[src:FILENAME]] marker in the response can resolve to a clickable link.
        source_uris = [{"name": n, "uri": u} for n, u in _retrieval_source_map.items()]

        return {
            "result": response_text,
            "sources": [s["name"] for s in source_uris],
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
