import json
import random
import re
import uuid

import jieba
import jieba.posseg as pseg
import requests

jieba.setLogLevel(60)

DEF_RE = re.compile(r"^(.{1,24}?)\s*(是指|指的是|是|称为|定义为|就是|即|[:：])\s*(.{4,})$")
SWAPS = [
    ("增加", "减少"), ("增大", "减小"), ("提高", "降低"), ("大于", "小于"), ("高于", "低于"),
    ("上升", "下降"), ("正相关", "负相关"), ("必须", "不必"), ("可以", "不能"), ("能够", "无法"),
    ("包括", "不包括"), ("属于", "不属于"), ("有利于", "不利于"), ("促进", "抑制"), ("最大", "最小"),
    ("最高", "最低"), ("之前", "之后"), ("主动", "被动"), ("直接", "间接"), ("静态", "动态"),
    ("内部", "外部"), ("充分", "必要"), ("同步", "异步"), ("线性", "非线性"), ("有限", "无限"),
]


def _qid():
    return uuid.uuid4().hex[:10]


def extract_knowledge(slides):
    """Turn slides into a flat list of knowledge points."""
    points = []
    for s in slides:
        topic = s["title"] or f"第{s['index']}页"
        for line in s["points"]:
            if len(line) < 4 or len(line) > 300:
                continue
            kp = {"slide": s["index"], "topic": topic, "text": line}
            m = DEF_RE.match(line)
            if m and 1 < len(m.group(1).strip()) <= 24 and not re.search(r"[，,。；;]", m.group(1)):
                kp["term"] = m.group(1).strip()
                kp["definition"] = m.group(3).strip().rstrip("。")
            points.append(kp)
    return points


def _keywords(text):
    words = []
    for w, flag in pseg.cut(text):
        if len(w) >= 2 and (flag.startswith("n") or flag in ("vn", "eng", "nz", "l", "i")):
            words.append(w)
    return sorted(set(words), key=lambda w: -len(w))


def _mutate(text):
    for a, b in random.sample(SWAPS, len(SWAPS)):
        for x, y in ((a, b), (b, a)):
            if x in text and y not in text:
                return text.replace(x, y, 1)
    nums = re.findall(r"(?<![A-Za-z\d.])\d+(?:\.\d+)?(?![A-Za-z\d.])", text)
    if nums:
        n = random.choice(nums)
        v = float(n)
        new = v * random.choice([2, 0.5, 10]) if v else 1
        new = str(int(new)) if n.isdigit() else f"{new:g}"
        if new != n:
            return text.replace(n, new, 1)
    return None


def _choice(question, correct, distractors, kp, explanation=""):
    distractors = [d for d in dict.fromkeys(distractors) if d != correct][:3]
    if len(distractors) < 2:
        return None
    opts = distractors + [correct]
    random.shuffle(opts)
    return {
        "id": _qid(), "type": "choice", "question": question, "options": opts,
        "answer": opts.index(correct), "explanation": explanation or f"原文：{kp['text']}",
        "slide": kp["slide"], "topic": kp["topic"],
    }


def rule_based(points, types, count):
    defs = [p for p in points if "term" in p]
    gens = []
    for kp in points:
        others = [p for p in points if p["topic"] != kp["topic"]]
        if "choice" in types:
            if "term" in kp:
                pool = [d["definition"] for d in defs if d["term"] != kp["term"]]
                gens.append(lambda kp=kp, pool=pool: _choice(
                    f"「{kp['term']}」的含义是？", kp["definition"], random.sample(pool, min(3, len(pool))), kp))
                pool2 = [d["term"] for d in defs if d["term"] != kp["term"]]
                gens.append(lambda kp=kp, pool2=pool2: _choice(
                    f"“{kp['definition']}”描述的是哪个概念？", kp["term"], random.sample(pool2, min(3, len(pool2))), kp))
            if others:
                gens.append(lambda kp=kp, others=others: _choice(
                    f"下列哪一项是「{kp['topic']}」部分讲到的内容？", kp["text"],
                    [o["text"] for o in random.sample(others, min(3, len(others)))], kp))
            mutated = _mutate(kp["text"])
            if mutated:
                gens.append(lambda kp=kp, m=mutated, others=others: _choice(
                    f"关于「{kp['topic']}」，下列说法错误的是？", m,
                    [kp["text"]] + [o["text"] for o in random.sample(
                        [p for p in points if p["topic"] == kp["topic"] and p is not kp],
                        min(2, len([p for p in points if p["topic"] == kp["topic"] and p is not kp])))],
                    kp, f"正确说法：{kp['text']}"))
        if "judge" in types:
            def judge(kp=kp, others=others):
                truth = random.random() < 0.5
                stmt, exp = kp["text"], f"原文：{kp['text']}"
                if not truth:
                    m = _mutate(kp["text"])
                    if m:
                        stmt = m
                    elif "term" in kp and len(defs) > 1:
                        other = random.choice([d for d in defs if d["term"] != kp["term"]])
                        stmt = f"{kp['term']}是{other['definition']}"
                    else:
                        truth = True
                return {"id": _qid(), "type": "judge", "question": stmt, "answer": truth,
                        "explanation": exp, "slide": kp["slide"], "topic": kp["topic"]}
            gens.append(judge)
        if "fill" in types:
            def fill(kp=kp):
                ans = kp.get("term")
                if not ans:
                    kws = [w for w in _keywords(kp["text"]) if w not in kp["topic"]] or _keywords(kp["text"])
                    if not kws:
                        return None
                    ans = random.choice(kws[:3])
                if ans not in kp["text"] or len(kp["text"]) - len(ans) < 4:
                    return None
                return {"id": _qid(), "type": "fill", "question": kp["text"].replace(ans, "＿＿＿＿", 1),
                        "answer": ans, "explanation": f"原文：{kp['text']}",
                        "slide": kp["slide"], "topic": kp["topic"]}
            gens.append(fill)

    random.shuffle(gens)
    out, seen = [], set()
    for g in gens:
        if len(out) >= count:
            break
        q = g()
        if q and q["question"] not in seen:
            seen.add(q["question"])
            out.append(q)
    return out


