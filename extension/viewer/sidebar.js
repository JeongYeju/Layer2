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
import { pushSignal, SignalLog } from "./signals.js";

let onSelect = () => {};
let rootEl = null;
let listEl = null;
let currentEl = null;
let statusEl = null;
let urlInputEl = null;
let extSavedHead = null;
let extSavedList = null;

// In-memory cache so the user can re-open something loaded earlier without
// re-parsing. Mirrored to localStorage (persistSources) so the source list and
// the current source survive a reload.
const loaded = []; // [{ source, label }]
let currentId = null;

const STORAGE_KEY = "layer2.sources.v1";
const MAX_PERSISTED = 20; // newest-first; cap so we stay well under quota

function persistSources() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ loaded: loaded.slice(0, MAX_PERSISTED), currentId }),
    );
  } catch (err) {
    // Best-effort: a quota/serialization failure shouldn't break the reader.
    console.warn("[sidebar] persist failed:", err);
  }
}

function loadPersisted() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!data || !Array.isArray(data.loaded)) return null;
    return data;
  } catch {
    return null;
  }
}

function restoreLoaded(persisted) {
  loaded.length = 0;
  for (const entry of persisted.loaded) {
    if (entry?.source?.id) loaded.push(entry);
  }
}

// Reading-session state. session_start / session_end signals get emitted
// when the user explicitly opens/closes a reading. Switching sources mid-
// session auto-closes the previous session so we don't conflate two reads.
let sessionActive = false;
let sessionStartedAt = 0;
let sessionSourceId = null;

export function initSidebar(opts = {}) {
  onSelect = opts.onSelect || (() => {});
  rootEl = document.getElementById("sidebar");
  if (!rootEl) return;
  build();

  const persisted = loadPersisted();

  // Seed the reader. Priority: an injected source (browser extension) →
  // persisted state from a previous visit → the built-in sample.
  if (opts.initialSource) {
    if (persisted) restoreLoaded(persisted);
    pushAndSelect(opts.initialSource, opts.initialSource.title || "불러온 글");
  } else if (persisted?.loaded?.length) {
    restoreLoaded(persisted);
    const want =
      loaded.find((e) => e.source.id === persisted.currentId) || loaded[0];
    selectById(want.source.id);
  } else {
    pushAndSelect(sampleSource(), "샘플 글");
  }

  initExtBridge();
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

    <h2 id="ext-saved-head" class="ext-saved-head" hidden>저장된 글 <small>확장</small></h2>
    <ul class="src-list" id="ext-saved-list" hidden></ul>

    <h2>불러온 소스</h2>
    <ul class="src-list" id="src-list"></ul>

    <h2>현재 소스</h2>
    <div class="src-current" id="src-current"></div>
  `;

  listEl = rootEl.querySelector("#src-list");
  currentEl = rootEl.querySelector("#src-current");
  statusEl = rootEl.querySelector("#src-status");
  urlInputEl = rootEl.querySelector("#src-url");
  extSavedHead = rootEl.querySelector("#ext-saved-head");
  extSavedList = rootEl.querySelector("#ext-saved-list");

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
    // web.js already tries direct + the proxy fallbacks. If we still got
    // here, none of them worked — surface the underlying reasons so the
    // user can see whether it's CORS, the proxy being down, or some other
    // network thing.
    const msg = String(err.message || err);
    setStatus(`불러오기 실패: ${msg}`, true);
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
  persistSources();
}

// Re-open an already-loaded source by id (no re-parse). Shared by the list
// click handler and the persisted-state restore on boot.
function selectById(id) {
  const entry = loaded.find((e) => e.source.id === id);
  if (!entry) return;
  currentId = id;
  renderList();
  renderCurrent(entry.source);
  onSelect(entry.source);
  persistSources();
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
    li.addEventListener("click", () => selectById(li.dataset.id));
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

  // Show the right button + status pair based on whether this source is the
  // one we have an active session on. Switching to a different source while
  // active is allowed — clicking 시작 there will close the old session first
  // (handled in startSession).
  const isActiveHere = sessionActive && sessionSourceId === source.id;
  const buttonHtml = isActiveHere
    ? `<button class="src-session-btn" id="src-session-end" type="button">✓ 독서 끝내기</button>`
    : `<button class="src-session-btn is-primary" id="src-session-start" type="button">📖 독서 시작</button>`;
  const statusHtml = isActiveHere
    ? `<div class="src-session-status is-active">독서 중…</div>`
    : sessionActive
      ? `<div class="src-session-status">다른 글 읽는 중</div>`
      : "";

  currentEl.innerHTML = `
    <div class="src-current-title">${escapeHtml(source.title || "(untitled)")}</div>
    <div class="src-current-meta">${escapeHtml(metaBits.join(" · "))}</div>
    <div class="src-session">
      ${buttonHtml}
      <button class="src-session-btn src-export-btn" id="src-export" type="button" title="가장 최근 독서 세션(소스 + 신호)을 JSON으로 내보내기">⬇ 내보내기</button>
    </div>
    ${statusHtml}
  `;

  const startBtn = currentEl.querySelector("#src-session-start");
  const endBtn = currentEl.querySelector("#src-session-end");
  const exportBtn = currentEl.querySelector("#src-export");
  if (startBtn) startBtn.addEventListener("click", () => startSession(source));
  if (endBtn) endBtn.addEventListener("click", () => endSession("user"));
  if (exportBtn) exportBtn.addEventListener("click", exportLastSession);
}

function startSession(source) {
  // If another session is open (e.g., user switched sources without closing),
  // close it first so each session is bounded by exactly one start/end pair.
  if (sessionActive) endSession("auto_switch");
  sessionActive = true;
  sessionStartedAt = performance.now();
  sessionSourceId = source.id;
  pushSignal({
    type: "session_start",
    source_id: source.id,
    source_kind: source.kind,
    source_title: source.title,
  });
  renderCurrent(source);
}

function endSession(reason) {
  if (!sessionActive) return;
  const id = sessionSourceId;
  const elapsedMs = performance.now() - sessionStartedAt;
  pushSignal({
    type: "session_end",
    source_id: id,
    reason,
    elapsed_ms: Math.round(elapsedMs),
  });
  sessionActive = false;
  sessionSourceId = null;
  sessionStartedAt = 0;
  // Re-render whatever's currently displayed so the button flips back.
  const current = loaded.find((e) => e.source.id === currentId);
  if (current) renderCurrent(current.source);
}

// ---------- Phase 2.1: session export ----------
// Bundle the most recent *completed* reading session (the source content +
// the signals captured between its session_start / session_end markers) into
// the JSON shape that scripts/interpret.py consumes, and download it.

function exportLastSession() {
  const data = buildSessionExport();
  if (!data) {
    setStatus("내보낼 완료된 독서 세션이 없습니다. 독서 시작 → 끝내기 후 다시 시도하세요.", true);
    return;
  }
  downloadJson(data);
  setStatus(`내보냄: ${data.signals.length}개 신호 · ${data.session.source_title || "(제목 없음)"}`);
}

function buildSessionExport() {
  // Latest session_end, then walk back to its matching session_start.
  let endIdx = -1;
  for (let i = SignalLog.length - 1; i >= 0; i--) {
    if (SignalLog[i].type === "session_end") {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) return null;
  const end = SignalLog[endIdx];

  let startIdx = -1;
  for (let i = endIdx - 1; i >= 0; i--) {
    const s = SignalLog[i];
    if (s.type === "session_start" && s.source_id === end.source_id) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return null;
  const start = SignalLog[startIdx];

  // Inclusive of both markers so interpret.py can see the session bounds.
  const signals = SignalLog.slice(startIdx, endIdx + 1);
  const entry = loaded.find((e) => e.source.id === start.source_id);

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    session: {
      start_t: start.t,
      end_t: end.t,
      source_id: start.source_id,
      source_kind: start.source_kind,
      source_title: start.source_title,
      duration_ms:
        end.elapsed_ms != null ? end.elapsed_ms : Math.round(end.t - start.t),
    },
    source: entry ? entry.source : null,
    signals,
  };
}

function downloadJson(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const safeTitle = String(data.session.source_title || "session")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 40);
  const a = document.createElement("a");
  a.href = url;
  a.download = `layer2-${safeTitle || "session"}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

// ---------- Saved-article bridge (browser extension) ----------
// The extension's content script (content-bridge.js) relays its saved library
// over postMessage. We show the "저장된 글" section only when the bridge
// answers; in the plain standalone viewer it stays hidden.

const EXT_SRC = "layer2-ext";
const VIEWER_SRC = "layer2-viewer";
let extSaved = [];

function initExtBridge() {
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const msg = e.data;
    if (!msg || msg.source !== EXT_SRC) return;
    if (msg.op === "ready") {
      requestExtList();
    } else if (msg.op === "list") {
      extSaved = Array.isArray(msg.items) ? msg.items : [];
      renderExtSaved();
    }
  });
  requestExtList();
}

