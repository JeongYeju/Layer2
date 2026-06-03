# Layer2 viewer — TODO

## Phase 2 (오늘 밤)

- [x] "독서 끝내기" 버튼 (sidebar 현재 소스 카드)
- [x] 독서 세션 **자동 시작** + 주의(attention) 감지 블러
  - 글이 불러와지면 세션 자동 시작 (시작 버튼 없이 기본 "독서 종료"만). 시작을 안 눌러도 유실 없게, 내보내기는 진행 중 세션도 처리(`ongoing:true`)
  - `attention.js`: 탭 비활성 5초(`away`) 또는 활동 없이 20초(`idle`) → `.article` 점진 블러(CSS transition). 스크롤/휠/키/클릭 = 즉시 해제, 커서는 80px 이상 움직여야 해제. `attention_pause`/`attention_resume` 신호 기록
- [x] **2.1** SignalLog + source content + meta 를 한 JSON으로 묶어서 다운로드
  - sidebar "현재 소스" 카드의 `⬇ 내보내기` 버튼
  - 가장 최근 session_start~session_end 구간만 잘라서 내보냄 (마커 포함)
  - 스키마: `{ version, exported_at, session{start_t,end_t,source_id,source_kind,source_title,duration_ms}, source, signals[] }`
- [x] **2.2** Python CLI script (`scripts/interpret.py`) — 의존성 없음(stdlib만)
  - [x] 1차: SignalLog 정제 — mouse_trail 다운샘플, dwell/reread 문단별 집계, paragraph_id·char_range → 본문 텍스트 해석, scroll 요약, 시간순 timeline
  - [x] 2차: 정제된 digest + 본문 → LLM(OpenAI / Anthropic) → 해석(어디서 멈췄나/막혔나/관심사). `--no-llm` 또는 API 키 없으면 건너뜀
  - [x] 결과 JSON 출력 (`-o` 또는 stdout)
  - input 은 2.1 export JSON 을 그대로 받음
  - 사용: `python scripts/interpret.py session.json -o result.json` (키: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`)
- [x] **2.3** viewer에서 결과 JSON 불러와서 대시보드에 표시
  - 대시보드 상단 "AI 해석" 섹션 + `불러오기` 파일 버튼 (interpret.py 결과 JSON)
  - 요약 / 몰입도 배지 / 멈춘 곳 / 막힌 곳 / 관심사 / 메모 렌더
  - LLM 해석 없으면(`--no-llm`) refined digest 로 폴백 (가장 오래 머문 문단)
  - finding 클릭 → 리더에서 해당 문단으로 스크롤 + 플래시
  - ⚠ 브라우저 실렌더 테스트 미완 (이 환경에 headless 브라우저 없음 — 로컬에서 확인 필요)
- [x] **2.4** Chrome MV3 확장프로그램 (`extension/`) — "지금 바로 동작" 버전 (Readability 없이 자체 추출기)
  - 구조:
    ```
    extension/
      manifest.json       # MV3, permissions: activeTab, scripting, storage
      background.js       # 단축키(Ctrl/Cmd+Shift+L) → 추출+뷰어 열기
      extract.js          # 자체 본문 추출기(live DOM → Source 블록 모델) + capture 플로우
      popup.html/.js      # "이 글을 Layer2로 읽기" 버튼
      src/                # 손으로 쓴 CSP-safe 소스 (빌드 입력)
        boot-ext.js       #   chrome.storage 에서 source 읽어 viewer 부팅
        vendor/*-stub.js  #   pretext/readability/pdf/markdown CDN 대체 stub
      viewer/             # scripts/build-extension.sh 가 루트 viewer 복사+import 치환해서 생성
    ```
  - 두 가지 모드 (팝업 버튼 / 단축키 둘 다):
    - **지금 읽기**: extract → `layer2Source` 저장 → 새 탭에 번들 `viewer/index.html` → boot-ext.js 주입 → 읽기 → 2.1 내보내기
    - **저장 (북마크)**: extract → `layer2Library` 에 적재(최근 30, URL 중복 제거). 단축키 `save-to-layer2`(기본 키 없음, chrome://extensions/shortcuts 에서 지정)
  - 북마크 브리지: `content-bridge.js`(content script, `http://localhost/*` · `127.0.0.1/*`)가 `chrome.storage` 라이브러리를 postMessage 로 뷰어에 중계 → 사이드바 "저장된 글" 섹션에서 클릭 로드 / × 삭제. ready·list 핸드셰이크 양방향이라 주입 타이밍 안전. 확장 없으면 섹션 숨김.
  - Vercel 호스팅하면 그 주소를 manifest content_scripts matches 에 추가하면 됨
  - CDN/CSP 처리: MV3 는 원격 모듈 import 금지 → 빌드 스크립트가 esm.sh import 치환. **pretext 는 npm 에서 진짜 모듈을 벤더링**(`extension/src/vendor/pretext/`, MIT, 런타임 의존성 없음)해서 단어 기준 커서 로깅 그대로 유지. readability/pdf/markdown 로더만 stub (주입 소스 플로우에선 미사용).
  - 로드 방법: Chrome → `chrome://extensions` → 개발자 모드 ON → "압축 해제된 확장 프로그램 로드" → `extension/` 폴더 선택
  - ⚠ 빌드 주의: 루트 viewer(*.js, index.html, styles.css) 수정 후엔 `bash scripts/build-extension.sh` 재실행해야 `extension/viewer/` 반영됨
  - ⚠ 브라우저 실테스트 미완 (이 환경에 headless 브라우저 없음 — Chrome 에 로드해서 확인 필요). 본문 추출 품질은 사이트마다 편차 있음 → 나중에 Readability 벤더링으로 업그레이드
- [x] 세션 localStorage 영속화 (새로고침해도 소스 목록 / 마지막 위치 유지)
  - sidebar.js: `loaded` 목록 + 현재 소스 → `layer2.sources.v1` (최근 20개, best-effort)
  - app.js: 소스별 스크롤 위치 → `layer2.scroll.v1`, 소스 열 때 복원 (읽기모드 중 스크롤은 기록 안 함)
  - 우선순위: 확장 주입 소스 > 영속 상태 > 샘플

## Phase 2.5 (내러티브 — "나를 아는 독서")

2026-05-27 회의 ("나를 아는 독서" 잠금) + 2026-06-02 제미나이 디벨롭 (페르소나 가설 + 다회독 framing + Seam 타겟팅 + 마찰 프레임) 까지 반영. 자세한 맥락은 `Private/Layer2_회의록_2026-05-27.md` + `Private/Layer2_제미나이_디벨롭_2026-06-02.md`.

핵심 페르소나 가설(확정): *"독자는 자신의 독서 패턴을 발견하기 위해 시스템의 능동적인 개입(AI 촛불)을 원하고 환영한다."*

차별화 노선: Readwise = "유창한 deep flow 진입". Layer 2 = **다회독 시 인지적 마찰 감소 + 메타인지 리포트**.

- [x] **2.5.1** 촛불(Stick Candle) 1차 초안 — 신호 기반 개입의 의인화
  - `candle.js` + `styles.css` 의 `.candle-mount` 섹션. `.para` 우측 여백에 등장 → 멘트 → 후~ 사라짐 (SVG flame flicker + smoke).
  - **개입 프로토콜 v0.1** (정식 정의는 2.5.2 — 이건 첫 시도):
    - `stuck` — 같은 단락 viewport 중앙에 누적 45초
    - `reread` — `visit_count ≥ 2` (signals.js 의 reread 신호)
    - `welcome` — `attention_resume.paused_ms > 30s`
  - 쿨다운: 같은 단락 2분 / 전역 25초. 클릭 또는 12초 무반응 시 후~ 소멸. 새 소스 로드 시 제거.
  - 데모 훅: `window.__layer2Candle.fire("stuck"|"reread"|"welcome")` (DevTools 에서).
  - 새 신호 추가: `candle_intervene`, `candle_dismiss` — 이후 interpret/대시보드에서 활용 가능.
- [ ] **2.5.2** 개입 프로토콜 v1 — Seam 타겟팅으로 정식화 (제미나이 디벨롭 §5)
  - 읽기의 물리적 관성을 *부자연스럽게 꺾지 않는* 경계면 3종에서만 비선형 삽입:
    - **Seam 1 · 능동적 정지** — `highlight_annotation` confirm *직후* (사유 확장 질문). v0.1 에 없음 → 추가 필요.
    - **Seam 2 · 인지적 고립** — reread 누적 (단독 또는 dwell 결합) (개념 연결 도움). v0.1 의 `stuck` + `reread` 통합.
    - **Seam 3 · 세션 전환점** — 챕터 종료 / 휴식 후 복귀 (요약 + 환기). v0.1 의 `welcome` 유지.
  - 멘트 풀 확장 (현재 reason 당 3개 → Seam 별 톤 가이드 + 5~7개) + 페르소나 톤 일관성
  - "X 해볼까?" → AI 티키타카 트리거로 연결 (촛불 클릭 → 2.5.4 채팅 호출)
  - v0.1 임계값(45s/30s/쿨다운) 은 추정 — 실제 사용 로그 보고 튜닝
- [ ] **2.5.3** 뷰어 전환 — 텍스트 모드 ↔ 보드 모드 (제미나이 디벨롭 §4)
  - 텍스트 모드 = 글 + 작은 인덱스만. 보드 모드 = 중앙 칼럼 + *우측으로 상호작용 흔적이 늘어남* (화이트보드 + 대시보드 느낌).
  - `viewer-shell.js` 패턴 따라가기 — CSS 클래스 토글 + DOM 보존 (scroll/spread 와 같은 구조).
  - **시각적 위계 (Density)** — 단락별 *마찰 계수* 에 따라 보드 뷰 블록 색상 채도/명도 차등.
  - **의미론적 접기 (Semantic Folding)** — 활성 블록만 펼치고, 지나간 블록은 작은 인디케이터로 압축. 우측 가로 스크롤 강제 방지.
- [ ] **2.5.4** AI 티키타카 — 채팅 모듈 (읽는 동안 in-flow + 세션 종료 후 잠깐)
  - 촛불 클릭 → 채팅 사이드바 mount. 명시적 신호(밑줄·주석)를 *Anchor* 로 받아 "왜 이 부분에 주목했는지" 시작.
  - `signalBus` 의 `candle_chat_request` 이벤트로 트리거 (candle.js 가 발화 → chat.js 가 구독).
- [ ] **2.5.5** 해석 레이어 — *마찰 계수* 프레임워크 (제미나이 디벨롭 §3)
  - `interpret.js` LLM 호출 *전 단계* 에서 신호 JSON 을 단락별로 3단계 양상 분류:
    - **스캐닝** (Low) — 짧은 dwell, reread 없음
    - **유창한 읽기** (Normal) — dwell 이 WPM 비례, 일정
    - **인지적 마찰 / 숙고** (High) — dwell 초과 + visit ≥ 2 + 주석 있음
  - 산출: 단락별 마찰 계수 0~1 → 보드 모드 색상 위계 + 리포트(2.5.6) 입력.
  - 인지심리 / 독서 연구 논문 1~2개 서치해서 근거화.
- [ ] **2.5.6** 다회독 리포트 (제미나이 디벨롭 §6)
  - **Micro (Single Source)** — *Mental Model Map*. 가장 치열하게 읽은 구간(짙은 블록) + 티키타카 + 주석이 얽힌 지형도.
  - **Macro (Multi-Session)**:
    1. *시간대별 인지 리듬* — 딥 리딩 빈발 요일·시간대.
    2. *관심사 크로스오버 맵* — 문서 간 주석 ↔ 하이라이트 의미론적 교집합.
    3. *마찰 추이 곡선* — 동일/유사 주제 다회독 시 마찰 → 유창함 변화 궤적.
  - 후처리 형식 결정 (리포트 / 대시보드 / 트래커) 은 이 두 레이어를 모두 보여주는 *대시보드* 로 수렴.
- [ ] **2.5.7** 비명시적 신호 보강 — Active Zone 프록시 (제미나이 디벨롭 §2)
  - 화면 중앙 'Active Zone' + scroll delta 방향 전환 + reread 결합 → **역방향 단약시(인지적 머뭇거림)** 정량화.
  - 마우스 호버는 폐기하지 않되 *주력 지표는 dwell + scroll* 로.

## Phase 3 (인프라)

- [ ] Vercel 배포 (Next.js 또는 static + serverless functions)
- [ ] Neon Postgres
  - 세션 / source / SignalLog 저장
  - 사용자별 누적 데이터
- [ ] Python 파이프라인을 Vercel Function 으로 이전 (또는 별도 worker)
- [ ] 사용자 인증 (이메일 매직링크 or OAuth)

## 인터랙션 / 폴리시

- [ ] cursor-hud 제거 (튜닝 값 확정 후)
- [ ] PDF 페이지 navigation (현재는 전체 텍스트 합쳐서 한 흐름으로)
- [ ] 마크다운 footnote / math / code highlight 플러그인
- [ ] 웹 게시물 CORS 우회 — Phase 2.4 확장프로그램으로 해결 예정 (임시로는 web.js 프록시 fallback)
- [ ] 마크다운 이미지 / 링크 hover 인터랙션
- [ ] 다크 모드
