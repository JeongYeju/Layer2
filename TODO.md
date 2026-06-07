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

2026-05-27 회의 ("나를 아는 독서" 잠금) + 2026-06-02 제미나이 디벨롭 (페르소나 가설 + 다회독 framing + Seam 타겟팅 + 마찰 프레임 + **4차 문헌 리뷰 적용**) 까지 반영. 자세한 맥락은 `Private/Layer2_회의록_2026-05-27.md` + `Private/Layer2_제미나이_디벨롭_2026-06-02.md` (§9~§14 = 문헌 기반 코드 명세).

핵심 페르소나 가설(확정): *"독자는 자신의 독서 패턴을 발견하기 위해 시스템의 능동적인 개입(AI 촛불)을 원하고 환영한다."*

차별화 노선: Readwise = "유창한 deep flow 진입". Layer 2 = **다회독 시 인지적 마찰 감소 + 메타인지 리포트**.

문헌 근거 확보(2026-06-02 W1 완료): Grusky(viewport attention) / Luo(height-effort) / Chi&Wylie(ICAP) / Mason·Zhang(주석 품질) / D'Mello·Qlarify·Hefter(개입 타이밍) 등 16+편. 절대 초 단위 임계 대신 **문서 내 percentile + z-score 상대량 + explicit signal 결합** 이 설계 원칙.

### 빌드 진행 상태 (2026-06-03 PDF 명세 대조)
2026-06-03 발표 PDF 2종이 빌드 가능한 기술 명세를 확정. 현재 코드 vs 명세 갭:

| 영역 | 명세 | 현재 | 상태 |
|---|---|---|---|
| 신호: 역방향 진입 | reverseRate = backwardEntry/enterCount | visitedCount/totalDwell만 | ❌ 미구현 → 단계1 |
| 신호: 가시성 가중 | visibleFrac (intersectionRatio) 누적 | threshold 0.5만 | ❌ 미구현 → 단계1 |
| 신호: 회귀 거리 | return_effort | scroll 전역 delta만 | ❌ 미구현 → 단계1 |
| 촛불 Seam1 능동정지 | 주석 직후 + 품질 | annotation_seam v0.2 | ✅ 구현 |
| 촛불 Seam2 인지고립 | revisit≥3 AND reverseRate≥0.5 AND friction상위20% AND 무흔적 | reread(visit≥2) 단순 | ⚠️ 단순버전 → 단계2 |
| 촛불 Seam3 세션전환 | 완전비활성 180s OR 탭 hidden→복귀 | welcome(idle 30s) | ⚠️ 기준다름 → 단계2 |
| 마찰 계수 | attention_i·return_effort·revisit·reverseRate → z합 → 상위20% | 없음 | ❌ 미구현 → 단계3 |
| 대시보드 마찰표시 | 단락별 인지 상태 | dwell/highlight 카운트만 | ❌ 미구현 → 단계4 |
| 보드 모드 | 텍스트↔보드, 우측 흔적전개, 마찰 색상위계 | scroll/spread만 | ❌ 미구현 → 단계5 |
| 티키타카 챗봇 | 촛불 클릭 → 대화 | 클릭=dismiss | ❌ 범위밖(2.5.4) |
| 패턴분류 + DB | 유형분류 + vercel/neon | 없음 | ❌ 범위밖(Phase 3) |

빌드 순서(이 세션): 단계1 신호 → 단계2 촛불 Seam2/3 → 단계3 마찰계수 → 단계4 대시보드 → 단계5 보드모드.

