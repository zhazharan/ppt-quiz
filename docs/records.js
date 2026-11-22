const LIB_KEY = "pq_library", HIST_KEY = "pq_history";
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const fmtDate = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function saveDoc(d, file) {
  d.id = `${file.name}|${file.size}`;
  const lib = load(LIB_KEY, []).filter(x => x.id !== d.id);
  lib.unshift({id: d.id, name: d.name, pages: d.slides.length, points: d.points.length, at: Date.now()});
  try {
    localStorage.setItem("pq_doc_" + d.id, JSON.stringify({name: d.name, slides: d.slides, points: d.points}));
    localStorage.setItem(LIB_KEY, JSON.stringify(lib));
    return true;
  } catch {
    localStorage.removeItem("pq_doc_" + d.id);
    return false;
  }
}

function openDoc(id) {
  const d = load("pq_doc_" + id, null);
  if (!d) return alert("这份课件的数据已丢失，请重新上传");
  doc = {...d, id};
  const defs = doc.points.filter(p => p.term).length;
  $("#upload-status").className = "status ok";
  $("#upload-status").innerHTML = `<b>已从课件库打开</b><span class="stat">${doc.slides.length} 页</span><span class="stat">${doc.points.length} 条知识点</span><span class="stat">${defs} 个概念定义</span>`;
  renderPoints(); show("#step-points");
}

function deleteDoc(id) {
  const item = load(LIB_KEY, []).find(x => x.id === id);
  if (!item || !confirm(`从课件库删除「${item.name}」？（学习记录会保留）`)) return;
  localStorage.removeItem("pq_doc_" + id);
  localStorage.setItem(LIB_KEY, JSON.stringify(load(LIB_KEY, []).filter(x => x.id !== id)));
  renderLibrary();
}

function renderLibrary() {
  const lib = load(LIB_KEY, []), hist = load(HIST_KEY, []);
  if (!lib.length) { $("#library").innerHTML = ""; return; }
  $("#library").innerHTML = `<h3>📂 我的课件库 <span class="muted">${lib.length} 份</span></h3><div class="lib-list">` + lib.map(x => {
    const runs = hist.filter(h => h.docId === x.id), last = runs[runs.length - 1];
    return `<div class="lib-item">
      <div class="lib-icon">${/\.pdf$/i.test(x.name) ? "PDF" : "PPT"}</div>
      <div class="lib-info"><div class="lib-name" title="${esc(x.name)}">${esc(x.name)}</div>
        <div class="muted">${x.pages} 页 · ${x.points} 条知识点 · ${runs.length ? `练习 ${runs.length} 次 · 上次 ${Math.round(last.correct / last.total * 100)} 分` : "还没练习过"}</div></div>
      <button class="primary sm" data-open="${esc(x.id)}">练习</button><button class="sm ghost" data-del="${esc(x.id)}" title="删除">删除</button>
    </div>`;
  }).join("") + "</div>";
  $("#library").querySelectorAll("[data-open]").forEach(b => b.onclick = () => openDoc(b.dataset.open));
  $("#library").querySelectorAll("[data-del]").forEach(b => b.onclick = () => deleteDoc(b.dataset.del));
}

function recordAttempt(qs, ans, retry, d) {
  const hist = load(HIST_KEY, []);
  hist.push({docId: d.id, docName: d.name, at: Date.now(), retry, total: qs.length,
    correct: ans.filter(a => a.ok).length, items: qs.map((q, i) => ({t: q.topic || "未分类", ok: ans[i].ok}))});
  try { localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(-300))); } catch {}
  renderLibrary();
}

