# 업데이트 로그 (Layer 2)

프로젝트 변경 내역을 날짜별로 기록합니다. 최신 항목이 위로 옵니다.

---

## 2026-06-09

### 라이브 데모 + 실제 Gemini 검증
- **헤드풀 E2E 데모 영상**(`tests/demo-e2e.spec.js`) — 실제 창 + 비디오 녹화. 위→아래 정독(위아래 스크롤), 흔적 3종 실제 마우스 제스처(밑줄·**circle 단어 동그라미**·밑줄+주석), 촛불→티키타카, 보드 좌우 패닝, 회상(cloze)·내 말 요약, 대시보드까지 한 바퀴. 키 없으면 폴백으로 완주. `npm run test:live`.
- **API 키 env 주입** — `.env.local`(gitignore) → `playwright.config.js` 무의존 파서 → spec `addInitScript` 가 `localStorage(layer2.llm.*)` 에 주입. 키는 채팅/코드/git 어디에도 안 남음(`.env.example` 템플릿). 모델 오버라이드(`layer2.llm.model`)를 `chat.js`/`summary.js`/`dashboard.js` 에 추가 — env `GEMINI_MODEL` 로 선택, 없으면 기존 기본값.
- **실제 Gemini 라이브 검증** — `gemini-3-flash-preview` 로 티키타카 실제 왕복 + 내 말 요약 초안 생성 확인. (Gemini 모델 리스트 2026-06 기준 재확인: 2.5-flash/pro 안정, 3.x preview, 2.0 종료.)

### Micro 리포트 — Mental Model Map (2.5.6 Micro 완성)
- **`report.js`** — 대시보드 최상단 "이번 글 — 멘탈 모델 맵". `refineExport(SignalLog)` 로 **LLM 없이** 즉시: 한 줄 진단 + ICAP 분포 막대·흔적 통계 칩 + 읽어내려간 척추(노드=마찰%/ICAP/앵커/내 주석/흔적 수, 훑은 단락은 `⋯ N단락 훑어봄` 접기) + **"내가 내 말로 구성한 개념"**(주석 모음 = 내가 만든 멘탈 모델). 노드 클릭 → 본문 스크롤. 의미 신호마다 600ms 디바운스 갱신. 검증 `tests/report.spec.js`(헤드풀 2 pass). 문서 `docs/features/mental-model-map.md`. (Macro=sessions.js 와 짝 — 디벨롭 §6 리포트 2 레벨 완성.)

### 문서 동기화
- TODO.md 빌드 갭표를 결과(✅)로 갱신 + 2.5.2/2.5.5/2.5.6 상태 정정. CLAUDE.md 모듈 맵에 report.js 추가.

