from flask import Flask, request, jsonify
import os, sys, json, re
from typing import List, Tuple, Optional, TypedDict

# Gemini (Google Gen AI SDK)
from google import genai
from google.genai import types  # для generation config (JSON-режим, thinking и т.п.)

from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)

# ---- Gemini client ----
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("Set GEMINI_API_KEY in your environment")
client = genai.Client(api_key=GEMINI_API_KEY)

# Выберите модель:
#   - "gemini-2.5-flash"         -> быстрая и недорогая, с «thinking» (по умолчанию включён)
#   - "gemini-2.5-flash-lite"    -> ещё дешевле/ниже задержка (если нужно)
DEFAULT_MODEL = "gemini-2.5-flash"

text_to_change: List[str] = [
    "Old text",
]
suggested_text: List[str] = [
    "Suggested text",
]

global_context = ""


class Suggestion(TypedDict):
    original: str
    suggestion: str


def get_suggestions(text: str, context: Optional[str] = None) -> List[Suggestion]:
    # если контекст не передали или он пустой — берём глобальный
    if not context:
        context = global_context

    parts = [s for s in re.split(r'(?<=[.?!])\s+', text.strip()) if s]
    if not parts:
        return []
    block = parts[-1]
    for s in reversed(parts[:-1]):
        if len(s) + 1 + len(block) < 2200:
            block = f"{s} {block}"
        else:
            break

    prompt = f"""
    [SYSTEM CONTEXT:
    {context}
    ]

    In TEXT (given below), identify all sentences which contain CLEAR imperfections (e.g., grammar/spelling/punctuation/syntax errors, unfinished sentences, inconsistencies with the rest
    of the text [content, tense, style, etc], awkward phrasings, unclear/imprecise phrases, clearly unnecessary wordiness, factual errors, clear inconsistency
    with the SYSTEM CONTEXT, etc). For each such sentence, suggest an improvement which fixes/adresses the imperfection(s) without changing meaning 
    (except in CLEAR cases of factual errors). If the sentence has no clear imperfections, skip it.

    Return your response as a JSON array two keys:
    1. "original": The original sentence provided in the TEXT.
    2. "suggestion": The suggested improved version of the sentence specific sentence.

    RULES:
        Normally, there is a one-to-one mapping: each original sentence gets one improved sentence.
        If multiple original sentences are best replaced by a smaller set of sentences, include one JSON entry per original sentence. Each entry should have the same "suggestion" value (the entire replacement set).
        If one original sentence is best expanded into multiple sentences, do the same: produce one entry per original sentence, all pointing to the entire replacement set.
        Only merge or split sentences if it addresses the root imperfections.
        Only change the meaning in CLEAR cases of factual errors.

    TEXT: "{block}"
    """

    print(prompt)

    combined_config = {
        "thinking_config": types.ThinkingConfig(thinking_budget=128),
        "response_mime_type": "application/json",
        "response_schema": list[Suggestion],
    }


    response = client.models.generate_content(
        model=DEFAULT_MODEL,
        contents=prompt,
        config=combined_config
    )

    return json.loads(response.text)

def get_highlighted_suggestion(
    selected_text: str,
    text: Optional[str] = None,
    context: str = "",
    global_context: str = "",
    *,
    client,
    model: str
) -> Tuple[str, str]:
    """
    Returns (suggestion_text, marked_excerpt).
    """
    if not text:
        text = selected_text

    def _sentence_spans(t: str):
        return [m.span() for m in re.finditer(r'[^.?!]+(?:[.?!]|$)', t, flags=re.MULTILINE)]

    sel_start = text.find(selected_text) if selected_text else -1
    sel_end = sel_start + len(selected_text) if sel_start != -1 else -1

    if sel_start == -1 and selected_text:
        relaxed = re.escape(" ".join(selected_text.split())).replace(r"\ ", r"\s+")
        m = re.search(relaxed, text, flags=re.MULTILINE)
        if m:
            sel_start, sel_end = m.span()
        else:
            return "Selected text not found in the main text", ""

    spans = _sentence_spans(text)
    if not spans:
        return "", ""

    first_idx = None
    last_idx = None
    for i, (s, e) in enumerate(spans):
        if e > sel_start and first_idx is None:
            first_idx = i
        if s < sel_end:
            last_idx = i
    if first_idx is None:
        first_idx = last_idx = 0

    left_idx = max(0, first_idx - 1) if first_idx > 0 else first_idx
    right_idx = min(len(spans) - 1, (last_idx if last_idx is not None else first_idx) + 1)
    excerpt_start = spans[left_idx][0]
    excerpt_end = spans[right_idx][1]
    excerpt = text[excerpt_start:excerpt_end]
    rel_start = max(0, sel_start - excerpt_start)
    rel_end = max(rel_start, sel_end - excerpt_start)
    marked_excerpt = excerpt[:rel_start] + "-->" + excerpt[rel_start:rel_end] + "<--" + excerpt[rel_end:]

    prompt = f"""
        Improve ONLY the text between --> and <-- so it is concise, clear, and impactful, 
        while preserving all necessary information and matching the surrounding style and tense.
        Do not rewrite anything outside the markers.
        Return ONLY the improved text as plain text.

        {global_context}
        {context}
        
        Text: {marked_excerpt}"""

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="text/plain",
            thinking_config=types.ThinkingConfig(thinking_budget=128),
        ),
    )

    return getattr(response, "text", None), marked_excerpt


