// Knowledge extraction and question generation, all in the browser.
const clean = s => String(s || "").replace(/\s+/g, " ").trim().replace(/^[•·●○■□◆◇▪►\-–—*\s]+|[•·●○■□◆◇▪►\-–—*\s]+$/g, "");

function finishSlide(s) {
  const seen = new Set(), points = [];
  for (const l of (s.lines || []).map(clean)) {
    if (!l || seen.has(l) || /^[\d\s./-]+$/.test(l)) continue;
    seen.add(l); points.push(l);
  }
  let title = clean(s.title);
  if (!title && points.length) title = points.shift();
  return {index: s.index, title: title.slice(0, 80), points, notes: clean(s.notes)};
}

const DEF_RE = /^(.{1,24}?)\s*(是指|指的是|是|称为|定义为|就是|即|[:：])\s*(.{4,})$/;

function extractKnowledge(slides) {
  const out = [];
  for (const s of slides) {
    const topic = s.title || `第${s.index}页`;
    for (const text of s.points) {
      if (text.length < 4 || text.length > 300) continue;
      const kp = {slide: s.index, topic, text};
      const m = text.match(DEF_RE);
      if (m && m[1].trim().length > 1 && !/[，,。；;]/.test(m[1])) {
        kp.term = m[1].trim();
        kp.definition = m[3].trim().replace(/。$/, "");
      }
      out.push(kp);
    }
  }
  return out;
}

const SWAPS = [["增加","减少"],["增大","减小"],["提高","降低"],["大于","小于"],["高于","低于"],["上升","下降"],
  ["正相关","负相关"],["必须","不必"],["可以","不能"],["能够","无法"],["包括","不包括"],["属于","不属于"],
  ["有利于","不利于"],["促进","抑制"],["最大","最小"],["最高","最低"],["之前","之后"],["主动","被动"],
  ["直接","间接"],["静态","动态"],["内部","外部"],["充分","必要"],["同步","异步"],["线性","非线性"],["有限","无限"]];
const STOP = new Set("我们 你们 他们 这个 那个 这些 那些 以及 或者 并且 而且 因为 所以 如果 但是 可以 能够 进行 通过 对于 关于 其中 一种 一个 主要 需要 没有 已经 就是 什么 如何 怎么 the and for with that this are from".split(" "));

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sample = (a, n) => shuffle([...a]).slice(0, n);
const pick = a => a[Math.random() * a.length | 0];
let _id = 0;
const qid = () => `q${Date.now().toString(36)}${_id++}`;

function keywords(text) {
  let words = [];
  if (window.Intl && Intl.Segmenter) {
    for (const seg of new Intl.Segmenter("zh", {granularity: "word"}).segment(text))
      if (seg.isWordLike) words.push(seg.segment);
  } else words = text.match(/[\u4e00-\u9fa5]{2,4}|[A-Za-z]{3,}/g) || [];
  words = words.filter(w => w.length >= 2 && !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w));
  return [...new Set(words)].sort((a, b) => b.length - a.length);
}

function mutate(text) {
  for (const [a, b] of shuffle([...SWAPS]))
    for (const [x, y] of [[a, b], [b, a]])
      if (text.includes(x) && !text.includes(y)) return text.replace(x, y);
  const nums = text.match(/(?<![A-Za-z\d.])\d+(?:\.\d+)?(?![A-Za-z\d.])/g);
  if (nums) {
    const n = pick(nums), v = parseFloat(n);
    let nv = v ? v * pick([2, 0.5, 10]) : 1;
    nv = /^\d+$/.test(n) ? String(Math.round(nv)) : String(+nv.toFixed(4));
    if (nv !== n) return text.replace(n, nv);
  }
  return null;
}

function choice(question, correct, distractors, kp, explanation) {
  distractors = [...new Set(distractors)].filter(d => d !== correct).slice(0, 3);
  if (distractors.length < 2) return null;
  const options = shuffle([...distractors, correct]);
  return {id: qid(), type: "choice", question, options, answer: options.indexOf(correct),
    explanation: explanation || `原文：${kp.text}`, slide: kp.slide, topic: kp.topic};
}

const solid = p => p.term || (p.text.length >= 8 && /[\u4e00-\u9fff]{4}|([A-Za-z]{2,}\W+){4}/.test(p.text));

