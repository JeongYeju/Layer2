// interpret.js — in-browser port of scripts/interpret.py.
// Lets the dashboard run the whole interpret pipeline (refine → LLM) with no
// terminal step: build the session digest in JS, then call the LLM directly
// from the browser using a user-supplied API key. Output matches interpret.py's
// result shape so dashboard.renderInterpretation can render it unchanged.

const TRAIL_MIN_DIST = 24;
const TRAIL_MAX_POINTS = 80;
const PREVIEW_CHARS = 80;
// Model defaults verified against ai.google.dev (2026-05): gemini-2.5-flash is
// current/stable; 2.0 flash retires 2026-06. Swap for gemini-2.5-pro for deeper
// reasoning or gemini-2.5-flash-lite for cheapest.
const DEFAULT_MODELS = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-2.5-flash",
};

const SYSTEM_PROMPT =
  "당신은 독서 행동 분석가입니다. 사용자가 글을 읽으며 남긴 행동 신호" +
  "(머문 시간 dwell, 다시 읽기 reread, 밑줄 highlight, 메모 annotation, " +
  "동그라미 circle, 북마크, 스크롤)를 보고 독자의 읽기 경험을 해석합니다. " +
  "추측은 신호에 근거해서만 하고, 과장하지 마세요. 반드시 한국어로, " +
  "지정된 JSON 스키마로만 답하세요.";

function userPrompt(body, digestJson) {
  return `다음은 한 독서 세션의 본문과 정제된 행동 신호입니다.

## 본문 (문단 id 표시)
${body}

## 정제된 신호 digest (JSON)
${digestJson}

## 분석 요청
아래 JSON 스키마로만 답하세요. 모든 값은 한국어로 작성하고, paragraph_id는 본문의 [id]와 맞추세요.

{
  "summary": "이 독서 세션을 2~3문장으로 요약",
  "paused_at": [{"paragraph_id": "p?", "text": "해당 문단/구절", "why": "왜 여기서 머물렀다고 보는지"}],
  "stuck_at": [{"paragraph_id": "p?", "text": "해당 문단/구절", "evidence": "막혔다고 보는 근거(reread/느린 밑줄 등)"}],
  "interests": ["독자가 관심을 보인 주제/표현"],
  "engagement": "low|medium|high",
  "notes": "기타 눈에 띄는 패턴 (없으면 빈 문자열)"
}`;
}

// ---------- source / paragraph indexing (mirrors reader.js block ids) ----------

function buildParagraphIndex(blocks) {
  const index = {};
  const order = [];
  (blocks || []).forEach((block, i) => {
    const btype = block.type;
    const pid = `p${i}`;
    if (["heading", "paragraph", "blockquote", "code"].includes(btype)) {
      index[pid] = { id: pid, type: btype, text: block.text || "" };
      order.push(pid);
    } else if (btype === "list") {
      (block.items || []).forEach((item, j) => {
        const iid = `${pid}_li${j}`;
        index[iid] = { id: iid, type: "list_item", text: item };
        order.push(iid);
      });
    }
  });
  return { index, order };
}

const textOf = (index, pid) => (index[pid] ? index[pid].text : "");

function preview(text, n = PREVIEW_CHARS) {
  text = (text || "").trim().replace(/\n/g, " ");
  return text.length <= n ? text : text.slice(0, n - 1) + "…";
}

// ---------- 1차: refine ----------

function downsampleTrail(points) {
  const kept = [];
  let last = null;
  let pathLen = 0;
  for (const p of points) {
    const x = p.x || 0;
    const y = p.y || 0;
    if (last) pathLen += Math.hypot(x - last[0], y - last[1]);
    if (!last || Math.hypot(x - last[0], y - last[1]) >= TRAIL_MIN_DIST) {
      kept.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, t: Math.round(p.t || 0) });
      last = [x, y];
    }
  }
  let out = kept;
  if (kept.length > TRAIL_MAX_POINTS) {
    const stride = Math.ceil(kept.length / TRAIL_MAX_POINTS);
    out = kept.filter((_, i) => i % stride === 0);
  }
  return { points: out, len: Math.round(pathLen) };
}

function summarizeScroll(scrolls) {
  if (!scrolls.length) return { events: 0 };
  let totalAbs = 0;
  let net = 0;
  let ups = 0;
  let downs = 0;
  let reversals = 0;
  let prev = null;
  for (const s of scrolls) {
    totalAbs += Math.abs(s.delta || 0);
    net += s.delta || 0;
    if (s.direction === "up") ups++;
    if (s.direction === "down") downs++;
    if (prev && s.direction && s.direction !== prev) reversals++;
    prev = s.direction || prev;
  }
  return {
    events: scrolls.length,
    total_distance_px: Math.round(totalAbs),
    net_px: Math.round(net),
    up_events: ups,
    down_events: downs,
    direction_reversals: reversals,
  };
}

