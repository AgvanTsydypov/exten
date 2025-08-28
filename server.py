from flask import Flask, request, jsonify
import os, sys, json, re
from typing import List, Dict, Any

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

# --------------------- ЛОГИКА ИЗ ПЕРВОГО СКРИПТА ---------------------

SENTENCE_SPLIT_REGEX = r'(?<=[.?!])\s+'
MAX_BLOCK_LEN = 2200
IMPORTANCE_THRESHOLD = 8


def _pick_tail_block(full_text: str) -> str:
    """
    Берем последнее предложение и добавляем предложения слева,
    пока общий размер блока < MAX_BLOCK_LEN.
    """
    parts = [s for s in re.split(SENTENCE_SPLIT_REGEX, full_text.strip()) if s]
    if not parts:
        return ""
    text = parts[-1]
    for s in reversed(parts[:-1]):
        if len(s) + 1 + len(text) < MAX_BLOCK_LEN:
            text = f"{s} {text}"
        else:
            break
    return text


def _build_prompt(block_text: str, context: str = global_context) -> str:
    return f"""
Improve the following text.
The improved version should be concise, clear, and impactful while preserving all the necessary information contained in the original.

{context}

Additionally, for each suggested change, rate its importance out of 10. 1 to 4 indicates little to no improvement (e.g., a simple paraphrase);
5 indicates minor improvement; and 6 to 10 indicates notable improvement.

Return your response as a JSON array with three keys:
1. "original": The original sentence provided in the block of text.
2. "suggestion": The suggested improved version of the specific sentence.
3. "importance": The importance rating of the suggested sentence out of 10.

Rules:
    Normally, there is a one-to-one mapping: each original sentence gets one improved sentence.
    If multiple original sentences are best replaced by a smaller set of sentences, include one JSON entry per original sentence. Each entry should have the same "suggestion" value (the entire replacement set).
    If one original sentence is best expanded into multiple sentences, do the same: produce one entry per original sentence, all pointing to the entire replacement set.
    Only merge or split sentences when it improves clarity, conciseness, or impact.
    Do not change meaning.

Block of text: "{block_text}"
Only return a valid JSON array. Do not include explanations or markdown fences.
""".strip()


# def _call_deepseek_for_json(prompt: str, model: str = DEFAULT_MODEL) -> str:
#     """
#     Вызывает DeepSeek и возвращает сырой текст ответа (ожидаем JSON-массив).
#     """
#     resp = client.chat.completions.create(
#         model=model,
#         messages=[
#             {"role": "system", "content": "You are a helpful, precise editor. Return only valid JSON arrays."},
#             {"role": "user", "content": prompt},
#         ],
#         stream=False,
#         temperature=0.2,
#     )
#     msg = resp.choices[0].message
#     return getattr(msg, "content", "") or ""

def _call_gemini_for_json(prompt: str, model: str = DEFAULT_MODEL) -> str:
    """
    Вызывает Gemini 2.5 Flash и возвращает сырой текст ответа (ожидаем JSON-массив).
    Включаем жёсткий JSON-режим через response_mime_type, чтобы не ловить «кодфенсы» и прочий мусор.
    По желанию можно отключить 'thinking' (снизит задержку/стоимость).
    """
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            # thinking_config=types.ThinkingConfig(thinking_budget=0),  # раскомментируйте, если хотите быстрее/дешевле
        ),
    )
    # .text уже приведён к строке; при response_mime_type="application/json" это валидный JSON (строка)
    return response.text or ""


def _extract_json_array(text: str) -> Any:
    """
    Модель иногда оборачивает ответ в тексты/кодфенсы.
    Пытаемся достать первый JSON-массив безопасно.
    """
    # Сначала убираем ```json ... ```
    fenced = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, flags=re.S)
    if fenced:
        text = fenced.group(1)

    # Если в чистом виде массив — отлично
    text = text.strip()
    if text.startswith("[") and text.endswith("]"):
        return json.loads(text)

    # Попробуем найти первый массив в тексте
    match = re.search(r"\[.*\]", text, flags=re.S)
    if match:
        return json.loads(match.group(0))

    # Иногда вернется объект; допустим и его
    if text.startswith("{") and text.endswith("}"):
        data = json.loads(text)
        if isinstance(data, dict):
            return [data]

    # Если ничего не вышло — бросим исключение
    raise ValueError("Model did not return a valid JSON array")


