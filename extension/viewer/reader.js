// reader.js
// Renders a source's blocks into the page and prepares pretext layout per
// wrappable block. Each grapheme is wrapped in its own span so highlight.js
// can toggle per-character classes without DOM measurement work.
//
// Source shape (the common block model — see sources/):
//   {
//     id, kind, title, byline?, blocks: [
//       { type: "heading", level: 1..6, text },
//       { type: "paragraph", text },
//       { type: "list", ordered: bool, items: [text, ...] },
//       { type: "blockquote", text },
//       { type: "code", text },          // NOT grapheme-wrapped
//       { type: "hr" },
//     ],
//     meta?: { url?, fileName?, loadedAt }
//   }
//
// Every wrappable block becomes its own .para element with a unique
// paragraphId ("p0", "p1", …, "p3_li2" for list items). The signal
// collectors track these via [data-paragraph-id] without caring about
// the underlying block type.

import { preparePara } from "./pretext_helpers.js";

export const PARA_WIDTH = 640;
const graphemeSeg = new Intl.Segmenter("ko", { granularity: "grapheme" });

export function renderReader(rootEl, source) {
  rootEl.innerHTML = "";
  if (!source) return;
  const article = document.createElement("article");
  article.className = "article";

  if (source.title) {
    const h1 = document.createElement("h1");
    h1.textContent = source.title;
    article.appendChild(h1);
  }
  if (source.byline) {
    const byline = document.createElement("div");
    byline.className = "byline";
    byline.textContent = source.byline;
    article.appendChild(byline);
  }

  // Collect (paragraphId, text) pairs so we can run preparePara after fonts
  // are ready — once for everything, not block-by-block.
  const wrappedParas = [];

  source.blocks.forEach((block, idx) => {
    const paragraphId = `p${idx}`;
    const el = blockElement(block, paragraphId, wrappedParas);
    if (el) article.appendChild(el);
  });

  rootEl.appendChild(article);

  const buildPretext = () => {
    for (const { id, text } of wrappedParas) {
      preparePara(id, text, PARA_WIDTH);
    }
  };
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(buildPretext);
  } else {
    buildPretext();
  }

  ensureInkFilter();
}

// Build a DOM element for one block. Wrappable text goes through
// wrapGraphemes; code/hr stay plain. Pushes any wrapped paras onto the
// `out` array for later pretext caching.
function blockElement(block, paragraphId, out) {
  switch (block.type) {
    case "heading": {
      const lvl = Math.min(Math.max(block.level || 2, 1), 6);
      const el = document.createElement(`h${lvl}`);
      el.className = "para para-heading";
      el.dataset.paragraphId = paragraphId;
      wrapGraphemes(el, block.text);
      out.push({ id: paragraphId, text: block.text });
      return el;
    }
    case "paragraph": {
      const el = document.createElement("p");
      el.className = "para";
      el.dataset.paragraphId = paragraphId;
      wrapGraphemes(el, block.text);
      out.push({ id: paragraphId, text: block.text });
      return el;
    }
    case "blockquote": {
      const el = document.createElement("blockquote");
      el.className = "para para-quote";
      el.dataset.paragraphId = paragraphId;
      wrapGraphemes(el, block.text);
      out.push({ id: paragraphId, text: block.text });
      return el;
    }
    case "list": {
      const wrap = document.createElement(block.ordered ? "ol" : "ul");
      wrap.className = "para-list";
      block.items.forEach((itemText, i) => {
        const li = document.createElement("li");
        li.className = "para para-item";
        const itemId = `${paragraphId}_li${i}`;
        li.dataset.paragraphId = itemId;
        wrapGraphemes(li, itemText);
        out.push({ id: itemId, text: itemText });
        wrap.appendChild(li);
      });
      return wrap;
    }
    case "code": {
      // Not grapheme-wrapped (preserve monospace flow, no per-char signals).
      const pre = document.createElement("pre");
      pre.className = "para-code";
      pre.dataset.paragraphId = paragraphId;
      pre.textContent = block.text;
      return pre;
    }
    case "hr":
      return document.createElement("hr");
    default:
      return null;
  }
}

function wrapGraphemes(el, text) {
  let charIdx = 0;
  for (const g of graphemeSeg.segment(text)) {
    const span = document.createElement("span");
    span.className = "g";
    span.dataset.charIndex = String(charIdx);
    span.textContent = g.segment;
    el.appendChild(span);
    charIdx++;
  }
}

function ensureInkFilter() {
  if (document.getElementById("ink-jitter")) return;
  const svgNS = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(svgNS, "svg");
  defs.setAttribute("width", "0");
  defs.setAttribute("height", "0");
  defs.style.position = "absolute";
  defs.innerHTML = `
    <filter id="ink-jitter" x="-2%" y="-50%" width="104%" height="200%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="3" />
      <feDisplacementMap in="SourceGraphic" scale="0.6" />
    </filter>
  `;
  document.body.appendChild(defs);
}
