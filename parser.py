import io
import re

from pptx import Presentation
from pptx.util import Emu


def _clean(text):
    text = re.sub(r"\s+", " ", text or "").strip()
    return text.strip("•·●○■□◆◇▪►-–—*· ")


def _shape_texts(shape):
    out = []
    if shape.shape_type == 6 and hasattr(shape, "shapes"):  # group
        for s in shape.shapes:
            out.extend(_shape_texts(s))
        return out
    if getattr(shape, "has_text_frame", False) and shape.has_text_frame:
        for p in shape.text_frame.paragraphs:
            t = _clean(p.text)
            if t:
                out.append(t)
    if getattr(shape, "has_table", False) and shape.has_table:
        for row in shape.table.rows:
            cells = [_clean(c.text) for c in row.cells]
            cells = [c for c in cells if c]
            if cells:
                out.append(" | ".join(cells))
    return out


def parse_pptx(data):
    prs = Presentation(io.BytesIO(data))
    slides = []
    for i, slide in enumerate(prs.slides, 1):
        title = ""
        if slide.shapes.title is not None and slide.shapes.title.has_text_frame:
            title = _clean(slide.shapes.title.text_frame.text)
        lines = []
        shapes = sorted(slide.shapes, key=lambda s: ((s.top or Emu(0)), (s.left or Emu(0))))
        for shape in shapes:
            if slide.shapes.title is not None and shape.shape_id == slide.shapes.title.shape_id:
                continue
            lines.extend(_shape_texts(shape))
        notes = ""
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
            notes = _clean(slide.notes_slide.notes_text_frame.text)
        slides.append(_finish(i, title, lines, notes))
    return slides


def parse_pdf(data):
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    slides = []
    for i, page in enumerate(reader.pages, 1):
        raw = page.extract_text() or ""
        lines = [_clean(l) for l in raw.splitlines()]
        lines = [l for l in lines if l]
        title = lines.pop(0) if lines else ""
        slides.append(_finish(i, title, lines, ""))
    return slides


def _finish(index, title, lines, notes):
    seen, points = set(), []
    for l in lines:
        if l in seen or re.fullmatch(r"[\d\s./-]+", l):
            continue
        seen.add(l)
        points.append(l)
    if not title and points:
        title = points.pop(0)
    return {"index": index, "title": title[:80], "points": points, "notes": notes}


def parse_file(filename, data):
    name = filename.lower()
    if name.endswith(".pptx"):
        return parse_pptx(data)
    if name.endswith(".pdf"):
        return parse_pdf(data)
    raise ValueError("仅支持 .pptx 或 .pdf 文件（旧版 .ppt 请先另存为 .pptx）")