### UI 진입점 정리 (MECE 점검 후속)
- **중복 제거** — 대시보드를 열던 진입점이 헤더 "기록"(#menu-records)과 우측 레일(#btn-records) 둘이었음 → 레일 중복 제거, 헤더 "기록" 단일 진입점.
- **드로어 과잉/오인 정리** — 라벨이 틀린 "모든 도구"(#open-sources, 실제론 소스 드로어만 토글) 제거. 드로어 진입은 [열기]·[저장된 글]·접기 핸들로.
- **발견성 강화** — 헤더 우측에 "✓ 독서 끝내기"(#btn-finish) 추가. 내러티브상 핵심인 세션 종료(다중세션 누적 + 이해 점검 대화 트리거)가 사이드바 깊숙이 묻혀 있던 것을 노출. 종료 로직은 sidebar #src-session-end 위임(중복 구현 없음). icons.js 에 circle-check 추가.
- 검증 `tests/ui-entrypoints.spec.js`(헤드풀 2 pass) + recall.spec/README 셀렉터 갱신.

### recall 버그
- 회상 워크시트 자가평가(✅/❌) 클릭이 detach→버블로 대시보드 플라이아웃을 닫던 버그 수정(e.stopPropagation). 실사용 UX 버그 겸 기존 테스트 실패 해소.

### 보드(시맨틱 뷰) 흔적 → 블록 카드
- 우측 흔적을 "한 줄 텍스트 쭈루룩"에서 **"라벨+내용" 블록 카드**(`.board-block`)로 재설계 — ✎ 주석(내용)·﹏ 밑줄(실제 밑줄 문구를 인용처럼)·◯ 표시. 상태(ICAP·마찰↑)·🧠 회상은 칩으로 분리. 남아있던 흔적 카드 좌측 컬러 라인(`.board-trace--*`) 제거.

### 마찰 → 촛불 결합 + 내재화
- candle isolation_seam 에 `friction_high`(상위20%) 실시간 결합(2초 캐시 폴백). B v1.1 보드 회상(cloze)·C 보드 "내 말 요약"(`summary.js`).

### 브랜치 정리 — `claude/viewer-layout` 단일 최신 통합
- 흩어져 있던 기능 브랜치(e2e-harness · recall-worksheet · sync-extension-build · viewer-layout-fixes 등)가 모두 `claude/viewer-layout` 에 이미 병합돼 있음을 확인. main 에만 있던 **코드리뷰 노트**(`CODE_REVIEW.md`, `CODE_REVIEW_viewer-layout.md`)를 viewer-layout 으로 흡수해 **완전체**로 만들고, `main` 을 viewer-layout 으로 fast-forward(86커밋)해 둘을 동일 지점으로 동기화.
- 이후 작업은 `claude/viewer-layout` 단일 브랜치에서 진행. (병합 끝난 옛 브랜치 삭제는 환경 권한상 보류 — 필요 시 github.com Branches 탭에서 수동 정리.)

### 발표 핸드오프 — Codex 브리프
- `docs/presentation/codex-brief.md` 신규. **데모(`demo.js` 재생)와 발표를 한 흐름으로 엮는 통합 진행 스크립트**를 Codex 가 작성하도록 재료를 정리한 핸드오프 문서.
- 구성: 산출물 형식(비트 테이블 + 길이 조절 가이드) / 실제 화면 안무(데모 버튼·촛불·티키타카·보드·멀티세션 대시보드, `roleFor` 단락별 인지상태 매핑) / 재료 A 서비스·UX / 재료 B 기술 11종 / 재료 C 사고흐름·정직성 / 톤·제약.
- 설계 원칙: **3축(UX·기술·사고흐름) 균형 + 모듈식(`[핵심]`/`[선택]`)** 으로 5/10/15분 길이 조절. "코드에 있는 것만 시연·주장 / 마찰=상대값 과장 금지" 정직성 제약 명시.

---

## 2026-06-03

2026-06-03 발표 PDF(이원화 뷰어 + 촛불 3 Seam 정식 조건 + 신호 처리 3단계)를 코드로 빌드. 신호 인프라 → 촛불 Seam 정식화 → 마찰 계수 → 대시보드 → 보드 모드를 순서대로 완성, 데모에서 보이는 단계까지 끌어올렸다.

### 신호 파이프라인 정식 빌드 (단계 1~5)
- **단계1 · 신호 보강** (`signals.js`) — dwell observer 가 단락별 `enter_count`·`backwardEntry`(역방향 진입)·`visible_frac`(intersectionRatio 평균) 추적. `reread` += `reverse_rate`·`enter_count`·`scroll_top`, `dwell` += `visible_frac`. 아이트래킹 없는 인지 머뭇거림 프록시.
- **단계2 · 촛불 Seam 2/3 정식화** (`candle.js` v0.3) — v0.2 의 단순 트리거(reread visit≥2 / welcome 30s)를 PDF 정식 조건으로 교체. **isolation** = `enter_count≥3 AND reverse_rate≥0.5 AND 무흔적`(paraTraces Map 으로 단락별 밑줄·주석 유무 추적). **transition** = 탭 hidden→복귀(3s+) OR 완전 비활성 180s 복귀.
- **단계3 · 마찰 계수** (`interpret.js`+`scripts/interpret.py`) — `computeFriction`: visibility-weighted attention + revisit·return_effort·reverse_rate 를 z-score 합산, 문서 내 percentile(상위20%=`friction_high`), ICAP(P/A/C)·load(germane/extraneous/ambiguous) 태깅. 합성 세션으로 검증.
- **단계4 · 대시보드** (`dashboard.js`) — "단락별 인지 상태(마찰 계수)" 섹션. friction 상위 5단락 + ICAP/load 배지 + 클릭 시 스크롤.
- **단계5 · 보드 모드** (`viewer-shell.js`) — 3-way 뷰 토글(scroll/spread/**board**). 단락별 흔적(밑줄·동그라미·주석)을 우측 `.board-card` 로 전개, 흔적 없으면 점으로 접기(의미론적 접기), 마찰 색상 위계(좌측 보더). 새 기능 문서 `docs/features/board-mode.md`.

### AI 티키타카 (단계 6 · Phase 2.5.4) — 내러티브 아교 완성
- 촛불 말풍선에 **💬 대화** 버튼 → `candle_chat_request` 발화 → 새 모듈 `chat.js` 가 우측 슬라이드 채팅 패널을 연다. Seam(annotation/isolation/transition) + 단락 텍스트를 Anchor 로 시스템 프롬프트에 주입, 멀티턴.
- `interpret.js` 에 `chatLLM`(평문·멀티턴, provider 3종) 추가. 대시보드와 키 공유(`layer2.llm.*`).
- 대화를 `chat_opened`/`chat_turn` 신호로 기록 → interpret 이 단락별 집계 → **ICAP 의 I(Interactive) 단계 완성** (촛불 대화 > 주석 > 표시 > 체류).
- 이로써 내러티브 아교 3종(뷰어 전환 · 촛불 · 티키타카) 모두 1차 구현. 새 기능 문서 `docs/features/tikitaka.md`.

### 다중 세션 + UI 폴리시 (후반)
- **다중 세션 거시 리포트** (`sessions.js`) — session_end 마다 friction/ICAP 요약을 `localStorage` 누적 → 대시보드 "다중 세션": 시간대별 인지 리듬 막대 · 마찰 추이 스파크라인 · 관심사 칩 · 세션 목록. DB 없이 단일 브라우저로. (`docs/features/multi-session.md`)
- **보드 화이트보드** — 점 그리드 배경 + 카드로 떠 있는 블록(FigJam/AFFiNE 느낌). 좌측 컬러 보더는 "AI 카드" 클리셰라 제거 — friction 은 은은한 배경 워시, ICAP 은 우측 상태 칩으로만.
- **레이어드 그림자** — `--shadow-soft`/`--shadow-lift` (Josh-Comeau-style 멀티 box-shadow, 따뜻한 톤). 보드 카드·트레이스·촛불 풍선에 적용.
- **챗봇 폴리시** — 헤더 불꽃 아이콘 + 따뜻한 그라데이션, 타이핑 인디케이터(점 바운스), 첫 질문 맥락화(키 있으면 단락·Seam 으로 LLM 생성, 없으면 정적).
- **촛불 폴리시** — Seam 별 멘트 확대 + 등장 오버슈트.
- **엔드투엔드 검증** — headed Playwright 로 더미 시드(`__layer2Demo.seed/play/seedSessions`) → 보드 시맨틱·촛불·티키타카·다중세션 전 과정 스크린샷, pageerror 0. (QA 중 발견·수정: pagenav 안 숨겨짐 / 보드 사이드바 겹침 / 촛불이 reader overflow 에 가려 안 보이던 것 → fixed.)

### 빌드 스크립트 portable
- `scripts/build-extension.sh` 의 CDN import 치환을 `sed -i` → `perl -i` 로 (BSD/macOS·GNU/Linux 양쪽 동작).

### (오전) annotation_seam + 주석 품질 휴리스틱 (Phase 2.5.8 / 2.5.2)

W1 문헌 리뷰(16+편) 의 첫 코드 적용. 촛불에 **annotation_seam** 과 **주석 품질 행동 휴리스틱** 을 얹어, "주석 직후 + 진짜 고민이 담긴 주석에만 사유 확장 질문" 이라는 Seam 타겟팅의 첫 사례를 만들었다.

### annotation_seam + 주석 품질 휴리스틱 (Phase 2.5.8 / 2.5.2)
- `candle.js` 에 네 번째 트리거 `annotation` 추가 — `highlight_annotation` 신호 직후 발동.
- **주석 품질** 을 행동 휴리스틱 3종으로 산출 (`annotationQuality`, 0~1):
  - 선택 범위 비율 (anchor_text / 문단 글자수) — selective(15~40%) 우대, blanket(>80%) 감점 (Mason 2024)
  - 전이 시간 (textarea_appeared_t − transition_t) — 오래 망설일수록 constructive
  - 산출물 밀도 (annotation_text 길이 + 반복문자 패널티) — "ㅋㅋㅋㅋ" 필터
- 품질 ≥ 0.55 인 주석에만 촛불이 사유 확장 질문 ("방금 친 거, 왜 중요하다고 느꼈어?" 등) → Active→Constructive 승격.
- annotation 트리거는 **전역 쿨다운 우회** (사용자 능동 행동 직후 = 개입 환영도 최고). per-para 쿨다운 + 품질 임계가 spam 방지.
- **실시간 AI·UI 라벨 없이** `highlight_annotation` 페이로드만으로 동작 — 추가 신호 수집 0.
- 데모 훅 확장: `window.__layer2Candle.fire("annotation")`.

### 빌드 스크립트 portable 수정
- `scripts/build-extension.sh` 의 CDN import 치환을 `sed -i` → `perl -i` 로 교체. BSD/macOS 에서 `sed -i` 가 백업 확장자를 요구해 깨지던 문제 해결 (GNU/Linux·BSD/macOS 양쪽 동작).
- `extension/viewer/` 재빌드 — candle.js annotation_seam 반영.

> 가중치(0.4/0.3/0.3)·임계(0.55) 는 1차 추정값. 품질 계산 로직의 interpret.js 이전 + batch AI 경로(Lazy Evaluation ④)는 2.5.4 채팅 모듈과 함께. (`TODO.md` 2.5.8)

---

## 2026-06-02

오전엔 **촛불(Stick Candle) v0.1 코드** 가 들어갔고, 오후엔 **제미나이와의 디벨롭 의논** 으로 5 레이어 프레임이 정렬됐다. 같은 날 컨셉이 한 단계 더 좁혀짐:
- Readwise 와 노선 명확히 분리 → *deep flow X / 다회독 마찰 감소 + 메타인지 리포트 ○*
- 핵심 페르소나 가설 확정 → *"독자는 시스템의 능동적 개입을 원하고 환영한다"*
- 촛불 트리거 v1 정식 원칙 (**Seam 타겟팅**) 도출
- 해석 레이어에 **마찰 계수 프레임** + 리포트 2 레벨(Micro/Macro) 설계 추가

### 촛불 1차 초안 (코드 · Phase 2.5.1)
- 새 모듈 `candle.js` + `styles.css` 의 `.candle-mount` 섹션. SVG 촛대 + 흔들리는 불꽃, 단락 우측 여백에 등장.
- **개입 프로토콜 v0.1** — 신호 → 트리거 조건:
  - `stuck` (같은 단락 누적 45초), `reread` (visit_count ≥ 2), `welcome` (휴식 후 30초+ 복귀)
  - 쿨다운 — 같은 단락 2분 / 전역 25초
- 클릭 또는 12초 무반응 시 **후~** 애니메이션 (불꽃 → 연기) 후 소멸. 새 소스 로드 시 자동 제거.
- 새 신호 두 개: `candle_intervene`, `candle_dismiss` — 향후 interpret.py · 대시보드가 활용 가능.
- DevTools 데모 훅: `window.__layer2Candle.fire("stuck"|"reread"|"welcome")`.
- `scripts/build-extension.sh` 의 `CORE_FILES` 에 `candle.js` 추가 — 확장 빌드도 같이 따라감.

### 제미나이 디벨롭 — 5 레이어 정렬 (의논 · Phase 2.5 전반)
새 의논록: `Private/Layer2_제미나이_디벨롭_2026-06-02.md` (G-1 ~ G-6 결정).
- **G-1 페르소나 가설** — 능동적 개입을 환영하는 독자. 모든 인터랙션 설계의 출발점.
- **G-2 목표 재설정** — Readwise = deep flow / Layer 2 = 다회독 마찰 감소 + 메타인지 리포트.
- **G-3 해석 프레임** — 단락별 **3단계 양상(스캐닝 / 유창 / 마찰)** + 마찰 계수 산출. 인지심리 논문 1~2개로 근거화 필요.
- **G-4 뷰어 모드** — 텍스트 모드 ↔ 보드 모드 (CSS 클래스 토글) + 블록 색상 위계(마찰 계수) + 의미론적 접기.
- **G-5 촛불 Seam 타겟팅** — 비선형 개입 3 지점:
  1. 능동적 정지 (`highlight_annotation` 직후) — v0.1 에 없음, 추가 예정.
  2. 인지적 고립 (reread 누적) — v0.1 의 stuck + reread 통합.
  3. 세션 전환점 (휴식 후 복귀) — v0.1 의 welcome 유지.
- **G-6 리포트 2 레벨** — Micro = Mental Model Map / Macro = 시간대 인지 리듬 + 관심사 크로스오버 맵 + 마찰 추이 곡선.

### 파일 변경
- `TODO.md` Phase 2.5 를 2.5.1~2.5.7 로 확장 (Seam 정식화 / 보드 모드 / 티키타카 / 마찰 프레임 / 다회독 리포트 / Active Zone 프록시).
- `CLAUDE.md` 내러티브 섹션에 차별화 노선 + 페르소나 가설 + 핵심 프레임워크 블록 추가.
- `Private/Layer2_제미나이_디벨롭_2026-06-02.md` 신규.

> v0.1 임계값(45s / 30s / 쿨다운)은 추정값. v1 (`TODO.md` 2.5.2) 에서 Seam 타겟팅으로 정식화하면서 실측 로그로 튜닝.

---

## 2026-05-26

프로토타입 → **멀티소스 리더 + 신호 수집/해석 + 브라우저 확장**으로 한 단계 확장.
작업 브랜치: `Cursor-portal`(베이스, Phase 1 + 포탈 튜닝) → `claude/blissful-maxwell-tGRv7`(Phase 2 이후).
규모: 약 17,000줄 추가, `scripts/` · `sources/` · `extension/` 디렉터리 신설.

### 1. 뷰어 구조 전환 (Phase 1 · `Cursor-portal`)
- 단일 프로토타입 → **사이드바 기반 멀티소스 뷰어**. 샘플 글 / 마크다운·PDF 파일 / 기사 URL 불러오기.
- 독서모드(포탈) 다듬기: 줄-스냅 stickiness 슬라이더, 텔레포트 기준을 glyph 줄로, 웹 fetch 실패 시 CORS 프록시 폴백.

### 2. 신호 내보내기 & 해석 파이프라인 (Phase 2.1~2.3)
- **2.1** 독서 세션(소스 + 신호)을 JSON 한 덩어리로 **내보내기**. 문단 끝에서 커서가 갇히던 버그 수정.
- **2.2** `scripts/interpret.py` — 의존성 없는(파이썬 표준 라이브러리만) **독서 세션 해석 CLI**.
- **2.3** 대시보드에 **AI 해석 패널** — interpret 결과 JSON을 불러와 표시.

### 3. Chrome 확장프로그램 (Phase 2.4)
- MV3 확장: 현재 페이지 본문을 직접 추출 → **"지금 읽기"**(번들 뷰어 즉시 열기) + **"저장"**(북마크).
- 빌드 스크립트(`scripts/build-extension.sh`)가 루트 뷰어를 확장용으로 복사하며 CDN import를 로컬로 치환. **진짜 pretext를 npm에서 벤더링**해 단어 기준 로깅 유지.
- localhost 뷰어에 붙는 content-script **브리지** → 사이드바 "저장된 글" 목록에서 클릭 로드 / 삭제.

### 4. 영속화
- 소스 목록 · 현재 소스 · **소스별 스크롤 위치**를 localStorage에 저장 (새로고침해도 유지).

### 5. 독서 세션 자동화 & 주의(attention)
- 글 불러오면 **세션 자동 시작** (시작 버튼 제거, 진행 중에도 내보내기 가능 → 유실 없음).
- 탭 비활성 5초 / 무활동 20초 → 본문 **점진 블러(휴식 모드)**. 스크롤·키·클릭은 즉시, 커서는 일정 거리 움직여야 해제. 사이드바에 **"독서 중 / 휴식 중"** 표시.

### 6. 커서·포탈 마무리 튜닝 + 버그픽스
- 라인브레이크 앵글 **33°**, 연필 글리프 회전 조정(기본모드 180°, 독서모드 360°).
- 독서모드 밑줄이 줄바꿈 텔레포트 때 **다음/이전 줄로 끊김 없이 이어지도록**(정·역방향) 수정. 역방향에서 잘못된 주석 모드가 발동하던 문제 해결.
