# Layer 2 — 작업 메모

## 사용자 환경
- 사용자는 **GitHub Desktop**으로만 git 작업을 합니다.
- git 관련 안내는 **터미널 명령어 대신 GitHub Desktop UI 기준**으로 설명할 것.
  (예: "Branch 메뉴 → New Branch", "Push origin 버튼" 등)
- 터미널/CLI 명령어(`git checkout`, `git push` 등)를 답변에 노출하지 말 것.

## 프로젝트 상태 (2026-06-02 기준)

### 브랜치
- `main` — README.md, .gitattributes 만 있는 거의 백지 (변동 없음).
- `claude/viewer-layout` — **최신 작업 브랜치**. Phase 1 + Phase 2 + Phase 2.5 까지 누적된 본체.
  과거의 `claude/add-highlighting-interaction-qtiYn` (2026-05-09 시점) 은 더 이상 최신이 아님 — 이후
  `Cursor-portal` → `claude/blissful-maxwell-tGRv7` → 현재 `claude/viewer-layout` 로 이어졌음.
- 둘이 협업 중. 각자 본인 브랜치를 따서 작업, `claude/viewer-layout` 을 base 로 사용.

### 코드 구조 (`claude/viewer-layout` 기준)
루트 viewer (브라우저에서 직접 실행 + 확장 빌드의 소스):
- `index.html` `app.js` — 엔트리. 초기화 순서: highlight → attention → candle → dashboard → viewer shell → portal → sidebar.
- `reader.js` `pretext_helpers.js` — 본문 렌더링 + grapheme/단락 ID 부여. 모든 단락에 `[data-paragraph-id]`, 모든 글자에 `[data-char-index]`.
- `signals.js` — 신호 단일 진입점 (`pushSignal` / `signalBus` EventTarget). baseline collectors: dwell·reread (IntersectionObserver 기반), scroll, mouse_trail, circle_gesture.
- `highlight.js` — 밑줄 → 동그라미 → 주석 상태머신. `highlight_underline` / `highlight_annotation` 신호 발화.
- `attention.js` — 비활성 5s / 무활동 20s → `.article` 점진 블러. `attention_pause` / `attention_resume` 발화.
- `candle.js` ★ 2026-06-02 신규 — 촛불(Stick Candle). 신호 → 개입 프로토콜 v0.1. `candle_intervene` / `candle_dismiss` 발화.
- `viewer-shell.js` `viewer-layout.css` — 스크롤 vs 스프레드 레이아웃 전환 (CSS 클래스 토글, DOM 재사용).
- `portal.js` — 독서 모드(Pointer Lock 가상 커서). `window.__portal` 로 좌표 노출.
- `dashboard.js` — 우측 패널. `signalBus` 구독 + interpret 결과 JSON 불러오기.
- `sidebar.js` — 소스 패널 + 저장된 글 + localStorage 영속화.
- `toolbar.js` — 레거시(현재 hidden). `cursor-hud.js` — 튜닝용.
- `interpret.js` `scripts/interpret.py` — 신호 → digest → LLM 해석 (OpenAI / Anthropic / Gemini).
- `extension/` — Chrome MV3 확장. `scripts/build-extension.sh` 가 루트 viewer 를 복사·치환해 빌드 (루트 변경 시 재실행).
- `sources/` — markdown / PDF / web 소스 로더.
- `Private/` — 회의록·발화문 보존. `.gitignore` 처리됨 (`.gitkeep` 만 추적).

### 내러티브 (2026-05-27 회의에서 잠금)
- 한 문장 = **"나를 아는 독서"**.
- 두 축: 텍스트(이해도 / 내재화) × 나(시간대 / 양상·유형 / 상호작용).
- 아교: 뷰어 전환 / 촛불(독서중 AI 개입) / AI 티키타카.
- 인풋: 개념이 어려운 무거운 글 (가벼운 소설·뉴스 X).
- 자세한 결정 맥락은 `Private/Layer2_회의록_2026-05-27.md`. 발표 슬라이드는 `~/Desktop/wrks/한예종/26-1/인터랙션디자인융합/Layer 2 class/Layer 2 0602.pdf`.

### 진행 우선순위 (PDF Next Plan + Appendix 04)
- Q01 개입 타이밍 정의 — `candle.js` v0.1 임계값(45s/30s/쿨다운) 실사용 로그 보고 정식화.
- Q02 후처리 형식 결정 — 리포트 / 대시보드 / 트래커 중 택1.
- Q03 텍스트 이해도 추적/처리 — 프레임워크(논문) 선정 후 모듈 1차.
- 미루기로 결정: 디자인 비주얼 polish, 캐릭터 비주얼 추가 (촛불 외).

### 모듈 결합 메모 (브랜치 머지할 때 충돌 주의)
- `window.__portal` (portal.js 가 owner) — highlight.js / signals.js 가 읽기만.
- `window.__highlightState` (highlight.js owner) — portal.js 가 읽기.
- `window.__layer2Candle` (candle.js owner) — DevTools 데모용.
- `signalBus` — 누구나 publish, 다수 subscribe. 새 신호 type 추가는 안전.
- 고정 DOM ID: `#reader` `#ink-layer` `#annotation-host` `#sidebar` `#dashboard` `#toolbar`. 이름 바꾸면 다 깨짐.
- 고정 클래스: `.para` `.is-underlined` `.is-annotated` `.candle-mount`. 재사용 금지.
- `app.js` 의 init 순서 / `signals.js initBaselineCollectors` / `styles.css` 는 머지 핫스팟 — 분리된 섹션 유지.
