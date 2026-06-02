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

2026-05-27 회의 결정 반영. 한 문장 = **"나를 아는 독서"**, 두 축(텍스트 × 나) + 아교(뷰어 전환 / 촛불 / AI 티키타카). 자세한 맥락은 `Private/Layer2_회의록_2026-05-27.md`.

- [x] **2.5.1** 촛불(Stick Candle) 1차 초안 — 신호 기반 개입의 의인화
  - `candle.js` + `styles.css` 의 `.candle-mount` 섹션. `.para` 우측 여백에 등장 → 멘트 → 후~ 사라짐 (SVG flame flicker + smoke).
  - **개입 프로토콜 v0.1** (정식 정의는 §9 미해결 — 이건 첫 시도):
    - `stuck` — 같은 단락 viewport 중앙에 누적 45초
    - `reread` — `visit_count ≥ 2` (signals.js 의 reread 신호)
    - `welcome` — `attention_resume.paused_ms > 30s`
  - 쿨다운: 같은 단락 2분 / 전역 25초. 클릭 또는 12초 무반응 시 후~ 소멸. 새 소스 로드 시 제거.
  - 데모 훅: `window.__layer2Candle.fire("stuck"|"reread"|"welcome")` (DevTools 에서).
  - 새 신호 추가: `candle_intervene`, `candle_dismiss` — 이후 interpret/대시보드에서 활용 가능.
- [ ] **2.5.2** 개입 프로토콜 v1 — 회의록 §9 미해결 1번 ("어떤 신호 조합에서 촛불이 등장하는가") 정식화
  - 현재 v0.1 의 임계값은 추정값. 실제 사용 로그 보고 튜닝
  - 멘트 풀 확장 (현재 reason 당 3개) + 페르소나 톤 일관성
  - "X 해볼까?" → AI 티키타카 트리거로 연결 (촛불 클릭 → interpret 호출 등)
- [ ] **2.5.3** 뷰어 전환 (AFFiNE 아교) — 줄글 / 집중 블럭탄 / 대화 / 포스트잇
- [ ] **2.5.4** AI 티키타카 — 읽는 동안 옆에 있고 끝난 뒤에도 잠깐 나옴
- [ ] **2.5.5** 후처리 형식 결정 (회의록 §9 미해결 2번) — 리포트 / 대시보드 / 트래커 중 무엇

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
