// Parse .pptx / .pdf in the browser so large files never need to be uploaded.
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";

function paraTexts(el) {
  return [...el.getElementsByTagNameNS(A, "p")].map(p =>
    [...p.getElementsByTagNameNS(A, "t")].map(t => t.textContent).join("").trim()).filter(Boolean);
}

function shapeY(sp) {
  const off = sp.getElementsByTagNameNS(A, "off")[0];
  return off ? +off.getAttribute("y") || 0 : 0;
}

async function parsePptx(file) {
  const zip = await JSZip.loadAsync(file);
  const xml = async path => zip.file(path) ? new DOMParser().parseFromString(await zip.file(path).async("string"), "application/xml") : null;
  const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  const slides = [];
  for (const [i, name] of names.entries()) {
    const doc = await xml(name);
    let title = "";
    const lines = [];
    const tree = doc.getElementsByTagNameNS(P, "spTree")[0];
    const shapes = tree ? [...tree.children].sort((a, b) => shapeY(a) - shapeY(b)) : [];
    for (const sp of shapes) {
      const ph = sp.getElementsByTagNameNS(P, "ph")[0];
      const type = ph && ph.getAttribute("type");
      if (["sldNum", "dt", "ftr"].includes(type)) continue;
      if (!title && (type === "title" || type === "ctrTitle")) { title = paraTexts(sp).join(" "); continue; }
      for (const tbl of sp.getElementsByTagNameNS(A, "tbl")) {
        for (const tr of tbl.getElementsByTagNameNS(A, "tr")) {
          const cells = [...tr.getElementsByTagNameNS(A, "tc")].map(tc => paraTexts(tc).join(" ")).filter(Boolean);
          if (cells.length) lines.push(cells.join(" | "));
        }
      }
      if (!sp.getElementsByTagNameNS(A, "tbl").length) lines.push(...paraTexts(sp));
    }
    let notes = "";
    const rels = await xml(name.replace("slides/", "slides/_rels/") + ".rels");
    const rel = rels && [...rels.getElementsByTagName("Relationship")].find(r => /notesSlide/.test(r.getAttribute("Type")));
    if (rel) {
      const nd = await xml("ppt/notesSlides/" + rel.getAttribute("Target").split("/").pop());
      if (nd) notes = [...nd.getElementsByTagNameNS(P, "sp")].filter(sp => {
        const ph = sp.getElementsByTagNameNS(P, "ph")[0];
        return ph && ph.getAttribute("type") === "body";
      }).map(sp => paraTexts(sp).join(" ")).join(" ");
    }
    slides.push({index: i + 1, title, lines, notes});
  }
  return slides;
}

async function parsePdf(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({data: await file.arrayBuffer()}).promise;
  const slides = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const rows = [];
    for (const it of content.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      const row = rows.find(r => Math.abs(r.y - y) < 3);
      if (row) row.t += it.str; else rows.push({y, t: it.str});
    }
    const lines = rows.sort((a, b) => b.y - a.y).map(r => r.t.trim()).filter(Boolean);
    slides.push({index: n, title: lines.shift() || "", lines, notes: ""});
  }
  return slides;
}

async function extractSlides(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pptx")) return parsePptx(file);
  if (name.endsWith(".pdf")) return parsePdf(file);
  throw new Error("仅支持 .pptx 或 .pdf 文件（旧版 .ppt 请先另存为 .pptx）");
}
