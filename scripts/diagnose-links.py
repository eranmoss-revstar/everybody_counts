#!/usr/bin/env python3
"""
Diagnose whether visual linking is too strict.

For each query: count DISTINCT documents whose retrieved chunks contain a
MEANINGFUL VISUAL: description (ten frame, bead string, array, part-whole,
number line, place-value chart, base-ten, counters — not logos), then invoke
the agent and count how many DISTINCT documents it actually linked.

A large gap (many visual docs available, few linked) = linking is too strict.

Usage: AWS_PROFILE=everybody-counts python3 scripts/diagnose-links.py
"""
import json
import re
import subprocess
import tempfile

KB = "A0WASV2X24"
ARN = "arn:aws:bedrock-agentcore:us-east-1:111974299507:runtime/agentcore_quickstart_runtime-8zYDE0AK45"

MEANINGFUL = re.compile(
    r"ten[- ]?frame|bead (string|bar)|\barray\b|part[- ]?(part[- ]?)?whole|"
    r"number line|place[- ]?value|base[- ]?ten|dienes|counter|ten[- ]?rod|tens and ones",
    re.I,
)

QUERIES = [
    ("place value Y2", "How do I use a place-value chart to teach tens and ones in Year 2?", "lesson_plan"),
    ("ten frames add", "How do I use ten frames to teach addition facts within 10?", "lesson_plan"),
    ("arrays mult Y2", "How do I use arrays to teach multiplication in Year 2?", "lesson_plan"),
    ("part-whole add", "How can I use part-whole models to teach addition in Year 1?", "lesson_plan"),
    ("teen place value", "Teach Year 1 that teen numbers are one ten and some ones.", "lesson_plan"),
]


def aws_json(args):
    r = subprocess.run(["aws"] + args, capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except Exception:
        return {"_err": r.stderr.strip()[:160]}


def retrieve_visual_docs(query):
    d = aws_json([
        "bedrock-agent-runtime", "retrieve", "--knowledge-base-id", KB,
        "--retrieval-query", json.dumps({"text": query}),
        "--retrieval-configuration", json.dumps({"vectorSearchConfiguration": {"numberOfResults": 12}}),
    ])
    docs_with_visual = {}
    for r in d.get("retrievalResults", []):
        name = r.get("location", {}).get("s3Location", {}).get("uri", "").split("/")[-1]
        text = r.get("content", {}).get("text", "")
        for line in text.split("\n"):
            if line.strip().startswith("VISUAL:") and MEANINGFUL.search(line):
                docs_with_visual.setdefault(name, line.strip()[:90])
                break
    return docs_with_visual


def invoke_links(query, ot):
    payload = {"prompt": query, "sessionId": "diag-links-session-00000000000001",
               "temperature": 0.5, "max_tokens": 3500, "format": "structured", "output_type": ot}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(payload, f); pf = f.name
    out = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False).name
    subprocess.run(["aws", "bedrock-agentcore", "invoke-agent-runtime",
                    "--agent-runtime-arn", ARN, "--runtime-session-id", payload["sessionId"],
                    "--payload", f"fileb://{pf}", "--qualifier", "DEFAULT", out],
                   capture_output=True, text=True)
    try:
        d = json.load(open(out))
    except Exception:
        return set()
    r = d.get("result", "")
    t = r if isinstance(r, str) else ""
    return set(m.strip().lower() for m in re.findall(r"\[\[src:\s*([^\]]+?)\s*\]\]", t))


def main():
    print(f"{'query':16} {'visual-docs':12} {'linked':8} {'ratio':8} verdict")
    print("-" * 60)
    for label, q, ot in QUERIES:
        avail = retrieve_visual_docs(q)
        linked = invoke_links(q, ot)
        n_avail, n_link = len(avail), len(linked)
        ratio = f"{n_link}/{n_avail}" if n_avail else "0/0"
        if n_avail == 0:
            verdict = "no visuals retrieved"
        elif n_link == 0:
            verdict = "⚠ TOO STRICT (0 links, visuals exist)"
        elif n_link < n_avail / 2:
            verdict = "⚠ possibly strict"
        else:
            verdict = "ok"
        print(f"{label:16} {n_avail:<12} {n_link:<8} {ratio:8} {verdict}")
        # show which available docs were NOT linked
        missed = set(d.lower() for d in avail) - linked
        if missed and n_avail:
            print(f"                 not linked: {sorted(list(missed))[:4]}")


if __name__ == "__main__":
    main()