TYPE_NAMES = {"choice": "单项选择题", "judge": "判断题", "fill": "填空题"}

PROMPT = """你是一名大学老师。下面是某节课PPT的内容（按页）。请先理解并提炼其中的核心知识点，然后据此出 {count} 道题，题型限于：{types}。
要求：
1. 题目必须基于课件内容，考察理解而非死记页码；覆盖尽量多的不同知识点。
2. 选择题提供4个选项，干扰项要合理、有迷惑性；answer 为正确选项下标(0-3)。
3. 判断题 answer 为 true 或 false，真假各约一半。
4. 填空题 answer 为简短标准答案（词或短语）。
5. 每题给出 explanation（解析）和 slide（对应页码，整数）以及 topic（知识点名称）。
只输出 JSON，格式：{{"questions":[{{"type":"choice|judge|fill","question":"...","options":["..."],"answer":...,"explanation":"...","slide":1,"topic":"..."}}]}}

课件内容：
{content}
"""


def llm_based(slides, types, count, cfg):
    content = []
    for s in slides:
        body = "\n".join(f"- {p}" for p in s["points"])
        notes = f"\n备注：{s['notes']}" if s.get("notes") else ""
        content.append(f"【第{s['index']}页】{s['title']}\n{body}{notes}")
    text = "\n\n".join(content)[:30000]
    prompt = PROMPT.format(count=count, types="、".join(TYPE_NAMES[t] for t in types), content=text)
    base = (cfg.get("base_url") or "https://api.deepseek.com/v1").rstrip("/")
    resp = requests.post(
        f"{base}/chat/completions",
        headers={"Authorization": f"Bearer {cfg['api_key']}"},
        json={"model": cfg.get("model") or "deepseek-chat", "temperature": 0.7,
              "messages": [{"role": "user", "content": prompt}]},
        timeout=180,
    )
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"]
    m = re.search(r"\{.*\}", raw, re.S)
    data = json.loads(m.group(0) if m else raw)
    out = []
    for q in data.get("questions", []):
        t = q.get("type")
        if t not in types or not q.get("question"):
            continue
        item = {"id": _qid(), "type": t, "question": q["question"], "explanation": q.get("explanation", ""),
                "slide": q.get("slide"), "topic": q.get("topic", "")}
        if t == "choice":
            opts = q.get("options") or []
            ans = q.get("answer")
            if isinstance(ans, str):
                ans = "ABCD".index(ans.strip()[0].upper()) if ans.strip()[:1].upper() in "ABCD" else (
                    opts.index(ans) if ans in opts else None)
            if len(opts) < 2 or not isinstance(ans, int) or not 0 <= ans < len(opts):
                continue
            item.update(options=[re.sub(r"^[A-D][.、．:：]\s*", "", o) for o in opts], answer=ans)
        elif t == "judge":
            ans = q.get("answer")
            if isinstance(ans, str):
                ans = ans.strip().lower() in ("true", "对", "正确", "√", "t", "yes")
            item["answer"] = bool(ans)
        else:
            item["answer"] = str(q.get("answer", "")).strip()
        out.append(item)
    return out[:count]