function refine(exportData, index, order) {
  const session = exportData.session || {};
  const signals = exportData.signals || [];
  const startT = session.start_t || 0;
  const rel = (t) => Math.round((t || 0) - startT);

  const byType = {};
  for (const s of signals) (byType[s.type] = byType[s.type] || []).push(s);
  const of = (t) => byType[t] || [];

  const paras = {};
  const slot = (pid) => {
    if (!paras[pid]) {
      paras[pid] = {
        id: pid,
        text_preview: preview(textOf(index, pid)),
        dwell_ms: 0,
        dwell_events: 0,
        reread_count: 0,
        highlights: [],
        annotations: [],
        circles: [],
        bookmarked: false,
        captured: false,
      };
    }
    return paras[pid];
  };

  for (const s of of("dwell")) {
    const p = slot(s.paragraph_id);
    p.dwell_ms += s.duration_ms || 0;
    p.dwell_events += 1;
  }
  for (const s of of("reread")) {
    const p = slot(s.paragraph_id);
    p.reread_count = Math.max(p.reread_count, s.visit_count || 0);
  }

  const highlights = [];
  for (const s of of("highlight_underline")) {
    const item = {
      paragraph_id: s.paragraph_id,
      text: s.selected_text || "",
      char_range: s.char_range,
      duration_ms: s.duration_ms || 0,
      draw_speed: s.draw_speed || 0,
      rel_ms: rel(s.t),
    };
    highlights.push(item);
    slot(s.paragraph_id).highlights.push(item.text);
  }

  const annotations = [];
  for (const s of of("highlight_annotation")) {
    const item = {
      paragraph_id: s.paragraph_id,
      anchor_text: s.anchor_text || "",
      annotation_text: s.annotation_text || "",
      total_duration_ms: s.total_duration_ms || 0,
      rel_ms: rel(s.t),
    };
    annotations.push(item);
    slot(s.paragraph_id).annotations.push({ on: item.anchor_text, note: item.annotation_text });
  }

  const circles = [];
  for (const s of of("circle_gesture")) {
    const pid = s.enclosed_paragraph;
    const item = { paragraph_id: pid, enclosed_text: s.enclosed_text || "", radius: s.radius || 0, rel_ms: rel(s.t) };
    circles.push(item);
    if (pid) slot(pid).circles.push(item.enclosed_text);
  }

  for (const s of of("bookmark")) for (const pid of s.paragraph_ids || []) slot(pid).bookmarked = true;
  for (const s of of("capture")) for (const pid of s.paragraph_ids || []) slot(pid).captured = true;

  const paraList = order.filter((pid) => paras[pid]).map((pid) => paras[pid]);
  for (const [pid, s] of Object.entries(paras)) if (!index[pid]) paraList.push(s);

  const trail = downsampleTrail(of("mouse_trail"));

  const timeline = [];
  for (const s of signals) {
    const t = s.type;
    if (["mouse_trail", "scroll", "session_start", "session_end"].includes(t)) continue;
    const ev = { rel_ms: rel(s.t), type: t };
    if (t === "dwell") {
      ev.paragraph_id = s.paragraph_id;
      ev.duration_ms = s.duration_ms;
    } else if (t === "reread") {
      ev.paragraph_id = s.paragraph_id;
      ev.visit_count = s.visit_count;
    } else if (t === "highlight_underline") {
      ev.paragraph_id = s.paragraph_id;
      ev.text = s.selected_text || "";
    } else if (t === "highlight_annotation") {
      ev.paragraph_id = s.paragraph_id;
      ev.anchor = s.anchor_text || "";
      ev.note = s.annotation_text || "";
    } else if (t === "circle_gesture") {
      ev.text = s.enclosed_text || "";
    } else if (t === "bookmark" || t === "capture") {
      ev.paragraph_ids = s.paragraph_ids || [];
    }
    timeline.push(ev);
  }
  timeline.sort((a, b) => a.rel_ms - b.rel_ms);

  const counts = {};
  for (const [k, v] of Object.entries(byType)) counts[k] = v.length;

  return {
    counts,
    paragraphs: paraList,
    highlights,
    annotations,
    circles,
    scroll: summarizeScroll(of("scroll")),
    mouse_trail: { kept_points: trail.points.length, path_length_px: trail.len, points: trail.points },
    timeline,
  };
}

function bodyText(index, order) {
  const lines = [];
  for (const pid of order) {
    const txt = (index[pid].text || "").trim();
    if (txt) lines.push(`[${pid}] ${txt}`);
  }
  return lines.join("\n\n");
}

// ---------- 2차: LLM ----------

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

async function callAnthropic(model, system, user, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 2048, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

async function callOpenAI(model, system, user, apiKey) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`openai HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callGemini(model, system, user, apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
      }),
    },
  );
  if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// Build the digest, optionally call the LLM, and return interpret.py's result
// shape. LLM/transport errors are folded into interpretation_note so the
// refined digest still renders.
export async function interpretSession({ exportData, provider = "anthropic", model, apiKey }) {
  const source = exportData.source || {};
  const { index, order } = buildParagraphIndex(source.blocks || []);
  const digest = refine(exportData, index, order);

  let interpretation = null;
  let note = null;
  if (!apiKey) {
    note = "API 키가 없어 1차 정제(digest)만 표시합니다.";
  } else {
    const user = userPrompt(bodyText(index, order), JSON.stringify(digest, null, 2));
    const mdl = model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.anthropic;
    try {
      const raw =
        provider === "openai"
          ? await callOpenAI(mdl, SYSTEM_PROMPT, user, apiKey)
          : provider === "gemini"
            ? await callGemini(mdl, SYSTEM_PROMPT, user, apiKey)
            : await callAnthropic(mdl, SYSTEM_PROMPT, user, apiKey);
      const parsed = parseJsonLoose(raw);
      if (parsed) interpretation = parsed;
      else {
        interpretation = { raw };
        note = "LLM 응답을 JSON으로 파싱하지 못함 — raw 보존";
      }
    } catch (err) {
      note = String(err.message || err);
    }
  }

  const session = exportData.session || {};
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    source: { id: source.id, kind: source.kind, title: source.title },
    session: {
      source_id: session.source_id,
      duration_ms: session.duration_ms,
      signal_count: (exportData.signals || []).length,
    },
    refined: digest,
    interpretation,
    interpretation_note: note,
  };
}