function requestExtList() {
  window.postMessage({ source: VIEWER_SRC, op: "list" }, window.location.origin);
}

function renderExtSaved() {
  if (!extSavedHead || !extSavedList) return;
  const has = extSaved.length > 0;
  extSavedHead.hidden = !has;
  extSavedList.hidden = !has;
  if (!has) {
    extSavedList.innerHTML = "";
    return;
  }
  extSavedList.innerHTML = extSaved
    .map(({ source }) => {
      const id = source?.id || "";
      return `<li data-ext-id="${escapeHtml(id)}">
        <button class="ext-del" type="button" title="삭제" data-del="${escapeHtml(id)}">×</button>
        <span class="src-kind">${escapeHtml(source?.kind || "web")}</span>${escapeHtml(source?.title || "(제목 없음)")}
      </li>`;
    })
    .join("");
  extSavedList.querySelectorAll("li[data-ext-id]").forEach((li) => {
    li.addEventListener("click", (e) => {
      if (e.target.closest("[data-del]")) return; // delete handled below
      const entry = extSaved.find((it) => it.source?.id === li.dataset.extId);
      if (entry?.source) {
        pushAndSelect(entry.source, entry.source.title || "저장된 글");
      }
    });
  });
  extSavedList.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      window.postMessage(
        { source: VIEWER_SRC, op: "delete", id },
        window.location.origin,
      );
      // Optimistic removal; the bridge will also push a refreshed list.
      extSaved = extSaved.filter((it) => it.source?.id !== id);
      renderExtSaved();
    });
  });
}

// Exposed only so external loaders (paste handlers, drag-into-window, etc.)
// could hook in later. Phase 1 doesn't use it.
export function loadMarkdownText(text, opts) {
  pushAndSelect(markdownSource(text, opts), opts?.title || "(텍스트)");
}
