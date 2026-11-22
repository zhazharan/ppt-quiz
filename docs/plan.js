const PLAN_KEY = "pq_plan", SRS_KEY = "pq_srs", DAILY_KEY = "pq_daily", COVER_KEY = "pq_covered";
const INTERVALS = [1, 2, 4, 7, 15, 30];
const SESSION_MAX = 20, SEP = "\u0001";
const pad2 = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + "T00:00"); d.setDate(d.getDate() + n); return ymd(d); };
const dayDiff = (a, b) => Math.round((new Date(b + "T00:00") - new Date(a + "T00:00")) / 864e5);
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const getGoal = () => load(PLAN_KEY, {}).goal || 20;
let calMonth = null;

function trackAnswer(q, ok) {
  const daily = load(DAILY_KEY, {}), t = today();
  daily[t] = (daily[t] || 0) + 1; save(DAILY_KEY, daily);
  if (!q.src || !q.docId) return;
  const key = q.docId + SEP + q.src;
  const cov = load(COVER_KEY, {}); cov[key] = 1; save(COVER_KEY, cov);
  const srs = load(SRS_KEY, {}), it = srs[key];
  if (!ok) srs[key] = {docId: q.docId, src: q.src, box: 0, due: addDays(t, 1), lapses: (it?.lapses || 0) + 1};
  else if (it && it.due <= t) {
    it.box++;
    if (it.box >= INTERVALS.length) delete srs[key]; else it.due = addDays(t, INTERVALS[it.box]);
  }
  save(SRS_KEY, srs);
}

function planPoints(plan) {
  const out = [];
  for (const id of plan.docIds || []) {
    const d = load("pq_doc_" + id, null);
    if (d) solidOnly(d.points).forEach(p => out.push({...p, docId: id, key: id + SEP + p.text}));
  }
  return out;
}

function todayChunk(plan, pts) {
  const t = today(), cov = load(COVER_KEY, {});
  if (plan.chunkDate !== t) {
    const left = pts.filter(p => !cov[p.key]);
    const days = Math.max(1, dayDiff(t, plan.examDate));
    plan.chunk = left.slice(0, Math.ceil(left.length / days)).map(p => p.key);
    plan.chunkDate = t; save(PLAN_KEY, plan);
  }
  return plan.chunk;
}

function buildQuiz(items) {
  const types = [...document.querySelectorAll("input[name=type]:checked")].map(i => i.value);
  const use = types.length ? types : ["choice", "judge"], qs = [], docs = {};
  for (const {docId, text} of items) {
    const d = docs[docId] ??= load("pq_doc_" + docId, null);
    const kp = d && d.points.find(p => p.text === text);
    if (!kp) continue;
    const q = ruleBased([kp], use, 1, d.points)[0] || ruleBased([kp], ["judge"], 1, d.points)[0];
    if (q) { q.docId = docId; qs.push(q); }
  }
  return qs;
}

function startPlanQuiz(kind) {
  const plan = load(PLAN_KEY, {});
  let items;
  if (kind === "new") {
    const cov = load(COVER_KEY, {});
    items = todayChunk(plan, planPoints(plan)).filter(k => !cov[k]);
  } else {
    const t = today();
    items = Object.entries(load(SRS_KEY, {})).filter(([, v]) => v.due <= t).map(([k]) => k);
  }
  const qs = buildQuiz(shuffle(items).slice(0, SESSION_MAX).map(k => { const i = k.indexOf(SEP); return {docId: k.slice(0, i), text: k.slice(i + 1)}; }));
  if (!qs.length) return alert("没有可以出题的内容");
  switchTab("study");
  startQuiz(qs, false, {id: "__" + kind, name: kind === "new" ? "今日任务 · 新知识点" : "今日复习"});
}

