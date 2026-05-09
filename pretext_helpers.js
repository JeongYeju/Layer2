// pretext_helpers.js
// Pretext is the project's source of layout truth.
// We cache layout per paragraph so signals can carry precise LayoutCursors
// (segmentIndex, graphemeIndex) without doing reflow work on every event.
//
// Note on getBoundingClientRect:
//   Pretext can describe layout but cannot know where on screen a paragraph
//   element lives — only the browser does. So when we need *screen pixel
//   coordinates* of an already-rendered grapheme span (e.g. to position the
//   ink overlay), we read it from the rendered DOM. Pretext is still the
//   authority for line breaks, widths, and cursors that ride on signals.

import {
  prepareWithSegments,
  layoutWithLines,
} from "https://esm.sh/@chenglou/pretext";

export const BODY_FONT = '18px "Noto Serif KR", serif';
export const LINE_HEIGHT = 32; // px — must match .para line-height in styles.css

// paragraphId -> { prepared, lines, text, width }
const layoutCache = new Map();
window.__paragraphPretext = layoutCache;

export function preparePara(paragraphId, text, widthPx) {
  const prepared = prepareWithSegments(text, BODY_FONT);
  let lines = [];
  try {
    const out = layoutWithLines(prepared, widthPx, LINE_HEIGHT);
    lines = out.lines || [];
  } catch (err) {
    // If pretext layout fails for any reason, we still cache the prepared
    // handle and fall back to single-line treatment.
    console.warn("[pretext] layoutWithLines failed for", paragraphId, err);
  }
  layoutCache.set(paragraphId, { prepared, lines, text, width: widthPx });
  return layoutCache.get(paragraphId);
}

export function getLayout(paragraphId) {
  return layoutCache.get(paragraphId);
}

// Linear grapheme index inside the paragraph -> LayoutCursor.
// We rely on line.start / line.end cursors from layoutWithLines and
// approximate within-line offsets by counting characters. For Korean
// + ASCII this matches grapheme units exactly.
export function charIndexToCursor(paragraphId, charIndex) {
  const layout = layoutCache.get(paragraphId);
  if (!layout || !layout.lines.length) return null;
  let acc = 0;
  for (const line of layout.lines) {
    const len = line.text ? line.text.length : 0;
    if (charIndex <= acc + len) {
      const offset = charIndex - acc;
      return {
        segmentIndex: line.start.segmentIndex,
        graphemeIndex: (line.start.graphemeIndex || 0) + offset,
      };
    }
    acc += len;
  }
  const last = layout.lines[layout.lines.length - 1];
  return {
    segmentIndex: last.end.segmentIndex,
    graphemeIndex: last.end.graphemeIndex,
  };
}

// Mouse coords -> { paragraphId, charIndex, cursor }.
// Hit-testing uses the rendered grapheme spans (data-char-index); pretext
// turns the resulting char index into a structured LayoutCursor for signals.
export function getCursorFromPoint(clientX, clientY) {
  const stack = document.elementsFromPoint(clientX, clientY);
  const span = stack.find((el) => el.matches && el.matches("[data-char-index]"));
  if (!span) return null;
  const para = span.closest("[data-paragraph-id]");
  if (!para) return null;
  const paragraphId = para.dataset.paragraphId;
  const charIndex = Number(span.dataset.charIndex);
  return {
    paragraphId,
    charIndex,
    cursor: charIndexToCursor(paragraphId, charIndex),
  };
}

const wordSeg = new Intl.Segmenter("ko", { granularity: "word" });

// Find the word that contains `charIndex` (or the most recent word before it).
export function getWordRangeAt(paragraphId, charIndex) {
  const layout = layoutCache.get(paragraphId);
  if (!layout) return null;
  const segs = Array.from(wordSeg.segment(layout.text));

  let containing = null;
  let lastWordBefore = null;
  for (const s of segs) {
    const start = s.index;
    const end = s.index + s.segment.length;
    if (s.isWordLike && end <= charIndex + 1) lastWordBefore = s;
    if (charIndex >= start && charIndex < end) {
      containing = s;
      break;
    }
  }
  const pick =
    (containing && containing.isWordLike && containing) ||
    lastWordBefore ||
    segs.find((s) => s.isWordLike);
  if (!pick) return null;

  const startChar = pick.index;
  const endChar = pick.index + pick.segment.length;
  return {
    paragraphId,
    text: pick.segment,
    startChar,
    endChar,
    startCursor: charIndexToCursor(paragraphId, startChar),
    endCursor: charIndexToCursor(paragraphId, endChar),
  };
}

// Screen rects for a [startChar, endChar) range — needed only for visual overlays.
export function getCharRangeRects(paragraphId, startChar, endChar) {
  const para = document.querySelector(`[data-paragraph-id="${paragraphId}"]`);
  if (!para) return [];
  const rects = [];
  for (let i = startChar; i < endChar; i++) {
    const span = para.querySelector(`[data-char-index="${i}"]`);
    if (span) rects.push(span.getBoundingClientRect());
  }
  return rects;
}

// Union bbox of a char range, in viewport coords.
export function getCharRangeBBox(paragraphId, startChar, endChar) {
  const rects = getCharRangeRects(paragraphId, startChar, endChar);
  if (!rects.length) return null;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const k of rects) {
    if (k.left < l) l = k.left;
    if (k.top < t) t = k.top;
    if (k.right > r) r = k.right;
    if (k.bottom > b) b = k.bottom;
  }
  return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
}

// TODO(resize): re-run preparePara on container resize / font-loaded events.
