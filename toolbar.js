// toolbar.js
// Floating toolbar — bookmark and capture only.
// (Highlighting is no longer a tool: it begins automatically when the user
//  drags across text; see highlight.js.)

import { pushSignal } from "./signals.js";

export function renderToolbar(rootEl) {
  rootEl.innerHTML = "";

  const bookmark = makeBtn("🔖", "북마크", () => {
    const visible = visibleParagraphIds();
    pushSignal({
      type: "bookmark",
      paragraph_ids: visible,
      scroll_y: window.scrollY,
    });
    flash(bookmark);
  });
  const capture = makeBtn("📷", "캡쳐", () => {
    const visible = visibleParagraphIds();
    pushSignal({
      type: "capture",
      paragraph_ids: visible,
      scroll_y: window.scrollY,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    });
    flash(capture);
  });

  rootEl.appendChild(bookmark);
  rootEl.appendChild(capture);
}

function makeBtn(label, title, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.title = title;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function flash(el) {
  el.classList.add("is-active");
  setTimeout(() => el.classList.remove("is-active"), 220);
}

function visibleParagraphIds() {
  const out = [];
  for (const p of document.querySelectorAll("[data-paragraph-id]")) {
    const r = p.getBoundingClientRect();
    if (r.bottom > 0 && r.top < window.innerHeight) {
      out.push(p.dataset.paragraphId);
    }
  }
  return out;
}
