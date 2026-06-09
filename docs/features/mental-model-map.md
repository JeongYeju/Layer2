# 멘탈 모델 맵 (Mental Model Map / Micro 리포트)

> **한 줄** — 글 하나를 다 읽고 나면, 내가 *어디서 치열했고 무엇을 내 말로 남겼는지*를 한 화면 지형도로 비춰준다. 읽어내려간 "척추(spine)" 위에 마찰이 높았던 구간과 내가 구성한 개념(주석)을 노드로 세우고, 훑고 지나간 단락은 접는다.

| | |
|---|---|
| **상태** | v0.3 (진단·요약·척추·구성한 개념 + 개념 엣지: 어휘→의미 임베딩) |
| **핵심 파일** | `report.js`, `styles.css`(`.microreport`/`.rp-*`), `dashboard.js`(마운트) |
| **발화 신호** | (없음 — 읽기 전용 리포트) |
| **구독 신호** | `highlight_underline`/`highlight_annotation`/`circle_gesture`/`chat_turn`/`recall_attempt`/`session_end` (갱신 트리거) |
| **데이터원** | `refineExport(buildSessionExport())` — interpret.js 단락별 friction·ICAP·흔적 |
| **TODO** | `TODO.md` 2.5.6 (Micro) |

---

## 1. 한 줄 요약

기록 패널(대시보드) 맨 위에 **"이번 글 — 멘탈 모델 맵"** 섹션이 있다. 지금 읽고 있는(또는 방금 읽은) 글 하나에 대해 **LLM 없이** 즉시 그려진다: 한 줄 진단 → ICAP 분포 막대 + 흔적 통계 칩 → 글을 읽어내려간 척추 위의 노드(치열했던 곳·표시·주석·대화) → "내가 내 말로 구성한 개념" 목록. 노드를 누르면 본문 그 단락으로 스크롤한다.

## 2. 왜 생겼나 (배경 · 문제)

내러티브의 한 축은 **"나(메타인지)"** 다 — 다 읽고 났을 때 *나는 이 글을 어떻게 읽었나*를 돌려주는 게 "나를 아는 독서"의 핵심. 디벨롭(§6)에서 리포트를 2 레벨로 잠갔다: **Macro = 다회독 거시(시간대 리듬·마찰 추이)**, **Micro = 단일 소스의 Mental Model Map**. Macro 는 `sessions.js` 로 먼저 구현됐고(다중 세션), **Micro 는 보드 모드가 "흔적의 어디"를 보여줄 뿐 한 화면 요약(무엇을 남겼나)이 비어 있었다.** 이 문서의 기능이 그 빈칸을 채운다.

## 3. 사용자가 보는 것 (UX)

1. 글을 읽으며 밑줄·주석·동그라미·촛불 대화를 남긴다.
2. 좌측 메뉴 **기록**(`#menu-records`)을 열면 우측 패널 맨 위에 멘탈 모델 맵이 떠 있다.
3. **한 줄 진단** — "표시 위주로 읽었어요. 한 곳을 골라 *내 말로* 적어보면 내재화가 깊어집니다." 같은 경향 요약.
4. **요약 줄** — ICAP(훑어봄/표시/구성/대화) 비율 막대 + `﹏ 밑줄 N`·`✎ 주석 N`·`◯ 표시 N`·`💬 대화 N`·`🧠 회상 N`·`마찰 상위 N곳` 칩.
5. **척추** — 위에서 아래로 읽은 순서. 흔적·마찰이 있는 단락은 카드 노드(ICAP 칩 + 마찰 상위 N% + 앵커 문구 + 내 주석 + 흔적 수), 훑고 지나간 단락은 `⋯ N단락 훑어봄`으로 접힘.
6. **내가 내 말로 구성한 개념** — 주석(Constructive 산출)만 모은 목록. *이게 내가 이 글에서 실제로 만든 멘탈 모델*.
7. 어떤 노드·개념이든 누르면 본문 해당 단락으로 스크롤 + 깜빡임.

## 4. 작동 원리 (기술)

`report.js` `initReport({mountEl})` 가 대시보드의 `#m-microreport` 에 마운트된다(`dashboard.js`). 렌더는 `signalBus` 의 의미 있는 신호(밑줄·주석·동그라미·대화·회상·세션종료)마다 600ms 디바운스로 갱신.

