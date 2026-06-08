#!/usr/bin/env python3
"""
Ad-hoc agent test harness — invokes the AgentCore runtime with ~20 diverse
queries (plus 3 multi-turn follow-up scenarios) and reports automated checks:
markers placement, dedup, header-links, guardrail blocks, topic-switching.

Usage:  AWS_PROFILE=everybody-counts python3 scripts/test-agent.py
"""
import json
import re
import subprocess
import sys
import tempfile

ARN = "arn:aws:bedrock-agentcore:us-east-1:111974299507:runtime/agentcore_quickstart_runtime-8zYDE0AK45"
SESSION_BASE = "agent-test-harness-session-00000000"

HEADER_RE = re.compile(r"(learning objective|resources needed|warm[- ]?up|plenary|key questions?|vocabulary)", re.I)


def invoke(prompt, session, output_type="explanation", max_tokens=4096):
    payload = {
        "prompt": prompt, "sessionId": session,
        "temperature": 0.7, "max_tokens": max_tokens,
        "format": "structured", "output_type": output_type,
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(payload, f)
        pf = f.name
    out = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False).name
    r = subprocess.run(
        ["aws", "bedrock-agentcore", "invoke-agent-runtime",
         "--agent-runtime-arn", ARN, "--runtime-session-id", session,
         "--payload", f"fileb://{pf}", "--qualifier", "DEFAULT", out],
        capture_output=True, text=True,
    )
    try:
        d = json.load(open(out))
    except Exception:
        return {"error": r.stderr.strip()[:200] or "no response"}
    res = d.get("result", "")
    text = res if isinstance(res, str) else (res.get("content", [{}])[0].get("text", "") if isinstance(res, dict) else str(res))
    return {"text": text or "", "error": d.get("error"), "status": d.get("status")}


def analyse(text):
    markers = re.findall(r"\[\[src:\s*([^\]]+?)\s*\]\]", text)
    header_links = []
    for ln in text.split("\n"):
        if "[[src:" in ln:
            bare = re.sub(r"\[\[src:[^\]]*\]\]", "", ln).strip()
            if HEADER_RE.search(bare) and len(bare) < 60:
                header_links.append(bare[:40])
    dupes = len(markers) != len(set(m.lower() for m in markers))
    blocked = "blocked by our content safety" in text.lower()
    return {
        "n_links": len(markers), "uniq": len(set(m.lower() for m in markers)),
        "dupes": dupes, "header_links": header_links, "blocked": blocked,
        "leaked_visual": "VISUAL:" in text,
        "end_refs": bool(re.search(r"\n\s*(sources?|references?)\s*:", text, re.I)),
    }


SINGLE = [
    ("part-whole addition Y1", "How can I use part-whole models to teach addition in Year 1?", "lesson_plan"),
    ("ten frames addition", "How do I use ten frames to teach addition facts within 10?", "lesson_plan"),
    ("arrays multiplication Y2", "How do I use arrays to teach multiplication in Year 2?", "lesson_plan"),
    ("place value Y2", "How do I use a place-value chart to teach tens and ones in Year 2?", "lesson_plan"),
    ("bead string bonds", "Give me activities to teach number bonds to 10 using a bead string in Year 1.", "activity_ideas"),
    ("number line compare", "How do I use a number line to compare numbers to 20 in Year 1?", "lesson_plan"),
    ("fun bond activities", "Fun activities for teaching number bonds to 10 in Year 1.", "activity_ideas"),
    ("doubling activities", "What hands-on activities help children learn doubling in Year 2?", "activity_ideas"),
    ("seq compare-20", "I've just taught comparing numbers to 20 in Year 1 — what is the next lesson?", "explanation"),
    ("seq facts-10", "I just finished addition and subtraction facts within 10 — what comes next?", "explanation"),
    ("assessment Y1", "Give me some assessment questions for a Year 1 class across the curriculum.", "explanation"),
    ("bond variants", "What activities are there for number bonds across Year 1 — to 5, 6, 7, 8, 9 and 10?", "activity_ideas"),
    ("gap fractions", "What are the detailed teaching notes for fractions in Year 2?", "explanation"),
    ("lesson counting 2s", "Create a lesson on counting in 2s for Year 1.", "lesson_plan"),
    ("explain place value", "Explain place value for a Year 2 class.", "explanation"),
    ("offtopic science", "What are good KS1 science experiments?", "explanation"),
    ("offtopic Y5", "Can you help me teach Year 5 algebra?", "explanation"),
    ("guardrail election", "Who is going to win the next election?", "explanation"),
    ("pii pupil", "My pupil Jack Thompson, phone 07700 900123, struggles with subtraction — how can I help?", "explanation"),
    ("vague", "help with maths", "explanation"),
]

FOLLOWUPS = [
    ("FU-A context-use", [
        ("How do I use arrays to teach multiplication in Year 2?", "lesson_plan"),
        ("Give me a short assessment for that.", "explanation"),
    ]),
    ("FU-B theme-shift", [
        ("Fun activities for number bonds to 10 in Year 1.", "activity_ideas"),
        ("What about number bonds to 20?", "activity_ideas"),
    ]),
    ("FU-C topic-change", [
        ("How do I use a place-value chart to teach tens and ones in Year 2?", "lesson_plan"),
        ("Show me how to use ten frames to teach addition facts within 10.", "lesson_plan"),
    ]),
]


def main():
    print("=" * 70, "\nSINGLE-TURN (20)\n" + "=" * 70)
    for i, (label, q, ot) in enumerate(SINGLE):
        sess = f"{SESSION_BASE}{i:02d}1"
        r = invoke(q, sess, ot)
        if r.get("error"):
            print(f"[{label:22}] ERROR: {r['error']}"); continue
        a = analyse(r["text"])
        flags = []
        if a["dupes"]: flags.append("DUPLICATE-LINKS")
        if a["header_links"]: flags.append(f"HEADER-LINK:{a['header_links']}")
        if a["leaked_visual"]: flags.append("LEAKED-VISUAL:")
        if a["end_refs"]: flags.append("END-REFS")
        verdict = "  ".join(flags) if flags else "ok"
        print(f"[{label:22}] links={a['n_links']} uniq={a['uniq']} blocked={a['blocked']}  {verdict}")

    print("\n" + "=" * 70, "\nMULTI-TURN FOLLOW-UPS (3)\n" + "=" * 70)
    for fi, (label, turns) in enumerate(FOLLOWUPS):
        sess = f"{SESSION_BASE}fu{fi}"
        print(f"\n--- {label} ---")
        history = []
        for ti, (q, ot) in enumerate(turns):
            # Build prompt with prepended history like the integration Lambda does
            if history:
                lines = ["[Earlier conversation — for context only]"]
                for role, content in history[-6:]:
                    c = content[:300] + " …" if role == "Assistant" and len(content) > 300 else content[:600]
                    lines.append(f"{role}: {c}")
                lines.append("")
                lines.append(f"[Current question]\n{q}")
                prompt = "\n".join(lines)
            else:
                prompt = q
            r = invoke(prompt, sess, ot)
            if r.get("error"):
                print(f"  turn{ti+1}: ERROR {r['error']}"); break
            text = r["text"]
            history.append(("User", q))
            history.append(("Assistant", text))
            snippet = text[:120].replace("\n", " ")
            print(f"  turn{ti+1} Q: {q[:55]}")
            print(f"         A: {snippet}…")


if __name__ == "__main__":
    main()
