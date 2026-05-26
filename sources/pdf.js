// sources/pdf.js
// Extract text from a PDF file and present it as paragraph blocks. We use
// PDF.js text-layer extraction (not full visual rendering) — for signal
// collection what we actually need is the flowing text, not the original
// layout. Each PDF page contributes one heading block ("Page N") and the
// extracted text broken into paragraphs by blank lines / wide y-gaps.
//
// CDN ESM import.

import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4/build/pdf.mjs";

// pdf.js needs a worker URL. Use the matching ESM worker from the CDN.
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://esm.sh/pdfjs-dist@4/build/pdf.worker.mjs";

export async function pdfSourceFromFile(file) {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const blocks = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const tc = await page.getTextContent();
    // Group items into lines by Y, then paragraphs by Y-gap.
    const paragraphs = itemsToParagraphs(tc.items);
    if (paragraphs.length === 0) continue;
    if (doc.numPages > 1) {
      blocks.push({ type: "heading", level: 3, text: `Page ${pageNum}` });
    }
    for (const p of paragraphs) {
      blocks.push({ type: "paragraph", text: p });
    }
  }

  return {
    id: `src-pdf-${shortId()}`,
    kind: "pdf",
    title: stripExt(file.name),
    blocks,
    meta: {
      fileName: file.name,
      pageCount: doc.numPages,
      loadedAt: Date.now(),
    },
  };
}

// PDF.js gives us a stream of positioned text items. We sort by reading
// order (top-to-bottom, then left-to-right), group adjacent items into
// lines, and then break lines into paragraphs where the vertical gap
// jumps beyond a normal line-height.
function itemsToParagraphs(items) {
  if (!items || items.length === 0) return [];
  // transform: [a, b, c, d, e, f] — e and f are translate.
  const placed = items
    .filter((it) => it.str && it.str.trim().length > 0)
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      h: it.height || 0,
    }));
  if (placed.length === 0) return [];

  // Higher y is higher on the page in PDF coords. Sort descending y, then x.
  placed.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));

  // Group into lines by y proximity.
  const lines = [];
  let cur = [placed[0]];
  for (let i = 1; i < placed.length; i++) {
    const it = placed[i];
    const prev = cur[cur.length - 1];
    if (Math.abs(it.y - prev.y) <= 2) {
      cur.push(it);
    } else {
      lines.push(cur);
      cur = [it];
    }
  }
  lines.push(cur);

  const lineTexts = lines.map((l) =>
    l
      .map((it) => it.str)
      .join("")
      .trim(),
  );

  // Estimate the median line gap so we can split paragraphs on bigger ones.
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    gaps.push(Math.abs(lines[i - 1][0].y - lines[i][0].y));
  }
  const medGap = gaps.length ? median(gaps) : 12;
  const paraGapThreshold = medGap * 1.6;

  const paragraphs = [];
  let acc = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lineTexts[i];
    if (!text) continue;
    acc.push(text);
    const next = lines[i + 1];
    if (next) {
      const gap = Math.abs(lines[i][0].y - next[0].y);
      if (gap > paraGapThreshold) {
        paragraphs.push(joinLines(acc));
        acc = [];
      }
    }
  }
  if (acc.length) paragraphs.push(joinLines(acc));
  return paragraphs.filter((p) => p.length > 0);
}

function joinLines(lines) {
  // Many PDFs add hard line breaks mid-sentence. Joining with a single
  // space gives the most readable flowing text.
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stripExt(name) {
  return name.replace(/\.pdf$/i, "");
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}
