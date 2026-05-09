// reader.js
// Renders content into the page and prepares pretext layout per paragraph.
// Each grapheme is wrapped in its own span so highlight.js can toggle
// per-character classes without DOM measurement work.

import { content } from "./content.js";
import { preparePara } from "./pretext_helpers.js";

export const PARA_WIDTH = 640;
const graphemeSeg = new Intl.Segmenter("ko", { granularity: "grapheme" });

export function renderReader(rootEl) {
  rootEl.innerHTML = "";
  const article = document.createElement("article");
  article.className = "article";

  const h1 = document.createElement("h1");
  h1.textContent = content.title;
  article.appendChild(h1);

  const byline = document.createElement("div");
  byline.className = "byline";
  byline.textContent = content.byline;
  article.appendChild(byline);

  for (const p of content.paragraphs) {
    const pEl = document.createElement("p");
    pEl.className = "para";
    pEl.dataset.paragraphId = p.id;

    let charIdx = 0;
    for (const g of graphemeSeg.segment(p.text)) {
      const span = document.createElement("span");
      span.className = "g";
      span.dataset.charIndex = String(charIdx);
      span.textContent = g.segment;
      pEl.appendChild(span);
      charIdx++;
    }
    article.appendChild(pEl);
  }

  rootEl.appendChild(article);

  // Pretext cache: build only after fonts are ready so widths are accurate.
  const buildPretext = () => {
    for (const p of content.paragraphs) {
      preparePara(p.id, p.text, PARA_WIDTH);
    }
  };
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(buildPretext);
  } else {
    buildPretext();
  }

  // SVG filter for the slight underline jitter
  ensureInkFilter();
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
