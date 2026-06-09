# 보드 모드 (Board Mode / 이원화 뷰어)

> **한 줄** — 같은 글을 두 가지로 본다. **텍스트 모드**는 본문에 집중하는 선형 읽기, **보드 모드**는 원문을 왼쪽에 고정하고 내가 남긴 흔적(밑줄·동그라미·주석)을 *단락 오른쪽으로 펼쳐* 보여주는 화이트보드+대시보드 뷰.

| | |
|---|---|
| **상태** | v0.1 (1차 구현 — 토글·흔적 카드·의미론적 접기·마찰 색상) |
| **핵심 파일** | `viewer-shell.js`, `styles.css` (`.mode-board` 섹션), `index.html` (토글 버튼) |
| **발화 신호** | (없음 — 읽기 전용 뷰) |
| **구독 신호** | `highlight_underline`, `highlight_annotation`, `circle_gesture` (실시간 카드 갱신) |
| **TODO** | `TODO.md` Phase 2.5.3 |

---

## 1. 한 줄 요약

상단 토글에 세 번째 뷰가 생겼다 — 스크롤 / 스프레드 / **보드**. 보드 모드로 바꾸면 본문 칼럼이 왼쪽으로 정렬되고, 각 단락 오른쪽에 *그 단락에서 내가 한 일*(밑줄, 동그라미, 주석)이 카드로 펼쳐진다. 흔적이 없는 단락은 작은 점 하나로 접힌다. 치열하게 읽은(마찰이 큰) 단락일수록 배경이 은은하게 따뜻한 색으로 물든다 — 별도로 "해석하기"를 누를 필요 없이 실시간으로.

## 2. 왜 생겼나 (배경 · 문제)

"나를 아는 독서"는 *읽은 흔적을 다시 나에게 비춰주는* 것이 핵심이다. 그런데 선형 읽기 화면에서는 흔적이 본문에 묻혀 한눈에 안 들어온다. 2026-06-03 발표(이원화 뷰어)에서 **같은 콘텐츠를 다른 표현으로 전환**하자고 정했다 — 읽을 땐 텍스트 모드, 돌아볼 땐 보드 모드. AFFiNE("같은 콘텐츠 ≠ 같은 표현")가 레퍼런스. 보드 모드는 *독서 1회의 메타인지*를 위한 뷰다.

## 3. 사용자가 보는 것 (UX)

1. 상단 오른쪽 뷰 토글에서 **보드** 클릭.
2. 본문이 왼쪽으로 정렬되고, 오른쪽에 흔적 카드 영역이 열린다.
3. 밑줄/주석/동그라미를 남긴 단락 옆에 카드가 뜬다 — 주석은 내용 그대로, 밑줄·동그라미는 라벨로.
4. 흔적 없는 단락은 점 하나로 접혀 시각적 잡음을 줄인다 (의미론적 접기).
5. 보드 모드에서 새로 밑줄/주석을 그으면 카드가 즉시 갱신된다.
6. 보드 진입 즉시(해석하기 없이) 마찰이 큰 단락일수록 배경이 따뜻하게 짙어진다.

## 4. 작동 원리 (기술)

`viewer-shell.js`의 `setMode("board")`가 `#reader`에 `.mode-board` 클래스를 토글한다 (scroll/spread와 같은 패턴 — **DOM 재생성 없음**, CSS만). 모드 진입 시 `renderBoardCards()`:

- 모든 `.para[data-paragraph-id]`를 순회.
- `collectTraces(para)` — DOM에서 그 단락의 흔적을 읽는다: `.anno-marker .anno-tooltip`(주석 텍스트), `.is-annotated`/`.is-underlined`(밑줄), `.word-circle-mark`(동그라미). highlight.js가 남긴 시각 흔적을 *그대로 재활용* — 새 신호 수집 없음.
- 흔적 있으면 `.board-card`를 `.para` 자식으로 `position:absolute`(left:100%) 배치, 없으면 `.board-dot`.
- 흔적은 한 줄짜리가 아니라 **"라벨 + 내용" 블록 카드**(`.board-block`)로 쌓는다: ✎ 주석(내가 쓴 글), ﹏ 밑줄(실제 밑줄 친 문구를 인용처럼), ◯ 표시(동그라미). 상태(ICAP·마찰)와 🧠 회상은 작은 칩으로 분리.
- `frictionByPid()` — `window.__lastInterpretation.refined.paragraphs`에서 `friction_pct`를 읽어 단락에 `--friction-pct` CSS 변수 설정 → 배경 워시 농도. (실시간 경로는 §7 참조)
- 보드 모드인 동안 `signalBus`를 구독해 highlight/annotation/circle 신호가 오면 200ms 디바운스 후 재렌더.

다른 모드로 나가면 `clearBoardCards()`가 카드·점·클래스를 모두 제거한다.

## 5. 데이터 (신호 in / out)

