// sidebar.js
// Left column of the viewer. Three sections:
//   1) "소스 추가" — file drop / picker (.md, .markdown, .pdf), URL input,
//      sample loader.
//   2) "불러온 소스" — in-memory list of everything loaded this session,
//      clickable to re-open in the reader.
//   3) "현재 소스" — title + meta of the active source.
//
// The sidebar doesn't know how to render content — it just adapts the
// incoming file/URL into the common Source model and hands the result to
// the caller's onSelect(source) callback. The actual rendering lives in
// reader.js, and signal-collector wiring lives in app.js.

import { sampleSource } from "./sources/sample.js";
import {
  markdownSourceFromFile,
  markdownSource,
} from "./sources/markdown.js";
import { pdfSourceFromFile } from "./sources/pdf.js";
import { webSourceFromUrl } from "./sources/web.js";

let onSelect = () => {};
let rootEl = null;
let listEl = null;
let currentEl = null;
let statusEl = null;
let urlInputEl = null;

// In-memory cache so the user can re-open something loaded earlier this
// session without re-parsing. Phase 2 will move this to localStorage.
const loaded = []; // [{ source, label }]
let currentId = null;

export function initSidebar(opts = {}) {
  onSelect = opts.onSelect || (() => {});
  rootEl = document.getElementById("sidebar");
  if (!rootEl) return;
  build();
  // Seed with the sample source so the reader has something to show.
  const seed = sampleSource();
  pushAndSelect(seed, "샘플 글");
}

function build() {
  rootEl.innerHTML = `
    <h2>소스 추가</h2>
    <div class="src-actions">
      <label class="src-drop" id="src-drop">
        <span>마크다운 / PDF 파일 드롭<br/><small>또는 클릭해서 선택</small></span>
        <input type="file" accept=".md,.markdown,.pdf,application/pdf,text/markdown" id="src-file" />
      </label>
      <input type="url" id="src-url" placeholder="기사 URL (https://…)" />
      <button class="src-button" id="src-url-go" type="button">URL에서 불러오기</button>
      <button class="src-button" id="src-sample" type="button">샘플 글 다시 열기</button>
      <div class="src-status" id="src-status"></div>
    </div>

    <h2>불러온 소스</h2>
    <ul class="src-list" id="src-list"></ul>

    <h2>현재 소스</h2>
    <div class="src-current" id="src-current"></div>
  `;

  listEl = rootEl.querySelector("#src-list");
  currentEl = rootEl.querySelector("#src-current");
  statusEl = rootEl.querySelector("#src-status");
  urlInputEl = rootEl.querySelector("#src-url");

  const dropEl = rootEl.querySelector("#src-drop");
  const fileEl = rootEl.querySelector("#src-file");
  fileEl.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (f) await handleFile(f);
    fileEl.value = ""; // allow re-selecting the same file
  });
  // Drag-drop on the label.
  ["dragenter", "dragover"].forEach((ev) => {
    dropEl.addEventListener(ev, (e) => {
      e.preventDefault();
      dropEl.classList.add("is-dragover");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    dropEl.addEventListener(ev, (e) => {
      e.preventDefault();
      dropEl.classList.remove("is-dragover");
    });
  });
  dropEl.addEventListener("drop", async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) await handleFile(f);
  });

  rootEl
    .querySelector("#src-url-go")
    .addEventListener("click", () => handleUrl(urlInputEl.value));
  urlInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleUrl(urlInputEl.value);
  });

  rootEl.querySelector("#src-sample").addEventListener("click", () => {
    pushAndSelect(sampleSource(), "샘플 글");
  });

  renderList();
  renderCurrent(null);
}