function ruleBased(allPoints, types, count) {
  const points = allPoints.filter(solid).length >= 5 ? allPoints.filter(solid) : allPoints;
  const defs = points.filter(p => p.term), gens = [];
  for (const kp of points) {
    const others = points.filter(p => p.topic !== kp.topic);
    const same = points.filter(p => p.topic === kp.topic && p !== kp);
    if (types.includes("choice")) {
      if (kp.term) {
        const pool = defs.filter(d => d.term !== kp.term);
        gens.push(() => choice(`「${kp.term}」的含义是？`, kp.definition, sample(pool, 3).map(d => d.definition), kp));
        gens.push(() => choice(`“${kp.definition}”描述的是哪个概念？`, kp.term, sample(pool, 3).map(d => d.term), kp));
      }
      if (others.length)
        gens.push(() => choice(`下列哪一项是「${kp.topic}」部分讲到的内容？`, kp.text, sample(others, 3).map(o => o.text), kp));
      const m = mutate(kp.text);
      if (m) gens.push(() => choice(`关于「${kp.topic}」，下列说法错误的是？`, m,
        [kp.text, ...sample(same, 2).map(o => o.text)], kp, `正确说法：${kp.text}`));
    }
    if (types.includes("judge")) gens.push(() => {
      let truth = Math.random() < 0.5, stmt = kp.text;
      if (!truth) {
        const m = mutate(kp.text);
        if (m) stmt = m;
        else if (kp.term && defs.length > 1) stmt = `${kp.term}是${pick(defs.filter(d => d.term !== kp.term)).definition}`;
        else truth = true;
      }
      return {id: qid(), type: "judge", question: stmt, answer: truth, explanation: `原文：${kp.text}`, slide: kp.slide, topic: kp.topic};
    });
    if (types.includes("fill")) gens.push(() => {
      let ans = kp.term;
      if (!ans) {
        const all = keywords(kp.text), kws = all.filter(w => !kp.topic.includes(w));
        const list = kws.length ? kws : all;
        if (!list.length) return null;
        ans = pick(list.slice(0, 3));
      }
      if (!kp.text.includes(ans) || kp.text.length - ans.length < 4) return null;
      return {id: qid(), type: "fill", question: kp.text.replace(ans, "＿＿＿＿"), answer: ans,
        explanation: `原文：${kp.text}`, slide: kp.slide, topic: kp.topic};
    });
  }
  const out = [], seen = new Set();
  for (const g of shuffle(gens)) {
    if (out.length >= count) break;
    const q = g();
    if (q && !seen.has(q.question)) { seen.add(q.question); out.push(q); }
  }
  return out;
}

const TYPE_NAMES = {choice: "单项选择题", judge: "判断题", fill: "填空题"};

async function llmBased(slides, types, count, cfg) {
  const content = slides.map(s => `【第${s.index}页】${s.title}\n${s.points.map(p => "- " + p).join("\n")}${s.notes ? "\n备注：" + s.notes : ""}`).join("\n\n").slice(0, 30000);
  const prompt = `你是一名大学老师。下面是某节课PPT的内容（按页）。请先理解并提炼其中的核心知识点，然后据此出 ${count} 道题，题型限于：${types.map(t => TYPE_NAMES[t]).join("、")}。
要求：
1. 题目必须基于课件内容，考察理解而非死记页码；覆盖尽量多的不同知识点。
2. 选择题提供4个选项，干扰项要合理、有迷惑性；answer 为正确选项下标(0-3)。
3. 判断题 answer 为 true 或 false，真假各约一半。
4. 填空题 answer 为简短标准答案（词或短语）。
5. 每题给出 explanation（解析）和 slide（对应页码，整数）以及 topic（知识点名称）。
只输出 JSON，格式：{"questions":[{"type":"choice|judge|fill","question":"...","options":["..."],"answer":0,"explanation":"...","slide":1,"topic":"..."}]}

课件内容：
${content}`;
  const base = (cfg.base_url || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {"Content-Type": "application/json", Authorization: `Bearer ${cfg.api_key}`},
    body: JSON.stringify({model: cfg.model || "deepseek-chat", temperature: 0.7, messages: [{role: "user", content: prompt}]}),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const raw = (await r.json()).choices[0].message.content;
  const m = raw.match(/\{[\s\S]*\}/);
  const data = JSON.parse(m ? m[0] : raw);
  const out = [];
  for (const q of data.questions || []) {
    if (!types.includes(q.type) || !q.question) continue;
    const item = {id: qid(), type: q.type, question: q.question, explanation: q.explanation || "", slide: q.slide, topic: q.topic || ""};
    if (q.type === "choice") {
      const opts = (q.options || []).map(o => String(o).replace(/^[A-D][.、．:：]\s*/, ""));
      let ans = q.answer;
      if (typeof ans === "string") ans = "ABCD".includes(ans.trim()[0]?.toUpperCase()) ? "ABCD".indexOf(ans.trim()[0].toUpperCase()) : opts.indexOf(ans);
      if (opts.length < 2 || !Number.isInteger(ans) || ans < 0 || ans >= opts.length) continue;
      Object.assign(item, {options: opts, answer: ans});
    } else if (q.type === "judge") {
      item.answer = typeof q.answer === "string" ? ["true", "对", "正确", "√", "t", "yes"].includes(q.answer.trim().toLowerCase()) : !!q.answer;
    } else item.answer = String(q.answer ?? "").trim();
    out.push(item);
  }
  return out.slice(0, count);
}
