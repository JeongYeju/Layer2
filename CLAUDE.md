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
- `candle.js` ★ 촛불(Stick Candle) v0.2 — 신호 → Seam 개입 (annotation_seam + 주석 품질 휴리스틱 / reread / welcome / stuck). `candle_intervene` / `candle_dismiss` 발화. **기능 문서: `docs/features/candle.md`.**
- `viewer-shell.js` `viewer-layout.css` — 스크롤 vs 스프레드 레이아웃 전환 (CSS 클래스 토글, DOM 재사용).
- `portal.js` — 독서 모드(Pointer Lock 가상 커서). `window.__portal` 로 좌표 노출.
- `dashboard.js` — 우측 패널. `signalBus` 구독 + interpret 결과 JSON 불러오기 + 단락별 마찰 섹션 + 다중 세션 거시 리포트.
- `candle.js` `chat.js` — 촛불(개입) + AI 티키타카(왕복 대화). 내러티브 아교.
- `demo.js` — 더미 신호 생성기 (`window.__layer2Demo.seed/play/seedSessions`). 데모·검증용.
- `sessions.js` — 다중 세션 누적(`localStorage.layer2.sessions.v1`) + 거시(Macro) 리포트 요약. session_end 시 friction/ICAP 요약 저장.
- `report.js` — Micro 리포트(Mental Model Map). 대시보드 최상단 마운트. `refineExport` 로 단락별 friction/ICAP/흔적 → 한 줄 진단 + 척추 노드 + "내가 구성한 개념". LLM 불필요. `window.__layer2Report`. **기능 문서: `docs/features/mental-model-map.md`.**
- `sidebar.js` — 소스 패널 + 저장된 글 + localStorage 영속화.
- `toolbar.js` — 레거시(현재 hidden). `cursor-hud.js` — 튜닝용.
- `interpret.js` `scripts/interpret.py` — 신호 → digest → LLM 해석 (OpenAI / Anthropic / Gemini).
- `extension/` — Chrome MV3 확장. `scripts/build-extension.sh` 가 루트 viewer 를 복사·치환해 빌드 (루트 변경 시 재실행).
- `sources/` — markdown / PDF / web 소스 로더.
- `docs/features/` — 기능별 케이스 스터디 문서 (왜 생겼고 어떻게 작동하나). 인덱스 `docs/features/README.md`, 새 기능은 `_TEMPLATE.md` 복사. **공개용 — Private 회의록(왜)과 코드(어떻게) 사이의 다리.**
- `Private/` — 회의록·발화문 보존. `.gitignore` 처리됨 (`.gitkeep` 만 추적).

### 문서 관리 규칙
- **새 기능을 만들면 `docs/features/<기능>.md` 도 같이** (템플릿 8섹션: 한줄→왜→UX→기술→데이터(신호 in/out)→근거→상태/한계→링크). 코드와 같은 커밋에서 갱신 — 어긋나면 문서가 틀린 것.
- 임계값/함수명/신호명은 *실제 코드 기준*. 추정값은 "추정값, 튜닝 필요" 명시.
- 진행=`TODO.md`(Phase별), 변경 이력=`CHANGELOG.md`(최신 위로), 의사결정 맥락=`Private/*.md`(비공개), 외부 공개 설명=`docs/features/`.
- 사용자가 **"깔끔한 스타일"** 이라고 명시하면 → `Private/Figma_슬라이드_디자인시스템_범용.md` 를 먼저 읽고 그 토큰·레이아웃·워크어라운드대로 작업할 것 (Layer 2 토큰 값은 부록 A).

### 내러티브 (2026-05-27 회의에서 잠금)
- 한 문장 = **"나를 아는 독서"**.
- 두 축: 텍스트(이해도 / 내재화) × 나(시간대 / 양상·유형 / 상호작용).
- 아교: 뷰어 전환 / 촛불(독서중 AI 개입) / AI 티키타카.
- 인풋: 개념이 어려운 무거운 글 (가벼운 소설·뉴스 X).
- **차별화** — Readwise = "유창한 deep flow 진입". Layer 2 = **다회독 시 인지적 마찰 감소 + 메타인지 리포트** (2026-06-02 제미나이 디벨롭 §1 에서 확정).
- **핵심 페르소나 가설** — *"독자는 자신의 독서 패턴을 발견하기 위해 시스템의 능동적인 개입(AI 촛불)을 원하고 환영한다."* 모든 인터랙션 설계는 이 가설 아래에서.
- 자세한 결정 맥락:
  - `Private/Layer2_회의록_2026-05-27.md` — 컨셉 잠금 (1·2차 의논)
  - `Private/Layer2_제미나이_디벨롭_2026-06-02.md` — 페르소나 가설 + 5 레이어(수집/해석/뷰어/개입/리포트) 정렬
  - 발표 슬라이드: `~/Desktop/wrks/한예종/26-1/인터랙션디자인융합/Layer 2 class/Layer 2 0602.pdf`