- [x] **2.5.1** 촛불(Stick Candle) 1차 초안 — 신호 기반 개입의 의인화
  - `candle.js` + `styles.css` 의 `.candle-mount` 섹션. `.para` 우측 여백에 등장 → 멘트 → 후~ 사라짐 (SVG flame flicker + smoke).
  - **개입 프로토콜 v0.1** (정식 정의는 2.5.2 — 이건 첫 시도):
    - `stuck` — 같은 단락 viewport 중앙에 누적 45초
    - `reread` — `visit_count ≥ 2` (signals.js 의 reread 신호)
    - `welcome` — `attention_resume.paused_ms > 30s`
  - 쿨다운: 같은 단락 2분 / 전역 25초. 클릭 또는 12초 무반응 시 후~ 소멸. 새 소스 로드 시 제거.
  - 데모 훅: `window.__layer2Candle.fire("stuck"|"reread"|"welcome")` (DevTools 에서).
  - 새 신호 추가: `candle_intervene`, `candle_dismiss` — 이후 interpret/대시보드에서 활용 가능.
- [ ] **2.5.2** 개입 프로토콜 v1 — Seam 타겟팅으로 정식화 (디벨롭 §13, 문헌 확정판)
  - 읽기의 물리적 관성을 *부자연스럽게 꺾지 않는* 경계면 3종에서만 비선형 삽입:
    - **annotation_seam** — `onAnnotationSaved(paragraph_i)`. 주석 확정 *직후* 인라인 one-click prompt 1회 ("왜 중요해?" / "네 말로?"). 목적 = Active→Constructive 승격 (Qlarify 근거). ✅ **1차 구현 완료** (candle.js, 2026-06-03) — 품질 임계 통과 시 발동, 전역 쿨다운 우회. 진짜 티키타카(2.5.4) 붙으면 완성.
    - **isolation_seam** ⚠️ 현재 `reread`(visit≥2) 단순버전만 — 정식 조건: `revisit_i ≥ 3 AND reverseRate_i ≥ 0.5 AND friction_i 상위20% AND 무흔적(annotation·highlight 없음)`. 단계2에서 행동조건(revisit·reverseRate·무흔적) 1차 → 단계3 후 friction 결합. 누적 증거 생겼을 때만 진단형 prompt (D'Mello).
    - **transition_seam** ⚠️ 현재 `welcome`(idle 30s) — 정식 조건(PDF 1차본): `완전 비활성 180s(스크롤·마우스 무동작) OR document.visibilityState hidden→visible 복귀`. 복귀 시 "지난번 오래 붙잡았던 단락" 안내. flow 보존 + metacognitive consolidation (Hefter). 단계2에서 구현.
  - cutoff(≥3, ≥0.5) 는 권고치 — 논문 원문 아님. friction_i 가 percentile 기반이라 절대 초 단위(v0.1 의 45s/30s) 대체됨.
  - 멘트 풀 확장 (현재 reason 당 3개 → Seam 별 톤 가이드 + 5~7개) + 페르소나 톤 일관성. **단, Hefter — 지각된 interruption 수가 학습성과를 떨어뜨림 → 빈도·쿨다운 보수적으로.**
  - "X 해볼까?" → AI 티키타카 트리거로 연결 (촛불 클릭 → 2.5.4 채팅 호출)
- [~] **2.5.3** 뷰어 전환 — 텍스트 모드 ↔ 보드 모드 (제미나이 디벨롭 §4). ✅ 1차 구현 (viewer-shell.js, 2026-06-03). 문서: `docs/features/board-mode.md`.
  - ✅ 상단 토글에 보드 버튼(scroll/spread/board). `mode-board` CSS 클래스 토글 + DOM 보존.
  - ✅ **우측 흔적 전개** — 단락별 밑줄·동그라미·주석을 `.board-card` 로 우측에 펼침 (DOM 흔적에서). 실시간 갱신(신호 구독).
  - ✅ **의미론적 접기** — 흔적 없는 단락은 `.board-dot` 작은 점만.
  - ✅ **마찰 색상 위계** — interpret 결과(`window.__lastInterpretation`) 있으면 단락 좌측 보더가 friction_pct 로 물듦.
  - ⏳ 남은 일: 활성 단락만 카드 확대(현재 전부 동일) / 마찰 색상의 실시간화(현재 batch 해석 후만) / AI 티키타카 카드(2.5.4 의존) / 좁은 화면 대응.
- [~] **2.5.4** AI 티키타카 — 채팅 모듈. ✅ 1차 구현 (chat.js, 2026-06-03). 문서: `docs/features/tikitaka.md`.
  - ✅ 촛불 말풍선 "💬 대화" → `candle_chat_request` 발화 → `chat.js` 우측 패널 mount.
  - ✅ Seam(annotation/isolation/transition) + 단락 텍스트를 Anchor 로 시스템 프롬프트에 주입. 멀티턴.
  - ✅ `interpret.js` `chatLLM`(평문·멀티턴) — provider 3종, 대시보드와 키 공유(`layer2.llm.*`).
  - ⏳ 남은 일: LLM 생성 첫 질문(현재 정적 멘트) / 대화를 신호로 기록(상호작용 축) / 보드 카드에서 직접 열기 / 서버 프록시(키 노출 해소, Phase 3).
- [~] **2.5.5** 해석 레이어 — *마찰 계수* 프레임워크 (디벨롭 §10~§11, 문헌 명세). ✅ 산출 1차 구현 (interpret.js+py `computeFriction`, 2026-06-03)
  - ✅ `refine()` 에서 단락별 `friction`(z합)·`friction_pct`·`friction_high`(상위20%)·`icap_mode`·`load_tag` 산출. attention=visibility-weighted, revisit·return_effort·reverse_rate 결합. interpret.py 동일 미러 + 합성 세션 검증 완료.
  - ⏳ 남은 일: candle isolation_seam 에 friction_high 실시간 결합(현재 행동조건만) / 대시보드 표시(단계4) / 보드 색상위계(단계5).
  - `interpret.js` LLM 호출 *전 단계* 에서 단락별 **behavioral state object** 산출 (raw DOM 로그를 LLM 에 넘기지 않음).
  - **(a) 가시성 가중 주의량** — raw dwell 대신 "보인 만큼" 가중 (Grusky UVAM 단순화):
    `attention_i = Σ_k(Δt_k · visibleFrac_ik) / Σ_j Σ_k(Δt_k · visibleFrac_jk)`
    — `visibleFrac` = IntersectionObserver `intersectionRatio`. → signals.js dwell observer 에 ratio 누적 추가 필요.
  - **(b) 회귀 프록시** (Luo height-effort):
    `return_effort_i = Σ_r |scrollTop_return_r − scrollTop_i| / viewportHeight`
    `revisit_i = max(0, enterCount−1)`, `reverseRate_i = backwardEntry / max(1,enterCount)`
  - **(c) 마찰 계수** = z-score 합, 문서 내 상대량:
    `friction_i = z(attention_i) + z(revisit_i) + z(return_effort_i) + z(reverseRate_i)`
    임계 = **문서 내 percentile (상위 20%)**. 절대 초 단위 X.
  - **(d) ICAP 태깅** — P(dwell만) < A(표시만) < C(주석·재구성) < I(촛불 대화). loadTag = germane/extraneous/ambiguous.
    - `productive_struggle = friction high AND (annotation>0 OR highlightQuality high)`
    - `ui_friction = friction high AND no output AND short_oscillations high`
    - `mind_wandering = dwell very high AND progress_after low AND no constructive output`
  - 산출: 단락별 friction + icapMode + loadTag → 보드 모드 색상 위계(2.5.3) + Seam 판정(2.5.2) + 리포트(2.5.6) 입력.
  - 한계: germane vs extraneous 가 행동만으로 완전 분리 X → "정답 분류기" 아니라 *행동 증거 압축기* 로 설계.
- [~] **2.5.6** 다회독 리포트 (제미나이 디벨롭 §6). ✅ Macro 1차 구현 (sessions.js, 2026-06-03)
  - **Micro (Single Source)** — *Mental Model Map*. 가장 치열하게 읽은 구간(짙은 블록) + 티키타카 + 주석이 얽힌 지형도. (보드 모드가 단일 세션 Micro 의 1차 형태)
  - **Macro (Multi-Session)** ✅ — `sessions.js`: session_end 시 요약(`{t, hour, source, friction{mean·max·high}, icap{P/A/C/I}}`)을 `localStorage.layer2.sessions.v1` 에 누적(최근 80). 대시보드 "다중 세션" 섹션:
    1. ✅ *시간대별 인지 리듬* — 밤/오전/오후/저녁 막대(길이=세션 수, 색=평균 마찰).
    2. ✅ *마찰 추이* — 세션 순 friction.mean 스파크라인.
    3. ✅ *관심사* — source_title 빈도 (1차). ⏳ 크로스오버 맵(주석↔하이라이트 의미론적 교집합)은 추후.
  - **DB 불필요** — 단일 브라우저 localStorage 로 데모 충분. 여러 기기·사용자 동기화는 Phase 3.
  - 데모: `window.__layer2Demo.seedSessions(8)` 로 과거 세션 더미 채우기.
  - 후처리 형식 결정 (리포트 / 대시보드 / 트래커) 은 이 두 레이어를 모두 보여주는 *대시보드* 로 수렴.
- [ ] **2.5.7** 비명시적 신호 보강 — Active Zone 프록시 (제미나이 디벨롭 §2)
  - 화면 중앙 'Active Zone' + scroll delta 방향 전환 + reread 결합 → **역방향 단약시(인지적 머뭇거림)** 정량화.
  - 마우스 호버는 폐기하지 않되 *주력 지표는 dwell + scroll* 로.
- [~] **2.5.8** 주석 품질 판별 — 행동 휴리스틱 (G-7, 디벨롭 §12). **실시간 AI X / UI 라벨 X.** ✅ 룰베이스 1차 구현 (candle.js `annotationQuality`, 2026-06-03)
  - 결정 근거: Ollama 실시간 분류 = latency 로 Seam 놓침 + 무의미 텍스트도 추론(낭비). UI 중요도 라벨 = extraneous load 전가(독서를 데이터 라벨링으로 변질). 둘 다 기각.
  - 채택: `highlight.js` 가 *이미 수집 중인* 페이로드만으로 품질 프록시 — **새 신호·UI·실시간 AI 불필요**:
    - [x] **선택 범위 비율** — `anchor_text` 길이 / 문단 글자수. >80% blanket=Low, 15~40% selective=High (Mason 2024).
    - [x] **전이 시간** — 밑줄 완료→주석창 등장 (`textarea_appeared_t − transition_t`). <0.9s=반사적, 길수록 constructive.
    - [x] **산출물 밀도** — `annotation_text` 길이 + 반복문자 비율. "ㅋㅋㅋㅋ" 쓰레기값 필터.
  - **Lazy Evaluation 흐름**: ① 자연스럽게 밑줄·주석 → ② ✅ candle.js 가 3 룰베이스 즉시 계산 (현재는 candle 안. interpret.js 이전은 추후) → ③ ✅ 품질 임계(0.55) 넘긴 주석에만 촛불 즉시(annotation_seam) → ④ ⏳ 세션 종료 후 **고품질 주석만 batch** 로 백그라운드 AI → Macro 리포트 (2.5.4/2.5.6 과 함께).
  - 남은 일: 가중치·임계(0.4/0.3/0.3, 0.55) 실사용 튜닝 / 계산 로직을 interpret.js 로 이전(현재 candle.js 내) / batch AI 경로(④).
  - 데이터 준비도: `anchor_text` `transition_t` `textarea_appeared_t` `annotation_text` `total_duration_ms` 모두 `highlight_annotation` 페이로드에 이미 있음. 추가 수집 0.

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
