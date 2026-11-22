const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const TYPE = {choice: "选择题", judge: "判断题", fill: "填空题"};
let doc = null, questions = [], cur = 0, answers = [], selected = null;

["base_url", "model", "api_key"].forEach(k => {
  $("#" + k).value = localStorage.getItem("llm_" + k) || "";
  $("#" + k).addEventListener("change", e => localStorage.setItem("llm_" + k, e.target.value.trim()));
});
if (localStorage.getItem("llm_api_key")) $("#ai-box").open = true;

const drop = $("#drop");
["dragover", "dragenter"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(e => drop.addEventListener(e, () => drop.classList.remove("over")));
drop.addEventListener("drop", ev => { ev.preventDefault(); if (ev.dataTransfer.files[0]) upload(ev.dataTransfer.files[0]); });
$("#file").addEventListener("change", e => e.target.files[0] && upload(e.target.files[0]));

async function upload(file) {
  $("#upload-status").className = "status loading";
  $("#upload-status").textContent = `正在解析 ${file.name} ...`;
  try {
    const raw = await extractSlides(file);
    const slides = raw.map(finishSlide);
    const points = extractKnowledge(slides);
    if (!points.length) throw new Error("未能从文件中识别到文字内容（图片型课件暂不支持）");
    const d = {name: file.name, slides, points};
    const saved = saveDoc(d, file);
    doc = d; renderLibrary();
    const defs = d.points.filter(p => p.term).length;
    $("#upload-status").className = "status ok";
    $("#upload-status").innerHTML = `<b>解析完成</b><span class="stat">${d.slides.length} 页</span><span class="stat">${d.points.length} 条知识点</span><span class="stat">${defs} 个概念定义</span>${saved ? `<span class="stat">已存入课件库</span>` : `<span class="stat">课件太大，未能存入课件库</span>`}`;
    renderPoints(); show("#step-points");
  } catch (e) { $("#upload-status").className = "status err"; $("#upload-status").textContent = e.message; }
}

function renderPoints() {
  $("#doc-name").textContent = doc.name;
  const bySlide = {};
  doc.points.forEach(p => (bySlide[p.slide] ||= []).push(p));
  $("#points").innerHTML = doc.slides.filter(s => bySlide[s.index]).map(s => `
    <div class="slide"><div class="slide-title"><span class="pno">P${s.index}</span>${esc(s.title)}</div>
    <ul>${bySlide[s.index].map(p => `<li>${p.term ? `<span class="def">${esc(p.term)}</span>：${esc(p.definition)}` : esc(p.text)}</li>`).join("")}</ul></div>`).join("");
}

function show(id) {
  ["#step-quiz", "#step-result"].forEach(s => $(s).classList.add("hidden"));
  $(id).classList.remove("hidden");
  $(id).scrollIntoView({behavior: "smooth"});
}

$("#gen").onclick = generate;
$("#again").onclick = generate;
$("#back").onclick = () => show("#step-points");
$("#retry-wrong").onclick = () => {
  const wrong = questions.filter((q, i) => !answers[i].ok);
  if (wrong.length) startQuiz(wrong, true);
};

async function generate() {
  const types = [...document.querySelectorAll("input[name=type]:checked")].map(i => i.value);
  if (!types.length) return alert("请至少选择一种题型");
  const llm = {base_url: $("#base_url").value.trim(), model: $("#model").value.trim(), api_key: $("#api_key").value.trim()};
  $("#gen").disabled = $("#again").disabled = true;
  $("#gen-status").textContent = llm.api_key ? "AI 正在阅读课件并出题，约需 20-60 秒..." : "正在出题...";
  try {
    let qs = null, warning = null;
    if (llm.api_key) {
      try { qs = await llmBased(doc.slides, types, +$("#count").value || 10, llm); if (!qs.length) { qs = null; warning = "AI 未返回有效题目，已改用本地规则出题"; } }
      catch (e) { warning = `AI 出题失败（${e.message}），已改用本地规则出题`; }
    }
    const mode = qs ? "ai" : "local";
    if (!qs) qs = ruleBased(doc.points, types, +$("#count").value || 10);
    if (!qs.length) throw new Error("课件内容太少，无法生成题目");
    const d = {questions: qs, mode, warning};
    $("#gen-status").textContent = d.warning ? "⚠️ " + d.warning : (d.mode === "ai" ? "✅ AI 出题完成" : `✅ 已生成 ${d.questions.length} 题`);
    startQuiz(d.questions);
  } catch (e) { $("#gen-status").textContent = "❌ " + e.message; }
  $("#gen").disabled = $("#again").disabled = false;
}

let isRetry = false, quizDoc = null;
function startQuiz(qs, retry = false) {
  questions = qs; cur = 0; answers = []; isRetry = retry; quizDoc = doc;
  show("#step-quiz"); renderQ();
}

function renderQ() {
  const q = questions[cur]; selected = null;
  $("#progress").textContent = `第 ${cur + 1} / ${questions.length} 题`;
  $("#score").textContent = `答对 ${answers.filter(a => a.ok).length} 题`;
  $("#bar-fill").style.width = `${cur / questions.length * 100}%`;
  let body = "";
  if (q.type === "choice") body = q.options.map((o, i) => `<div class="opt" data-v="${i}"><b>${"ABCDEF"[i]}</b>${esc(o)}</div>`).join("");
  else if (q.type === "judge") body = `<div class="opt" data-v="true"><b>√</b>正确</div><div class="opt" data-v="false"><b>×</b>错误</div>`;
  else body = `<input class="fill-input" id="fill" placeholder="在此输入答案，回车提交" autocomplete="off">`;
  $("#q-box").innerHTML = `<div><span class="tag">${TYPE[q.type]}</span>${q.topic ? `<span class="tag">${esc(q.topic)}</span>` : ""}${q.slide ? `<span class="muted">课件第 ${q.slide} 页</span>` : ""}</div>
    <div class="question">${esc(q.question)}</div>${body}<div id="fb"></div>`;
  const box = $("#q-box"); box.classList.remove("anim"); void box.offsetWidth; box.classList.add("anim");
  document.querySelectorAll(".opt").forEach(el => el.onclick = () => {
    if (answers[cur]) return;
    document.querySelectorAll(".opt").forEach(o => o.classList.remove("sel"));
    el.classList.add("sel"); selected = el.dataset.v;
  });
  const fill = $("#fill");
  if (fill) { fill.focus(); fill.onkeydown = e => { if (e.key === "Enter") (answers[cur] ? next() : submit()); }; }
  $("#submit").classList.remove("hidden"); $("#next").classList.add("hidden");
}

const norm = s => String(s).toLowerCase().replace(/[\s，。,.、；;：:"“”'‘’（）()]/g, "");

function submit() {
  const q = questions[cur];
  let user = selected, ok;
  if (q.type === "fill") {
    user = $("#fill").value.trim();
    if (!user) return;
    const a = norm(q.answer), u = norm(user);
    ok = u === a || (u.length >= 2 && (a.includes(u) && u.length >= a.length * 0.6 || u.includes(a)));
    $("#fill").disabled = true;
  } else {
    if (user === null) return alert("请先选择一个答案");
    ok = q.type === "choice" ? +user === q.answer : (user === "true") === q.answer;
    document.querySelectorAll(".opt").forEach(o => {
      const v = o.dataset.v;
      const isRight = q.type === "choice" ? +v === q.answer : (v === "true") === q.answer;
      if (isRight) o.classList.add("right"); else if (v === user) o.classList.add("wrong");
    });
  }
  answers[cur] = {ok, user};
  const right = q.type === "choice" ? `${"ABCDEF"[q.answer]}. ${q.options[q.answer]}` : q.type === "judge" ? (q.answer ? "正确" : "错误") : q.answer;
  $("#fb").innerHTML = `<div class="feedback ${ok ? "ok" : "no"}"><b>${ok ? "✅ 回答正确" : "❌ 回答错误"}</b>${ok ? "" : `　正确答案：${esc(right)}`}<br>${esc(q.explanation)}</div>`;
  $("#submit").classList.add("hidden"); $("#next").classList.remove("hidden");
  $("#next").textContent = cur === questions.length - 1 ? "查看结果" : "下一题";
  $("#score").textContent = `答对 ${answers.filter(a => a.ok).length} 题`;
}

function next() {
  if (cur < questions.length - 1) { cur++; renderQ(); } else finish();
}
$("#submit").onclick = submit;
$("#next").onclick = next;

function finish() {
  const n = answers.filter(a => a.ok).length, total = questions.length;
  recordAttempt(questions, answers, isRetry, quizDoc);
  const pct = Math.round(n / total * 100);
  const msg = pct >= 90 ? "太棒了，掌握得很扎实！" : pct >= 70 ? "不错，再巩固一下错题" : pct >= 50 ? "还有提升空间，加油" : "建议回看课件后再练一遍";
  $("#result-summary").innerHTML = `<div class="ring" style="--p:${pct}"><span>${pct}<small>分</small></span></div><div class="result-text"><b>${msg}</b><span>答对 ${n} / ${total} 题</span></div>`;
  const wrong = questions.map((q, i) => [q, answers[i]]).filter(([, a]) => !a.ok);
  $("#wrong-list").innerHTML = wrong.length ? "<h3>错题回顾</h3>" + wrong.map(([q, a]) => {
    const fmt = v => q.type === "choice" ? `${"ABCDEF"[v]}. ${q.options[v]}` : q.type === "judge" ? (String(v) === "true" ? "正确" : "错误") : v;
    return `<div class="wrong-item"><span class="tag">${TYPE[q.type]}</span>${esc(q.question)}<br>你的答案：${esc(fmt(a.user))}　正确答案：${esc(fmt(q.answer))}<br><span class="muted">${esc(q.explanation)}</span></div>`;
  }).join("") : "<p class=\"all-right\">🎉 全部答对！</p>";
  $("#retry-wrong").classList.toggle("hidden", !wrong.length);
  show("#step-result");
}