- `safeData()` — `refineExport(buildSessionExport())` 로 현재 SignalLog 에서 단락별 behavioral state 를 즉시 산출(보드 모드와 같은 경로, **LLM 호출 없음**). friction·friction_pct·friction_high·icap_mode·load_tag + 단락별 `highlights[]`·`annotations[{on,note}]`·`chat_turns`.
- `isNode(p)` — friction_high 이거나 흔적(주석·밑줄·동그라미·대화)이 있거나 ICAP ≥ C 인 단락만 노드. 나머지는 연속 카운트해 `⋯ N단락 훑어봄` 으로 접는다(의미론적 접기).
- `nodeHTML(p)` — 앵커는 **주석 > 밑줄 텍스트 > 본문 앞 46자** 순. 본문은 DOM(`[data-char-index]`)에서 직접 읽어 안전. `topPct = (1−friction_pct)·100` 로 "마찰 상위 N%".
- `diagnose()` — 행동 증거를 한 줄로 압축(절대 분류기 아님): constructive(C+I)+마찰 동반 → germane, 마찰만 높고 산출 없음 → 막힘, 표시 우세 → 내재화 권유.
- "구성한 개념" = 전 단락의 주석을 모은 것. 클릭 시 `scrollToPara`.
- **개념 엣지 — 2단계(어휘 → 의미)**:
  - **어휘(즉시·무료, 기본)** — `contentTokens()` 가 노드별 흔적(주석·밑줄, 없으면 본문)에서 내용 단어를 뽑고(한국어 조사 제거 + 불용어 + 2글자↑), `computeEdges()` 가 단락쌍의 **공유 단어**로 잇는다(idf 가중 + 제목어 df>60% 제외 + 노드당 최대 2). 렌더 즉시 그려진다.
  - **의미(임베딩, 키 있으면 업그레이드)** — `maybeSemantic()` 이 패널이 보일 때 노드 원문을 `gemini-embedding-001`(`batchEmbedContents`)로 임베딩 → **코사인 유사도**로 잇는다. 공유 단어 0인 **동의어·의역**도 연결(예: "디지털 읽기의 마찰" ↔ "스크린에서 글 읽을 때 느끼는 어려움" cos≈0.77). 이 모델은 baseline 코사인이 높아 임계는 **문서 내 상대(평균+0.3σ) + 절대 바닥 0.68**, 노드당 최대 2. 비용 보호: 패널 보일 때만 / `_embCache` 재임베딩 X / 1s 디바운스 / 노드셋 동일하면 skip.
  - `drawEdges()` 가 노드 dot y 를 실측해 좌측 거터에 SVG 호(굵기·투명도 ∝ 가중치, hover 시 공유 단어 또는 "의미 유사 NN%"). 패널 숨김→보임은 ResizeObserver/플라이아웃 open 으로 재측정·업그레이드. 범례가 현재 모드("어휘 중첩" vs "임베딩")를 표기 — 정직성.

## 5. 데이터 (신호 in / out)

- **발화** — 없음(읽기 전용).
- **구독** — `highlight_underline`/`highlight_annotation`/`circle_gesture`/`chat_turn`/`recall_attempt`/`session_end` → 디바운스 재렌더.
- **외부 읽기** — `buildSessionExport()`(sidebar.js) → `refineExport()`(interpret.js). DOM: `[data-paragraph-id]`/`[data-char-index]`(앵커 텍스트·스크롤).
- **외부 호출(선택)** — 의미 엣지: `gemini-embedding-001` `batchEmbedContents`, 키는 `localStorage.layer2.llm.{provider,key}`(대시보드 'AI 해석'·티키타카와 공유).
- 전역 훅: `window.__layer2Report.render()`.

## 6. 설계 근거 (왜 이렇게)

- **코어는 LLM 불필요** — 마찰·ICAP·척추·진단·어휘 엣지는 행동 신호의 결정적 산출(percentile·z-score·어휘 중첩)이라 즉시·무료·오프라인. **의미 엣지만 선택적 업그레이드**(키 있을 때 임베딩) — 없어도 리포트는 온전.
- **척추 + 접기** — 글의 선형 순서를 보존하되, 인지적으로 의미 있는 곳만 노드로(보드의 의미론적 접기와 같은 원리). 한 화면에 "내가 읽은 모양"이 들어온다.
- **주석 = 멘탈 모델** — ICAP 의 Constructive 산출(내 말로 다시 쓰기)이 곧 내가 만든 개념. 이걸 따로 모아 보여주는 게 "나를 아는" 핵심(Chi&Wylie).
- **진단은 경향, 분류 아님** — germane/extraneous 를 행동만으로 단정하지 않고 권유형 한 줄로(2.5.5 의 "행동 증거 압축기" 원칙).

## 7. 현재 상태 & 한계

**됐다 (v0.3):** 한 줄 진단, ICAP 막대 + 통계 칩, 척추 노드, 훑은 구간 접기, "내가 구성한 개념", **개념 엣지 — 어휘(기본) + 의미 임베딩(키 있으면 동의어·의역까지)**, 노드 클릭 스크롤, 폴백, 실시간 갱신. 검증 `tests/report.spec.js`(어휘 3 pass) + 키 주입 시 의미 엣지 수동 검증.

**한계 / 다음:**
- **의미 엣지 = Gemini 임베딩 전송** — 의미 모드는 단락 흔적 텍스트를 `gemini-embedding-001` 로 보낸다(브라우저 직접 호출). **데모/로컬 전용** — 배포 시 서버 프록시 + 사용자 동의 필요(Phase 3). 키 없으면 어휘 모드로 자동 폴백(데모 안 깨짐).
- **임계는 미보정 휴리스틱** — 0.68 바닥 + 평균+0.3σ 는 1차값. 문서·모델에 따라 튜닝 필요.
- **회상 성공률 미반영** — `recall_attempt` 횟수만 칩으로, 성공/실패 분포는 아직.
- **Macro 와의 연계** — 같은 소스의 지난 세션 대비(재독 디프)는 보류 합의(HANDOFF).
- 좁은 패널 폭 기준 — 긴 주석은 줄바꿈으로 처리.

## 8. 관련 파일 / 더 읽기

- **코드** — `report.js`(`initReport`/`render`/`build`/`nodeHTML`/`diagnose`), `dashboard.js`(`#m-microreport` 마운트), `styles.css`(`.microreport`/`.rp-*`)
- **데이터원** — `interpret.js`(`refineExport`/`computeFriction`), `sidebar.js`(`buildSessionExport`)
- **자매 리포트** — [multi-session.md](multi-session.md)(Macro), [board-mode.md](board-mode.md)(흔적의 "어디")
- **이론** — `docs/theory-base.md`(friction percentile, ICAP), `Private/Layer2_제미나이_디벨롭_2026-06-02.md` §6
- **진행** — `TODO.md` 2.5.6
