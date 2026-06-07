#!/usr/bin/env python3
"""interpret.py — Layer2 reading-session interpreter.

Input is a session export JSON produced by the viewer's "내보내기" button
(see sidebar.js buildSessionExport). Two stages:

  1차 (refine): deterministic cleanup of the raw SignalLog. Downsample the
     mouse trail, aggregate dwell/reread per paragraph, resolve paragraph_id
     and char ranges back to the actual text, and assemble a compact reading
     digest. No network, fully reproducible.

  2차 (interpret): hand the digest + body text to an LLM (OpenAI or
     Anthropic) and ask where the reader paused, where they got stuck, and
     what caught their interest. Skipped with --no-llm or when no API key is
     present; the refined digest is always emitted either way.

Usage:
  python scripts/interpret.py session.json -o result.json
  python scripts/interpret.py session.json --no-llm
  python scripts/interpret.py session.json --provider anthropic --model <id>

API key is read from OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY
(or GOOGLE_API_KEY) depending on --provider (default: openai).
"""

import argparse
import json
import math
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

# Trail points closer than this (px) to the previous kept point are dropped —
# the raw trail samples every ~120ms and is far denser than the LLM needs.
TRAIL_MIN_DIST = 24
TRAIL_MAX_POINTS = 80
# Paragraph text shown inline in the digest is truncated to this many chars.
PREVIEW_CHARS = 80

# Verified against ai.google.dev (2026-05): gemini-2.5-flash is current/stable
# (2.0 flash retires 2026-06). gemini-2.5-pro / -flash-lite are alternatives.
DEFAULT_MODELS = {
    "openai": "gpt-4o",
    "anthropic": "claude-sonnet-4-6",
    "gemini": "gemini-2.5-flash",
}
KEY_ENVS = {
    "openai": ["OPENAI_API_KEY"],
    "anthropic": ["ANTHROPIC_API_KEY"],
    "gemini": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
}


# ---------- source / paragraph indexing ----------

def build_paragraph_index(blocks):
    """Rebuild the paragraph_id -> text map the viewer assigns at render time.

    Mirrors reader.js blockElement: block index i -> "pi"; list items ->
    "pi_liN"; hr blocks get no id.
    """
    index = {}
    order = []
    for i, block in enumerate(blocks or []):
        btype = block.get("type")
        pid = f"p{i}"
        if btype in ("heading", "paragraph", "blockquote", "code"):
            index[pid] = {"id": pid, "type": btype, "text": block.get("text", "")}
            order.append(pid)
        elif btype == "list":
            for j, item in enumerate(block.get("items", []) or []):
                iid = f"{pid}_li{j}"
                index[iid] = {"id": iid, "type": "list_item", "text": item}
                order.append(iid)
    return index, order


def text_of(index, pid):
    entry = index.get(pid)
    return entry["text"] if entry else ""


def preview(text, n=PREVIEW_CHARS):
    text = (text or "").strip().replace("\n", " ")
    return text if len(text) <= n else text[: n - 1] + "…"


def substr_by_range(text, char_range):
    if not char_range or len(char_range) != 2:
        return ""
    lo, hi = char_range
    try:
        return text[lo : hi + 1]
    except Exception:
        return ""


# ---------- 1차: refine ----------

def downsample_trail(points):
    kept = []
    last = None
    path_len = 0.0
    for p in points:
        x, y = p.get("x", 0), p.get("y", 0)
        if last is not None:
            path_len += math.hypot(x - last[0], y - last[1])
        if last is None or math.hypot(x - last[0], y - last[1]) >= TRAIL_MIN_DIST:
            kept.append({"x": round(x, 1), "y": round(y, 1), "t": round(p.get("t", 0))})
            last = (x, y)
    # Cap the count with uniform stride so a very long read doesn't bloat output.
    if len(kept) > TRAIL_MAX_POINTS:
        stride = math.ceil(len(kept) / TRAIL_MAX_POINTS)
        kept = kept[::stride]
    return kept, round(path_len)


def summarize_scroll(scrolls):
    if not scrolls:
        return {"events": 0}
    total_abs = sum(abs(s.get("delta", 0)) for s in scrolls)
    net = sum(s.get("delta", 0) for s in scrolls)
    ups = sum(1 for s in scrolls if s.get("direction") == "up")
    downs = sum(1 for s in scrolls if s.get("direction") == "down")
    reversals = 0
    prev = None
    for s in scrolls:
        d = s.get("direction")
        if prev and d and d != prev:
            reversals += 1
        prev = d or prev
    return {
        "events": len(scrolls),
        "total_distance_px": round(total_abs),
        "net_px": round(net),
        "up_events": ups,
        "down_events": downs,
        "direction_reversals": reversals,
    }


