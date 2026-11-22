import os
import uuid

from flask import Flask, jsonify, request, send_from_directory

from parser import parse_file
from quizgen import extract_knowledge, llm_based, rule_based

app = Flask(__name__, static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024
DOCS = {}


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.post("/api/upload")
def upload():
    f = request.files.get("file")
    if not f:
        return jsonify(error="请选择文件"), 400
    try:
        slides = parse_file(f.filename, f.read())
    except ValueError as e:
        return jsonify(error=str(e)), 400
    except Exception as e:
        return jsonify(error=f"文件解析失败：{e}"), 400
    points = extract_knowledge(slides)
    if not points:
        return jsonify(error="未能从文件中识别到文字内容（图片型课件暂不支持）"), 400
    doc_id = uuid.uuid4().hex
    DOCS[doc_id] = {"name": f.filename, "slides": slides, "points": points}
    return jsonify(doc_id=doc_id, name=f.filename, slides=slides, points=points)


@app.post("/api/quiz")
def quiz():
    body = request.get_json(force=True)
    doc = DOCS.get(body.get("doc_id"))
    if not doc:
        return jsonify(error="课件已过期，请重新上传"), 404
    types = [t for t in body.get("types", []) if t in ("choice", "judge", "fill")] or ["choice", "judge"]
    count = max(1, min(int(body.get("count", 10)), 50))
    llm = body.get("llm") or {}
    if llm.get("api_key"):
        try:
            qs = llm_based(doc["slides"], types, count, llm)
            if qs:
                return jsonify(questions=qs, mode="ai")
            warn = "AI 未返回有效题目，已改用本地规则出题"
        except Exception as e:
            warn = f"AI 出题失败（{e}），已改用本地规则出题"
    else:
        warn = None
    qs = rule_based(doc["points"], types, count)
    if not qs:
        return jsonify(error="课件内容太少，无法生成题目"), 400
    return jsonify(questions=qs, mode="local", warning=warn)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
