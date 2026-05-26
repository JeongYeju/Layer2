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
- [ ] **2.3** viewer에서 결과 JSON 불러와서 사이드바/대시보드에 표시
- [ ] **2.4** Chrome MV3 확장프로그램 — CORS / paywall 우회의 정답 (페이지가 이미 브라우저에 로드돼 있으니 직접 본문 추출)
  - 후보 구조:
    ```
    extension/
      manifest.json       # MV3, permissions: activeTab, storage
      background.js       # 단축키 (Cmd+Shift+L) listener
      content-script.js   # Readability 로 현재 페이지 본문 추출
      popup.html / popup.js  # "이 글을 Layer2로 읽기" 버튼
      viewer/             # 현재 index.html + js 그대로 번들
    ```
  - 플로우: 단축키 → content-script 가 Readability 실행 → 본문/제목 추출 → 새 탭에서 `viewer/index.html` 열고 source 주입 → 읽기 → "독서 끝내기" → SignalLog + source 를 `chrome.storage.local` 에 저장 → (옵션) "AI 해석 보기" → 백엔드 호출
  - 이점: CORS 완전 해결 · 로그인/paywall 우회된 페이지 OK · reading session 이 페이지 단위로 묶임 · 누적 데이터가 chrome.storage 에 쌓임
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