function renderStats() {
  const all = load(HIST_KEY, []);
  const docs = [...new Map(all.map(h => [h.docId, h.docName])).entries()];
  const sel = $("#stats-doc"), cur = sel.value;
  sel.innerHTML = `<option value="">全部课件</option>` + docs.map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join("");
  sel.value = docs.some(([id]) => id === cur) ? cur : "";
  const hist = sel.value ? all.filter(h => h.docId === sel.value) : all;
  $("#stats-empty").classList.toggle("hidden", !!hist.length);
  $("#stats-body").classList.toggle("hidden", !hist.length);
  $("#stats-body2").classList.toggle("hidden", !hist.length);
  if (!hist.length) return;

  const qTotal = hist.reduce((s, h) => s + h.total, 0), qRight = hist.reduce((s, h) => s + h.correct, 0);
  const pcts = hist.map(h => Math.round(h.correct / h.total * 100));
  const days = new Set(hist.map(h => new Date(h.at).toDateString())).size;
  $("#stats-tiles").innerHTML = [
    ["测验次数", hist.length, "次"], ["累计答题", qTotal, "题"],
    ["平均正确率", Math.round(qRight / qTotal * 100), "%"], ["最高分", Math.max(...pcts), "分"], ["学习天数", days, "天"],
  ].map(([k, v, u]) => `<div class="tile"><div class="tile-v">${v}<small>${u}</small></div><div class="muted">${k}</div></div>`).join("");

  $("#stats-chart").innerHTML = lineChart(hist.slice(-20));

  const topics = {};
  for (const h of hist) for (const it of h.items) {
    const k = (sel.value ? "" : h.docName + "\u0000") + it.t;
    (topics[k] ||= {name: it.t, doc: h.docName, n: 0, ok: 0}); topics[k].n++; topics[k].ok += it.ok;
  }
  const weak = Object.values(topics).filter(t => t.ok < t.n).map(t => ({...t, p: t.ok / t.n}))
    .sort((a, b) => a.p - b.p || b.n - a.n).slice(0, 8);
  $("#stats-weak").innerHTML = weak.length ? weak.map(t => {
    const p = Math.round(t.p * 100), c = p < 40 ? "bad" : p < 70 ? "mid" : "good";
    return `<div class="weak-row"><div class="weak-name"><b>${esc(t.name)}</b>${sel.value ? "" : `<span class="muted">${esc(t.doc)}</span>`}</div>
      <div class="weak-bar"><div class="${c}" style="width:${Math.max(p, 3)}%"></div></div><div class="weak-p">${p}%<span class="muted"> ${t.ok}/${t.n}</span></div></div>`;
  }).join("") : `<p class="muted">目前没有答错的知识点，继续保持！</p>`;

  $("#stats-history").innerHTML = hist.slice().reverse().slice(0, 30).map(h => {
    const p = Math.round(h.correct / h.total * 100);
    return `<div class="hist-row"><span class="hist-score ${p >= 80 ? "good" : p >= 60 ? "mid" : "bad"}">${p}</span>
      <div class="hist-info"><div class="lib-name">${esc(h.docName)}${h.retry ? ` <span class="tag">重做错题</span>` : ""}</div><div class="muted">${fmtDate(h.at)} · 答对 ${h.correct}/${h.total}</div></div></div>`;
  }).join("");
}

function lineChart(hist) {
  const W = 640, H = 220, L = 36, R = 16, T = 16, B = 30, n = hist.length;
  const x = i => n === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (n - 1);
  const y = p => T + (100 - p) * (H - T - B) / 100;
  const pts = hist.map((h, i) => [x(i), y(h.correct / h.total * 100), Math.round(h.correct / h.total * 100), h]);
  const grid = [0, 25, 50, 75, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid-l"/><text x="${L - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`).join("");
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const area = n > 1 ? `<path d="${path}L${pts[n - 1][0]},${y(0)}L${pts[0][0]},${y(0)}Z" fill="url(#ga)"/>` : "";
  const step = Math.ceil(n / 8);
  const labels = pts.map((p, i) => i % step && i !== n - 1 ? "" : `<text x="${p[0]}" y="${H - 8}" class="axis" text-anchor="middle">${fmtDate(p[3].at).split(" ")[0]}</text>`).join("");
  const dots = pts.map(p => `<g><circle cx="${p[0]}" cy="${p[1]}" r="5" class="dot"/><text x="${p[0]}" y="${p[1] - 11}" class="dot-l" text-anchor="middle">${p[2]}</text><title>${esc(p[3].docName)}  ${fmtDate(p[3].at)}  ${p[2]}分</title></g>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart"><defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b5bf0" stop-opacity=".28"/><stop offset="1" stop-color="#5b5bf0" stop-opacity="0"/></linearGradient></defs>
    ${grid}${area}<path d="${path}" class="line"/>${dots}${labels}</svg>`;
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  $("#view-study").classList.toggle("hidden", tab !== "study");
  $("#view-stats").classList.toggle("hidden", tab !== "stats");
  if (tab === "stats") renderStats();
}

document.querySelectorAll(".tab").forEach(t => t.onclick = () => switchTab(t.dataset.tab));
$("#stats-doc").onchange = renderStats;
$("#stats-clear").onclick = () => { if (confirm("确定清空所有学习记录？此操作不可恢复。")) { localStorage.removeItem(HIST_KEY); renderStats(); renderLibrary(); } };
$("#stats-go").onclick = () => switchTab("study");
renderLibrary();