### 핵심 프레임워크 (제미나이 디벨롭 + 2026-06-02 문헌 리뷰에서 확정)
문헌 근거(검증·가공 내역: `docs/theory-base.md`): Grusky 2017(viewport attention) · Brady et al. 2018(스크롤↔이해; 구 "Luo 2017" 오귀속 정정) · Chi&Wylie 2014(ICAP) · Mason 2024·Zhang 2025(주석 품질) · D'Mello et al. 2014·Qlarify(Fok 2024)·Hefter 2023(개입 타이밍). ※ 원 출처 `Private/Layer2_제미나이_디벨롭_2026-06-02.md` §9~§14 는 레포 밖(gitignore) — 검증본은 `docs/theory-base.md`.
- **해석 레이어 — 마찰 계수** — `interpret.js` 가 LLM 호출 *전* 에 단락별 behavioral state object 산출. raw dwell 아니라 **visibility-weighted attention** + 회귀 프록시(return_effort/reverseRate). `friction_i = z-score 합`, 임계는 **문서 내 percentile(상위 20%)** — 절대 초 단위 아님. ICAP 태깅(P<A<C<I) 으로 germane vs extraneous 분리.
- **촛불 Seam 타겟팅** — 비선형 개입 3 지점: ① annotation_seam(주석 직후, Active→Constructive 승격) / ② isolation_seam(friction 상위20% + 산출물 없음) / ③ transition_seam(섹션 종료·세션 복귀). Hefter — 지각된 interruption 수가 학습 저하 → 빈도 보수적.
- **주석 품질 = 행동 휴리스틱** (실시간 AI X / UI 라벨 X). 선택 범위 비율 + 전이 시간 + 산출물 밀도 3종으로 Constructive 판별. 데이터는 `highlight_annotation` 페이로드(char_range/transition_t/annotation_text/total_duration_ms)에 *이미 있음*. 고품질만 세션 끝 batch AI (Lazy Evaluation).
- **리포트 2 레벨** — Micro = Mental Model Map (single source). Macro = 시간대별 인지 리듬 + 관심사 크로스오버 맵 + 마찰 추이 곡선.

### 진행 우선순위 (PDF Next Plan + Appendix 04 + 디벨롭 §8)
- 촛불 v1 정식화 — Seam 3종으로 재정의. **annotation_seam(주석 직후)이 최우선 신규** — friction percentile 이 v0.1 의 45s/30s 추정값 대체.
- 마찰 계수 구현 — signals.js dwell observer 에 visibleFrac(intersectionRatio) 누적 추가 → interpret.js 에서 z-score/percentile 산출. (문헌 W1 완료, 구현 남음)
- 결과 화면 와이어 1차 — Mental Map(Micro) + 거시 대시보드 3카드.
- 보드 모드 와이어 — 텍스트 ↔ 보드 토글 + 의미론적 접기(마찰 계수 색상 위계).
- 미루기로 결정: 디자인 비주얼 polish, 캐릭터 비주얼 추가 (촛불 외).

### 모듈 결합 메모 (브랜치 머지할 때 충돌 주의)
- `window.__portal` (portal.js 가 owner) — highlight.js / signals.js 가 읽기만.
- `window.__highlightState` (highlight.js owner) — portal.js 가 읽기.
- `window.__layer2Candle` (candle.js owner) — DevTools 데모용.
- `signalBus` — 누구나 publish, 다수 subscribe. 새 신호 type 추가는 안전.
- 고정 DOM ID: `#reader` `#ink-layer` `#annotation-host` `#sidebar` `#dashboard` `#toolbar`. 이름 바꾸면 다 깨짐.
- 고정 클래스: `.para` `.is-underlined` `.is-annotated` `.candle-mount`. 재사용 금지.
- `app.js` 의 init 순서 / `signals.js initBaselineCollectors` / `styles.css` 는 머지 핫스팟 — 분리된 섹션 유지.
