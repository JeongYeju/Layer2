# Layer2 viewer — TODO

## Phase 2 (오늘 밤)

- [x] "독서 끝내기" 버튼 (sidebar 현재 소스 카드)
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
  - 플로우: 단축키/팝업 → extract.js 가 페이지 본문 추출 → `chrome.storage.local` 저장 → 새 탭에 `viewer/index.html` → boot-ext.js 가 주입 → 읽기 → "독서 끝내기" → 2.1 내보내기
  - CDN/CSP 처리: MV3 는 원격 모듈 import 금지 → 빌드 스크립트가 esm.sh import 를 로컬 stub 으로 치환. pretext 없이도 핵심 읽기 동작(신호 LayoutCursor 만 null).
  - 로드 방법: Chrome → `chrome://extensions` → 개발자 모드 ON → "압축 해제된 확장 프로그램 로드" → `extension/` 폴더 선택
  - ⚠ 빌드 주의: 루트 viewer(*.js, index.html, styles.css) 수정 후엔 `bash scripts/build-extension.sh` 재실행해야 `extension/viewer/` 반영됨
  - ⚠ 브라우저 실테스트 미완 (이 환경에 headless 브라우저 없음 — Chrome 에 로드해서 확인 필요). 본문 추출 품질은 사이트마다 편차 있음 → 나중에 Readability 벤더링으로 업그레이드
- [ ] 세션 localStorage 영속화 (새로고침해도 소스 목록 / 마지막 위치 유지)

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