def compute_friction(para_list, viewport_h):
    """Per-paragraph friction coefficient (문헌 명세, 디벨롭 §10~§11).

    visibility-weighted attention + regression proxies (revisit/return_effort/
    reverse_rate), z-scored over the document's own distribution. Threshold is a
    percentile (top 20% = friction_high), not an absolute. ICAP/load tagging
    separates germane (productive struggle) from extraneous (wandering).
    """
    n = len(para_list)
    if n == 0:
        return
    vh = viewport_h or 800

    for p in para_list:
        p["attention"] = p.get("visible_ms") or p.get("dwell_ms") or 0
        p["revisit"] = max(0, (p.get("reread_count") or 0) - 1)
        tops = p.get("return_tops") or []
        p["return_effort"] = round((max(tops) - min(tops)) / vh, 3) if len(tops) > 1 else 0
        if not isinstance(p.get("reverse_rate"), (int, float)):
            p["reverse_rate"] = 0

    def zfn(vals):
        mean = sum(vals) / len(vals)
        sd = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5 or 1
        return lambda x: (x - mean) / sd

    z_att = zfn([p["attention"] for p in para_list])
    z_rev = zfn([p["revisit"] for p in para_list])
    z_ret = zfn([p["return_effort"] for p in para_list])
    z_rvr = zfn([p["reverse_rate"] for p in para_list])
    for p in para_list:
        p["friction"] = round(
            z_att(p["attention"])
            + z_rev(p["revisit"])
            + z_ret(p["return_effort"])
            + z_rvr(p["reverse_rate"]),
            3,
        )

    for i, p in enumerate(sorted(para_list, key=lambda p: p["friction"])):
        p["friction_pct"] = round(i / (n - 1), 3) if n > 1 else 1
    cut = max(1, -(-n // 5))  # ceil(n * 0.2)
    for i, p in enumerate(sorted(para_list, key=lambda p: -p["friction"])):
        p["friction_high"] = i < cut

    for p in para_list:
        has_chat = (p.get("chat_turns") or 0) > 0
        has_ann = len(p.get("annotations") or []) > 0
        has_mark = len(p.get("highlights") or []) > 0 or len(p.get("circles") or []) > 0
        p["icap_mode"] = "I" if has_chat else ("C" if has_ann else ("A" if has_mark else "P"))
        if p["friction_high"] and (has_ann or has_chat):
            p["load_tag"] = "germane"
        elif p["friction_high"] and not has_ann and not has_mark:
            p["load_tag"] = "extraneous"
        else:
            p["load_tag"] = "ambiguous"
        p.pop("return_tops", None)


def refine(export):
    """Turn the raw SignalLog into a compact, text-resolved reading digest."""
    session = export.get("session", {})
    source = export.get("source") or {}
    signals = export.get("signals", []) or []
    index, order = build_paragraph_index(source.get("blocks", []))
    start_t = session.get("start_t", 0)

    def rel(t):
        return round((t or 0) - start_t)

    by_type = {}
    for s in signals:
        by_type.setdefault(s.get("type"), []).append(s)

    # Per-paragraph aggregation, keyed by paragraph_id.
    paras = {}

    def para_slot(pid):
        if pid not in paras:
            paras[pid] = {
                "id": pid,
                "text_preview": preview(text_of(index, pid)),
                "dwell_ms": 0,
                "dwell_events": 0,
                "visible_ms": 0.0,
                "reread_count": 0,
                "reverse_rate": 0.0,
                "return_tops": [],
                "highlights": [],
                "annotations": [],
                "circles": [],
                "chat_turns": 0,
                "bookmarked": False,
                "captured": False,
            }
        return paras[pid]

    for s in by_type.get("dwell", []):
        slot = para_slot(s.get("paragraph_id"))
        slot["dwell_ms"] += s.get("duration_ms", 0)
        slot["dwell_events"] += 1
        vf = s.get("visible_frac")
        vf = vf if isinstance(vf, (int, float)) else 1
        slot["visible_ms"] += s.get("duration_ms", 0) * vf
    for s in by_type.get("reread", []):
        slot = para_slot(s.get("paragraph_id"))
        slot["reread_count"] = max(
            slot["reread_count"], s.get("enter_count") or s.get("visit_count", 0)
        )
        rr = s.get("reverse_rate")
        if isinstance(rr, (int, float)):
            slot["reverse_rate"] = max(slot["reverse_rate"], rr)
        st = s.get("scroll_top")
        if isinstance(st, (int, float)):
            slot["return_tops"].append(st)

    highlights = []
    for s in by_type.get("highlight_underline", []):
        pid = s.get("paragraph_id")
        item = {
            "paragraph_id": pid,
            "text": s.get("selected_text", ""),
            "char_range": s.get("char_range"),
            "duration_ms": s.get("duration_ms", 0),
            "draw_speed": s.get("draw_speed", 0),
            "rel_ms": rel(s.get("t")),
        }
        highlights.append(item)
        para_slot(pid)["highlights"].append(item["text"])

    annotations = []
    for s in by_type.get("highlight_annotation", []):
        pid = s.get("paragraph_id")
        item = {
            "paragraph_id": pid,
            "anchor_text": s.get("anchor_text", ""),
            "annotation_text": s.get("annotation_text", ""),
            "total_duration_ms": s.get("total_duration_ms", 0),
            "rel_ms": rel(s.get("t")),
        }
        annotations.append(item)
        para_slot(pid)["annotations"].append(
            {"on": item["anchor_text"], "note": item["annotation_text"]}
        )

    circles = []
    for s in by_type.get("circle_gesture", []):
        pid = s.get("enclosed_paragraph")
        item = {
            "paragraph_id": pid,
            "enclosed_text": s.get("enclosed_text", ""),
            "radius": s.get("radius", 0),
            "rel_ms": rel(s.get("t")),
        }
        circles.append(item)
        if pid:
            para_slot(pid)["circles"].append(item["enclosed_text"])

    for s in by_type.get("chat_turn", []):
        pid = s.get("paragraph_id")
        if pid:
            para_slot(pid)["chat_turns"] += 1

    for s in by_type.get("bookmark", []):
        for pid in s.get("paragraph_ids", []) or []:
            para_slot(pid)["bookmarked"] = True
    for s in by_type.get("capture", []):
        for pid in s.get("paragraph_ids", []) or []:
            para_slot(pid)["captured"] = True

    # Emit paragraph activity in reading order, only the ones with signal.
    para_list = [paras[pid] for pid in order if pid in paras]
    # Any paragraph_id referenced but not in the index (shouldn't happen, but
    # keep the data) gets appended at the end.
    for pid, slot in paras.items():
        if pid not in index:
            para_list.append(slot)

    # Friction coefficient per paragraph (해석 레이어, 디벨롭 §10~§11).
    viewport_h = (
        (session.get("viewport") or {}).get("h")
        or ((export.get("meta") or {}).get("viewport") or {}).get("h")
        or 800
    )
    compute_friction(para_list, viewport_h)

    trail, trail_len = downsample_trail(by_type.get("mouse_trail", []))

    # Notable timeline — everything except the high-volume trail/scroll noise,
    # ordered by time, with text resolved.
    timeline = []
    for s in signals:
        t = s.get("type")
        if t in ("mouse_trail", "scroll", "session_start", "session_end"):
            continue
        ev = {"rel_ms": rel(s.get("t")), "type": t}
        if t == "dwell":
            ev["paragraph_id"] = s.get("paragraph_id")
            ev["duration_ms"] = s.get("duration_ms")
        elif t == "reread":
            ev["paragraph_id"] = s.get("paragraph_id")
            ev["visit_count"] = s.get("visit_count")
        elif t == "highlight_underline":
            ev["paragraph_id"] = s.get("paragraph_id")
            ev["text"] = s.get("selected_text", "")
        elif t == "highlight_annotation":
            ev["paragraph_id"] = s.get("paragraph_id")
            ev["anchor"] = s.get("anchor_text", "")
            ev["note"] = s.get("annotation_text", "")
        elif t == "circle_gesture":
            ev["text"] = s.get("enclosed_text", "")
        elif t in ("bookmark", "capture"):
            ev["paragraph_ids"] = s.get("paragraph_ids", [])
        timeline.append(ev)
    timeline.sort(key=lambda e: e["rel_ms"])

    return {
        "counts": {k: len(v) for k, v in by_type.items()},
        "paragraphs": para_list,
        "highlights": highlights,
        "annotations": annotations,
        "circles": circles,
        "scroll": summarize_scroll(by_type.get("scroll", [])),
        "mouse_trail": {"kept_points": len(trail), "path_length_px": trail_len, "points": trail},
        "timeline": timeline,
    }


# ---------- body text reconstruction ----------

def body_text(index, order):
    lines = []
    for pid in order:
        entry = index[pid]
        txt = (entry.get("text") or "").strip()
        if txt:
            lines.append(f"[{pid}] {txt}")
    return "\n\n".join(lines)


# ---------- 2차: LLM interpretation ----------

SYSTEM_PROMPT = (
    "당신은 독서 행동 분석가입니다. 사용자가 글을 읽으며 남긴 행동 신호"
    "(머문 시간 dwell, 다시 읽기 reread, 밑줄 highlight, 메모 annotation, "
    "동그라미 circle, 북마크, 스크롤)를 보고 독자의 읽기 경험을 해석합니다. "
    "추측은 신호에 근거해서만 하고, 과장하지 마세요. 반드시 한국어로, "
    "지정된 JSON 스키마로만 답하세요."
)

USER_TEMPLATE = """다음은 한 독서 세션의 본문과 정제된 행동 신호입니다.

## 본문 (문단 id 표시)
{body}

## 정제된 신호 digest (JSON)
{digest}

## 분석 요청
아래 JSON 스키마로만 답하세요. 모든 값은 한국어로 작성하고, paragraph_id는 본문의 [id]와 맞추세요.

{{
  "summary": "이 독서 세션을 2~3문장으로 요약",
  "paused_at": [{{"paragraph_id": "p?", "text": "해당 문단/구절", "why": "왜 여기서 머물렀다고 보는지"}}],
  "stuck_at": [{{"paragraph_id": "p?", "text": "해당 문단/구절", "evidence": "막혔다고 보는 근거(reread/느린 밑줄 등)"}}],
  "interests": ["독자가 관심을 보인 주제/표현"],
  "engagement": "low|medium|high",
  "notes": "기타 눈에 띄는 패턴 (없으면 빈 문자열)"
}}"""


def parse_json_loose(text):
    try:
        return json.loads(text)
    except Exception:
        pass
    # Strip ``` fences or surrounding prose — grab the outermost {...}.
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except Exception:
            return None
    return None


def call_openai(model, system, user, api_key):
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def call_anthropic(model, system, user, api_key):
    payload = {
        "model": model,
        "max_tokens": 2048,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["content"][0]["text"]


def call_gemini(model, system, user, api_key):
    payload = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"temperature": 0.3, "responseMimeType": "application/json"},
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["candidates"][0]["content"]["parts"][0]["text"]


def interpret_with_llm(provider, model, body, digest):
    envs = KEY_ENVS[provider]
    api_key = next((os.environ[e] for e in envs if os.environ.get(e)), None)
    if not api_key:
        return None, f"{'/'.join(envs)} 미설정 — 2차 LLM 해석 건너뜀"
    user = USER_TEMPLATE.format(body=body, digest=json.dumps(digest, ensure_ascii=False, indent=2))
    try:
        if provider == "openai":
            raw = call_openai(model, SYSTEM_PROMPT, user, api_key)
        elif provider == "gemini":
            raw = call_gemini(model, SYSTEM_PROMPT, user, api_key)
        else:
            raw = call_anthropic(model, SYSTEM_PROMPT, user, api_key)
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", "replace")
        return None, f"{provider} HTTP {e.code}: {body_err[:300]}"
    except Exception as e:  # noqa: BLE001 — surface any transport error to the caller
        return None, f"{provider} 호출 실패: {e}"
    parsed = parse_json_loose(raw)
    if parsed is None:
        return {"raw": raw}, "LLM 응답을 JSON으로 파싱하지 못함 — raw 보존"
    return parsed, None


# ---------- main ----------

def main(argv=None):
    ap = argparse.ArgumentParser(description="Layer2 reading-session interpreter")
    ap.add_argument("input", help="session export JSON (viewer 내보내기 결과)")
    ap.add_argument("-o", "--output", help="결과 JSON 경로 (생략 시 stdout)")
    ap.add_argument(
        "--provider", choices=["openai", "anthropic", "gemini"], default="openai"
    )
    ap.add_argument("--model", help="LLM 모델 id (provider 기본값 override)")
    ap.add_argument("--no-llm", action="store_true", help="1차 정제만 수행")
    args = ap.parse_args(argv)

    with open(args.input, "r", encoding="utf-8") as f:
        export = json.load(f)

    session = export.get("session", {})
    source = export.get("source") or {}
    index, order = build_paragraph_index(source.get("blocks", []))

    digest = refine(export)

    interpretation = None
    note = None
    if args.no_llm:
        note = "--no-llm: 2차 해석 건너뜀"
    else:
        model = args.model or DEFAULT_MODELS[args.provider]
        interpretation, note = interpret_with_llm(
            args.provider, model, body_text(index, order), digest
        )

    if note:
        print(f"[interpret] {note}", file=sys.stderr)

    result = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "id": source.get("id"),
            "kind": source.get("kind"),
            "title": source.get("title"),
        },
        "session": {
            "source_id": session.get("source_id"),
            "duration_ms": session.get("duration_ms"),
            "signal_count": len(export.get("signals", []) or []),
        },
        "refined": digest,
        "interpretation": interpretation,
        "interpretation_note": note,
    }

    out = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(out + "\n")
        print(f"[interpret] wrote {args.output}", file=sys.stderr)
    else:
        print(out)


if __name__ == "__main__":
    main()