def _group_and_filter(data: List[Dict[str, Any]], threshold: int = IMPORTANCE_THRESHOLD) -> List[Dict[str, str]]:
    """
    Группируем подряд идущие элементы с одинаковым 'suggestion' (логика «слияния/разбиения»),
    оставляем только группы, где есть хотя бы один элемент с importance >= threshold.
    На выход — список {original, suggestion} (importance удаляем).
    """
    # Нормализация ключей и типов
    norm = []
    for d in data:
        if not isinstance(d, dict):
            continue
        original = str(d.get("original", "")).strip()
        suggestion = str(d.get("suggestion", "")).strip()
        try:
            importance = float(d.get("importance", 0))
        except Exception:
            importance = 0.0
        if original and suggestion:
            norm.append({"original": original, "suggestion": suggestion, "importance": importance})

    kept: List[Dict[str, Any]] = []
    run: List[Dict[str, Any]] = []

    for d in norm:
        if not run or d["suggestion"] == run[-1]["suggestion"]:
            run.append(d)
        else:
            if any(x["importance"] >= threshold for x in run):
                kept.extend(run)
            run = [d]

    if run and any(x["importance"] >= threshold for x in run):
        kept.extend(run)

    return [{"original": x["original"], "suggestion": x["suggestion"]} for x in kept]


def get_suggestions(full_text: str, context: str = "", model: str = DEFAULT_MODEL) -> List[Dict[str, str]]:
    """
    Главная функция: применяет «хвостовой» блок, строит промпт, вызывает DeepSeek,
    парсит JSON, группирует и фильтрует по важности.
    """
    block = _pick_tail_block(full_text)
    if not block:
        return []

    prompt = _build_prompt(block, context=context)
    raw = _call_gemini_for_json(prompt, model=model)

    try:
        data = _extract_json_array(raw)
    except Exception as e:
        # Если JSON не распарсили — пустой список, чтобы не падать сервером
        print(f"JSON parse error: {e}\nRaw:\n{raw[:1000]}", file=sys.stderr)
        return []

    try:
        return _group_and_filter(data, threshold=IMPORTANCE_THRESHOLD)
    except Exception as e:
        print(f"Filter/group error: {e}", file=sys.stderr)
        return []


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

    if not text:
        return jsonify(ok=False, error="No 'text' provided"), 400
    
    print(text)

    print(f"\n=== RECEIVED MAIN ===\nFrom: {url}\nLen: {len(text)} chars\n==========================\n")

    try:
        suggestions = get_suggestions(text, context=context, model=DEFAULT_MODEL)

        # Печать в консоль для отладки
        print("=== SUGGESTIONS ===")
        for i, s in enumerate(suggestions, 1):
            print(f"{i:02d}. ORIGINAL: {s['original']}\n    SUGGEST : {s['suggestion']}\n")
        print("===================\n")

        return jsonify(ok=True, suggestions=suggestions, model=DEFAULT_MODEL)

    except Exception as e:
        print(f"DeepSeek error: {e}", file=sys.stderr)
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
        global_context = context

        print(global_context)

        return jsonify(ok=True, global_context=global_context, model=DEFAULT_MODEL)

    except Exception as e:
        print(f"Context error: {e}", file=sys.stderr)
        return jsonify(ok=False, error=str(e)), 500


@app.route("/highlight", methods=["GET", "OPTIONS"])
def watch_config():
    if request.method == "OPTIONS":
        return ("", 204)
    # Теперь возвращаем СПИСКИ; клиент может интерпретировать их как набор правил
    return jsonify(
        ok=True,
        text_to_change=text_to_change,   # список шаблонов/фраз для поиска
        suggested_text=suggested_text,   # список соответствующих предложений/замен
        match="contains",                # "contains" или "equals"
        poll_ms=5000
    )


if __name__ == "__main__":
    # POST http://127.0.0.1:5055/highlight  с JSON: {"text": "....", "context": "optional"}
    app.run(host="127.0.0.1", port=5055, debug=True)