# --------------------- HTTP СЛОЙ ---------------------

# CORS — позволяем простые кросс-доменные запросы
@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    return resp


@app.route("/main", methods=["POST", "OPTIONS"])
def main_text_proccessing():
    if request.method == "OPTIONS":
        return ("", 204)

    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    url = data.get("url") or ""
    context = (data.get("context") or "").strip()  # опционально: дополнительный контекст

    body_context = (data.get("context") or "").strip()
    ctx = global_context + "\n" + body_context  # <-- вот это важно

    if not text:
        return jsonify(ok=False, error="No 'text' provided"), 400
    
    print(text)

    print(f"\n=== RECEIVED MAIN ===\nFrom: {url}\nLen: {len(text)} chars\n==========================\n")

    try:
        suggestions = get_suggestions(text, context=ctx)

        # Печать в консоль для отладки
        print("=== SUGGESTIONS ===")
        for i, s in enumerate(suggestions, 1):
            print(f"{i:02d}. ORIGINAL: {s['original']}\n    SUGGEST : {s['suggestion']}\n")
        print("===================\n")

        return jsonify(ok=True, suggestions=suggestions, model=DEFAULT_MODEL)

    except Exception as e:
        print(f"Gemini error: {e}", file=sys.stderr)
        return jsonify(ok=False, error=str(e)), 500
    
@app.route("/global_context", methods=["POST", "OPTIONS"])
def context_proccessing():
    if request.method == "OPTIONS":
        return ("", 204)

    data = request.get_json(silent=True) or {}
    context = (data.get("context") or "").strip()  # опционально: дополнительный контекст

    if not context:
        return jsonify(ok=False, error="No 'context' provided"), 400

    print(f"\n=== RECEIVED CONTEXT ===\n {len(context)} chars\n==========================\n")

    try:
        global global_context
        global_context = context

        print(global_context)

        return jsonify(ok=True, global_context=global_context, model=DEFAULT_MODEL)

    except Exception as e:
        print(f"Context error: {e}", file=sys.stderr)
        return jsonify(ok=False, error=str(e)), 500


@app.route("/highlight", methods=["GET", "OPTIONS"])
def highlighted_text_proccessing():
    if request.method == "OPTIONS":
        return ("", 204)

    selected_text = (request.args.get("selected_text") or "").strip()
    text = request.args.get("text")
    context = (request.args.get("context") or "").strip()
    gc_override = request.args.get("global_context")
    gc = (gc_override if gc_override is not None else global_context) or ""

    if not selected_text:
        return jsonify(ok=False, error="Query param 'selected_text' is required"), 400

    try:
        suggestion, marked_excerpt = get_highlighted_suggestion(
            selected_text=selected_text,
            text=text,
            context=context,
            global_context=gc,
            client=client,
            model=DEFAULT_MODEL,
        )
        return jsonify(ok=True, suggestion=suggestion or "", marked_excerpt=marked_excerpt or "", model=DEFAULT_MODEL)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


if __name__ == "__main__":
    # POST http://127.0.0.1:5055/highlight  с JSON: {"text": "....", "context": "optional"}
    app.run(host="127.0.0.1", port=5055, debug=True)
