# 다중 세션 리포트 (Macro Report)

> **한 줄** — 한 번의 독서가 끝날 때마다 그 세션의 요약(언제·무엇·얼마나 치열했나)을 브라우저에 쌓아, 여러 독서가 모이면 **시간대별 인지 리듬·마찰 추이·관심사** 같은 거시 리포트를 보여준다. DB 없이 localStorage 만으로.

| | |
|---|---|
| **상태** | v0.1 (1차 구현 — 누적 + 대시보드 거시 섹션) |
| **핵심 파일** | `sessions.js`, `dashboard.js` (다중 세션 섹션), `styles.css` (`.sess-*`) |
| **구독 신호** | `session_end` |
| **TODO** | `TODO.md` Phase 2.5.6 (Macro) |

---

## 1. 한 줄 요약

단일 세션 리포트(보드 모드)가 *한 편의 글 안에서* 나를 비춰준다면, 이건 *여러 편에 걸쳐* 나를 비춘다. 세션이 끝나면 friction·ICAP 요약이 `localStorage` 에 쌓이고, 대시보드 "다중 세션" 섹션이 그걸 굴려 — 내가 주로 언제 깊게 읽는지(시간대 리듬), 마찰이 어떻게 변해왔는지(추이), 무엇에 관심이 쏠리는지(관심사) — 를 보여준다.

## 2. 왜 생겼나 (배경 · 문제)

내러티브의 "나 축"은 *시간대 / 양상 / 상호작용* — 이건 **한 세션으로는 안 보이고 누적되어야** 드러난다 (제미나이 디벨롭 §6 Macro). 처음엔 "다중 세션 = DB(vercel/neon) 필요"로 미뤘으나, 실제로 DB가 필요한 건 *여러 기기·사용자 동기화*일 때고, **단일 브라우저 안에서의 거시 리포트는 localStorage 로 충분**하다 (사용자 지적). 그래서 데모/프로토타입 범위에서 바로 가능.

## 3. 사용자가 보는 것 (UX)

대시보드(기록 패널) 맨 위 **"다중 세션"** 섹션:
- `N개 세션 · 총 M분 읽음`
- **시간대별 인지 리듬** — 밤/오전/오후/저녁 막대. 길이 = 세션 수, 색 농도 = 평균 마찰 (딥 리딩 시간대일수록 진함).
- **마찰 추이** — 세션 순서대로 평균 마찰 스파크라인.
- **관심사** — 읽은 글 제목 빈도 칩.
- **최근 세션** — 제목 · 시각 · 분 · 마찰 · ICAP 분포(I·C·A·P).

세션이 없으면 안내 + 데모 힌트(`__layer2Demo.seedSessions()`).

## 4. 작동 원리 (기술)

- `sessions.js` 의 `initSessions()` 가 `signalBus` 에서 **`session_end`** 를 구독. 발화되면 `saveCurrentSession()`:
  - `buildSessionExport()`(sidebar) 로 그 세션의 신호 묶음을 얻고 → `refineExport()`(interpret) 로 friction/ICAP digest 계산 →
  - 요약 `{ id, t, hour, source_title, duration_ms, paragraphs, friction{mean,max,high}, icap{P,A,C,I} }` 으로 압축 →
  - `localStorage.layer2.sessions.v1` 에 append (최근 80개 유지).
- `summarizeMacro(sessions)` 가 시간대 버킷·추이·관심사·ICAP 합계를 굴린다.
- `dashboard.js` 의 `renderSessions()` 가 그걸 막대/스파크라인/목록으로 렌더. `session_end` 시 자동 갱신.
- 원본 신호가 아니라 **요약만** 저장 → 용량 작고 빠름.

## 5. 데이터 (신호 in / out)

- **구독** — `session_end`.
- **저장** — `localStorage.layer2.sessions.v1` (요약 배열).
- **외부 호출** — `buildSessionExport`(sidebar), `refineExport`(interpret).
- **API** — `window.__layer2Sessions.{ save, load, clear, summary }`.

## 6. 설계 근거 (왜 이렇게)

- **요약만 저장** — 원본 SignalLog 는 세션당 수천 줄. localStorage(~5MB)에 다 넣으면 수십 세션에서 터진다. friction/ICAP 요약은 세션당 수백 바이트.
- **session_end 훅** — 이미 sidebar 가 발화하는 신호라 추가 배선 최소.
- **localStorage** (IndexedDB 아님) — 1차 데모엔 충분. 수백 세션·여러 기기는 IndexedDB/DB(Phase 3).

## 7. 현재 상태 & 한계

**됐다 (v0.1):** session_end 누적, 시간대 막대, 마찰 추이 스파크라인, 관심사 빈도, 세션 목록, 데모 시드(`seedSessions`), 확장 빌드.

**한계 / 다음:**
- **관심사 = 제목 빈도** — 디벨롭 §6의 *크로스오버 맵*(문서 간 주석↔하이라이트 의미론적 교집합)은 미구현. 의미 분석(임베딩/LLM) 필요.
- **요일 차원 없음** — 시간대(hour)만. 요일별 리듬은 추후.
- **localStorage 한도** — 80개 cap. 진짜 누적은 IndexedDB/DB.
- **마찰 추이의 "유창함으로 수렴"** — 같은 주제 다회독을 묶어서 보여주진 않음 (세션 순서만).

## 8. 관련 파일 / 더 읽기

- **코드** — `sessions.js`, `dashboard.js` (`renderSessions`/`hourBuckets`/`sparkline`), `styles.css` (`.sess-*`), `demo.js` (`seedSessions`)
- **입력** — `interpret.js` (`refineExport`), `sidebar.js` (`buildSessionExport`, `session_end`)
- **관련 기능** — [board-mode.md](board-mode.md) (단일 세션 Micro), [친구: friction → interpret.js]
- **의사결정** — `Private/Layer2_제미나이_디벨롭_2026-06-02.md` §6 (Macro 리포트)
- **진행** — `TODO.md` 2.5.6