function renderPlan() {
  const plan = load(PLAN_KEY, {}), t = today(), goal = getGoal();
  const daily = load(DAILY_KEY, {}), done = daily[t] || 0;
  $("#today-date").textContent = `${t.slice(5).replace("-", "月")}日`;

  const hasPlan = plan.examDate && plan.docIds?.length;
  const left = hasPlan ? dayDiff(t, plan.examDate) : null;
  $("#cd-days").textContent = hasPlan ? Math.max(left, 0) : "--";
  $("#cd-date").textContent = hasPlan ? (left > 0 ? `考试日 ${plan.examDate}` : left === 0 ? "今天考试，加油！" : "考试日期已过") : "还没设置考试日期";
  const gp = Math.min(100, Math.round(done / goal * 100));
  $("#goal-ring").style.setProperty("--p", gp);
  $("#goal-ring").innerHTML = `<span>${done}<small>/${goal}</small></span>`;
  $("#goal-text").textContent = done >= goal ? "今日目标已完成 ✓" : `今日答题（还差 ${goal - done} 题）`;
  let streak = 0;
  for (let d = (daily[t] || 0) >= goal ? t : addDays(t, -1); (daily[d] || 0) >= goal; d = addDays(d, -1)) streak++;
  $("#streak").textContent = streak;

  const tasks = [];
  if (!hasPlan) tasks.push(task("📘", "制定复习计划", "设置考试日期和要复习的课件，系统会把知识点平均分配到每一天", null, `<button class="primary sm" onclick="document.getElementById('plan-settings').scrollIntoView({behavior:'smooth'})">去设置</button>`));
  else {
    const pts = planPoints(plan), cov = load(COVER_KEY, {});
    const chunk = left >= 0 ? todayChunk(plan, pts) : [];
    const cdone = chunk.filter(k => cov[k]).length, total = pts.length, learned = pts.filter(p => cov[p.key]).length;
    const finished = chunk.length && cdone >= chunk.length;
    tasks.push(task("📘", "学习新知识点",
      left < 0 ? "考试日期已过，请在下方更新计划" : !chunk.length ? "全部知识点都已学完，接下来以复习为主 🎉" : `今天 ${chunk.length} 个知识点 · 已完成 ${cdone}/${chunk.length}`,
      [learned, total, `整体进度 ${learned}/${total}`],
      chunk.length && !finished ? `<button class="primary sm" data-start="new">${cdone ? "继续学习" : "开始学习"}</button>` : chunk.length ? `<span class="done-badge">✓ 已完成</span>` : ""));
  }
  const due = Object.values(load(SRS_KEY, {})).filter(v => v.due <= t).length;
  tasks.push(task("🔁", "智能复习", due ? `${due} 个答错或薄弱的知识点今天到期，按遗忘曲线复习` : "今天没有到期的复习内容。答错的题会在 1、2、4、7、15、30 天后自动安排复习",
    null, due ? `<button class="primary sm" data-start="review">开始复习</button>` : `<span class="done-badge">✓</span>`));
  tasks.push(task("🎯", "每日答题目标", `今天已答 ${done} 题，目标 ${goal} 题`, [Math.min(done, goal), goal, ""],
    done >= goal ? `<span class="done-badge">✓ 已打卡</span>` : `<button class="sm" onclick="switchTab('study')">去刷题</button>`));
  $("#tasks").innerHTML = tasks.join("");
  $("#tasks").querySelectorAll("[data-start]").forEach(b => b.onclick = () => startPlanQuiz(b.dataset.start));

  renderCalendar(plan, daily, goal);

  const lib = load(LIB_KEY, []);
  $("#plan-date").min = t;
  $("#plan-date").value = plan.examDate || "";
  $("#plan-goal").value = goal;
  $("#plan-docs").innerHTML = lib.length ? lib.map(x => `<label class="chip"><input type="checkbox" value="${esc(x.id)}" ${plan.docIds?.includes(x.id) ? "checked" : ""}><span>${esc(x.name)}</span></label>`).join("")
    : `<span class="muted">课件库是空的，请先在「刷题」页上传课件</span>`;
}

function task(icon, title, desc, prog, action) {
  const bar = prog ? `<div class="task-bar"><div style="width:${prog[1] ? prog[0] / prog[1] * 100 : 0}%"></div></div>${prog[2] ? `<div class="muted task-prog">${prog[2]}</div>` : ""}` : "";
  return `<div class="task"><div class="task-icon">${icon}</div><div class="task-main"><b>${title}</b><div class="muted">${desc}</div>${bar}</div><div class="task-act">${action || ""}</div></div>`;
}

function renderCalendar(plan, daily, goal) {
  const t = today();
  calMonth ??= t.slice(0, 7);
  const [y, m] = calMonth.split("-").map(Number);
  $("#cal-title").textContent = `${y} 年 ${m} 月`;
  const first = new Date(y, m - 1, 1), offset = (first.getDay() + 6) % 7, days = new Date(y, m, 0).getDate();
  let html = "<span></span>".repeat(offset);
  for (let d = 1; d <= days; d++) {
    const key = `${calMonth}-${pad2(d)}`, n = daily[key] || 0;
    const cls = [n >= goal ? "lv2" : n ? "lv1" : "lv0", key === t ? "today" : "", key === plan.examDate ? "exam" : ""].join(" ");
    html += `<span class="${cls}" title="${key}：答题 ${n} 题">${d}${n ? `<small>${n}</small>` : ""}</span>`;
  }
  $("#calendar").innerHTML = html;
}

const shiftMonth = n => { const [y, m] = calMonth.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); calMonth = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; renderPlan(); };
$("#cal-prev").onclick = () => shiftMonth(-1);
$("#cal-next").onclick = () => shiftMonth(1);
$("#plan-save").onclick = () => {
  const examDate = $("#plan-date").value, goal = Math.max(1, +$("#plan-goal").value || 20);
  const docIds = [...document.querySelectorAll("#plan-docs input:checked")].map(i => i.value);
  const old = load(PLAN_KEY, {});
  if (!examDate && docIds.length) return ($("#plan-msg").textContent = "请选择考试日期");
  if (examDate && !docIds.length) return ($("#plan-msg").textContent = "请至少选择一份课件");
  if (examDate && examDate < today()) return ($("#plan-msg").textContent = "考试日期不能早于今天");
  save(PLAN_KEY, {examDate, docIds, goal, chunkDate: old.examDate === examDate && String(old.docIds) === String(docIds) ? old.chunkDate : null, chunk: old.chunk});
  $("#plan-msg").textContent = "✓ 已保存";
  renderPlan();
  setTimeout(() => ($("#plan-msg").textContent = ""), 2000);
};
$("#plan-clear").onclick = () => {
  if (!confirm("删除学习计划？（打卡和复习记录会保留）")) return;
  save(PLAN_KEY, {goal: getGoal()}); renderPlan();
};
$("#to-plan").onclick = () => switchTab("plan");
