import os

from flask import Flask, jsonify, request, send_from_directory

from parser import finish_slide
from quizgen import extract_knowledge, llm_based, rule_based

BASE = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=os.path.join(BASE, "static"))
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.post("/api/analyze")
def analyze():
    raw = (request.get_json(force=True) or {}).get("slides") or []
    slides = [finish_slide(int(s.get("index", i + 1)), str(s.get("title", "")),
                           [str(l) for l in s.get("lines", [])], str(s.get("notes", "")))
              for i, s in enumerate(raw[:500])]
    points = extract_knowledge(slides)
    if not points:
        return jsonify(error="未能从文件中识别到文字内容（图片型课件暂不支持）"), 400
    return jsonify(slides=slides, points=points)


@app.post("/api/quiz")
def quiz():
    body = request.get_json(force=True) or {}
    slides, points = body.get("slides") or [], body.get("points") or []
    if not points:
        return jsonify(error="请先上传课件"), 400
    types = [t for t in body.get("types", []) if t in ("choice", "judge", "fill")] or ["choice", "judge"]
    count = max(1, min(int(body.get("count", 10)), 50))
    llm = body.get("llm") or {}
    warn = None
    if llm.get("api_key"):
        try:
            qs = llm_based(slides, types, count, llm)
            if qs:
                return jsonify(questions=qs, mode="ai")
            warn = "AI 未返回有效题目，已改用本地规则出题"
        except Exception as e:
            warn = f"AI 出题失败（{e}），已改用本地规则出题"
    qs = rule_based(points, types, count)
    if not qs:
        return jsonify(error="课件内容太少，无法生成题目"), 400
    return jsonify(questions=qs, mode="local", warning=warn)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