- **발화** — 없음. 보드 모드는 순수 표현 전환이라 신호를 만들지 않는다.
- **구독** — `highlight_underline` / `highlight_annotation` / `circle_gesture` (실시간 카드 갱신용).
- **외부 읽기** — `window.__lastInterpretation` (dashboard.js가 interpret 결과를 노출 → 마찰 색상). 없으면 색상만 생략, 나머지는 정상.
- DOM 계약: `.anno-marker .anno-tooltip`, `.is-annotated`, `.word-circle-mark` (highlight.js 소유). 이 클래스명이 바뀌면 흔적 수집이 깨진다.

## 6. 설계 근거 (왜 이렇게)

- **CSS 클래스 토글 + DOM 보존** — scroll/spread와 동일 패턴. 신호 collector·dwell observer·하이라이트 상태가 모드 전환에도 살아있게.
- **DOM 흔적 재활용** (신호 재수집 X) — 흔적의 *진실*은 이미 화면에 그려져 있다. board는 그걸 우측으로 재배치만.
- **의미론적 접기** (제미나이 디벨롭 §4) — 우측이 무한히 늘어나 가로 스크롤이 강제되는 인지 과부하 방지. 흔적 있는 단락만 카드, 나머지는 점.
- **마찰 색상 위계** — 단락별 friction(→ [friction 단계, interpret.js])을 색 농도로. "어디를 치열하게 읽었나"가 한눈에.

## 7. 현재 상태 & 한계

**됐다 (v0.1):** 3-way 토글, 흔적 카드(밑줄·동그라미·주석), 실시간 갱신, 의미론적 접기(점), 마찰 색상 위계, localStorage 모드 영속, 확장 빌드 반영.

**B v1.1 — 보드 회상(cloze):** 밑줄 있는 단락 카드에 "🧠 회상" 버튼 → 그 단락 밑줄을 인플레이스 cloze(문장 빈칸+정답+자가평가)로. `recall.js` `sentenceContaining` 재사용, `recall_attempt`(mode: board_cloze) 발화. 능동 인출=내재화(이론: docs/theory-base.md §B). 검증 `tests/board-recall.spec.js`. (live refresh 에서 dwell/reread 제외 — 열린 cloze 보존.)

**C — 보드 "내 말 요약":** 보드 상단 패널(`summary.js`). 세션의 주석·밑줄·티키타카를 모아 `chatLLM` 1인칭 요약 초안(키 없으면 흔적 폴백) → textarea 편집은 소스별 `localStorage` 자동저장. 편집(생성·정교화)이 곧 내재화. `summary_draft` 발화. 검증 `tests/board-summary.spec.js`.

**한계 / 다음:**
- **활성 단락 확대 미구현** — 디벨롭 §4의 "활성 블록만 펼치고 지나간 건 압축"은 아직 균일. 현재는 흔적 유무로만 접기.
- ~~마찰 색상은 batch 후에만~~ → ✅ **실시간 시맨틱** (2026-06-03): 보드 진입 시 `refineExport(buildSessionExport())` 로 현재 SignalLog 에서 friction/ICAP 즉시 계산 → 문단마다 *마찰 배경 톤(은은) × ICAP 상태 칩*. (좌측 컬러 보더는 "AI가 만든 카드"처럼 보여서 제거 — 마킹은 배경/칩으로만.) 해석하기 없이도 시맨틱 뷰. (LLM 해석 결과가 있으면 폴백으로 사용.)
- **흔적 = 블록 카드** (2026-06-09): 우측 흔적을 한 줄 텍스트에서 "라벨+내용" 블록(`.board-block`)으로 재설계 — 밑줄 블록은 실제 밑줄 친 문구를 인용처럼 담고(밑줄 하이라이트 포함), 주석 블록은 내가 쓴 글, 상태·회상은 칩으로 분리. ("태그+여러 줄 쭈루룩" 인상 제거.)
- **데모 시드** — `window.__layer2Demo.seed()`(즉시) / `.play()`(시간순 재생 → 촛불·티키타카 자연 발동)로 더미 독서 신호를 채워 전체 흐름을 체감 (demo.js).
- **AI 티키타카 카드 자리뿐** — 보드의 "대화" 카드는 2.5.4 채팅 모듈이 서야 채워진다.
- **좁은 화면** — 우측 360px 고정이라 좁은 뷰포트에서 가로 스크롤. 반응형 미흡.
- **독서 모드(포탈)와 동시 사용** 미검증.

## 8. 관련 파일 / 더 읽기

- **코드** — `viewer-shell.js` (`setMode`/`renderBoardCards`/`collectTraces`), `styles.css` (`.mode-board`), `index.html` (토글), `icons.js` (`layout-grid`)
- **흔적 출처** — `highlight.js` (`.anno-marker`/`.is-annotated`/`.word-circle-mark`)
- **마찰 색상** — `interpret.js` (`computeFriction`), `dashboard.js` (`window.__lastInterpretation`)
- **의사결정** — `Private/Layer2_제미나이_디벨롭_2026-06-02.md` §4, 2026-06-03 발표 PDF (이원화 뷰어)
- **진행** — `TODO.md` 2.5.3