async function handleFile(file) {
  setStatus(`불러오는 중: ${file.name}…`);
  try {
    const name = (file.name || "").toLowerCase();
    let source;
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      source = await pdfSourceFromFile(file);
    } else if (name.endsWith(".md") || name.endsWith(".markdown")) {
      source = await markdownSourceFromFile(file);
    } else if (file.type.startsWith("text/")) {
      // Treat as markdown — gracefully handles plain text too.
      source = await markdownSourceFromFile(file);
    } else {
      throw new Error(`지원하지 않는 파일 형식: ${file.name}`);
    }
    pushAndSelect(source, file.name);
    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus(`불러오기 실패: ${err.message || err}`, true);
  }
}

async function handleUrl(urlRaw) {
  const url = (urlRaw || "").trim();
  if (!url) return;
  setStatus(`불러오는 중: ${url}…`);
  try {
    const source = await webSourceFromUrl(url);
    pushAndSelect(source, source.title || url);
    urlInputEl.value = "";
    setStatus("");
  } catch (err) {
    console.error(err);
    // CORS errors come through here too — give the user a hint.
    const msg = String(err.message || err);
    const isCors =
      msg.includes("Failed to fetch") ||
      msg.includes("CORS") ||
      msg.includes("NetworkError");
    setStatus(
      isCors
        ? "이 사이트는 직접 가져올 수 없어요 (CORS). Phase 2에서 백엔드 프록시 예정."
        : `불러오기 실패: ${msg}`,
      true,
    );
  }
}

function pushAndSelect(source, label) {
  // Dedupe by id — sample source has a fixed id and shouldn't multiply.
  const existing = loaded.findIndex((e) => e.source.id === source.id);
  if (existing >= 0) {
    loaded[existing] = { source, label };
  } else {
    loaded.unshift({ source, label });
  }
  currentId = source.id;
  renderList();
  renderCurrent(source);
  onSelect(source);
}

function renderList() {
  if (!listEl) return;
  if (loaded.length === 0) {
    listEl.innerHTML = `<li style="cursor:default;border-left:none;color:var(--muted)">아직 없음</li>`;
    return;
  }
  listEl.innerHTML = loaded
    .map(
      ({ source, label }) => `
        <li data-id="${source.id}" class="${source.id === currentId ? "is-current" : ""}">
          <span class="src-kind">${source.kind}</span>${escapeHtml(label)}
        </li>`,
    )
    .join("");
  listEl.querySelectorAll("li[data-id]").forEach((li) => {
    li.addEventListener("click", () => {
      const id = li.dataset.id;
      const entry = loaded.find((e) => e.source.id === id);
      if (!entry) return;
      currentId = id;
      renderList();
      renderCurrent(entry.source);
      onSelect(entry.source);
    });
  });
}

function renderCurrent(source) {
  if (!currentEl) return;
  if (!source) {
    currentEl.textContent = "(없음)";
    return;
  }
  const wordCount = estimateWords(source);
  const metaBits = [];
  if (source.meta?.url) metaBits.push(source.meta.url);
  if (source.meta?.fileName) metaBits.push(source.meta.fileName);
  if (source.meta?.pageCount) metaBits.push(`${source.meta.pageCount} pages`);
  metaBits.push(`${wordCount} words`);
  currentEl.innerHTML = `
    <div class="src-current-title">${escapeHtml(source.title || "(untitled)")}</div>
    <div class="src-current-meta">${escapeHtml(metaBits.join(" · "))}</div>
  `;
}

function estimateWords(source) {
  let total = 0;
  for (const b of source.blocks) {
    if (b.text) total += b.text.split(/\s+/).filter(Boolean).length;
    if (b.items) {
      for (const i of b.items)
        total += i.split(/\s+/).filter(Boolean).length;
    }
  }
  return total;
}

function setStatus(msg, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.classList.toggle("is-error", !!isError);
}

function escapeHtml(s) {
  return String(s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

// Exposed only so external loaders (paste handlers, drag-into-window, etc.)
// could hook in later. Phase 1 doesn't use it.
export function loadMarkdownText(text, opts) {
  pushAndSelect(markdownSource(text, opts), opts?.title || "(텍스트)");
}
