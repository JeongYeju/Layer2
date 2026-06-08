# 핸드오프 가이드 (2026-06-08)

로컬에서 돌릴 수 있는 세션이 **이어서** 작업하기 위한 인수인계. 클라우드 세션에서
여기까지 진행했고, 시각 검증(헤드풀 Playwright)은 로컬에서 이어가면 됨.

## 1. 지금 어디까지 됐나 (전부 `claude/viewer-layout` 에 머지됨)

| PR | 내용 |
|---|---|
| #7 | 버그 4(마찰 지표 절대값화·대시보드 과다렌더·동그라미 누수·채팅 에러) + 🎬데모 버튼 + 마찰량 라벨 + 독서 후 티키타카 + 표면장력 데모 글 + 문서(plan-status·theory-base) + 인용 정정 |
| #8 | extension/viewer 재빌드(소스 반영) |
| #9 | **내재화 B v1 — 회상 워크시트**(밑줄→cloze 카드, recall.js) |

핵심 문서:
- `docs/plan-status.md` — 기획안 ↔ 구현 대조 + 내재화 아이디어 풀
- `docs/theory-base.md` — **모든 이론 인용 검증 대장**(§B = 내재화 근거). 의사결정은 여기에 근거를 박는다.

## 2. 남은 일 (우선순위)

- [ ] **B v1.1 — 보드(시맨틱뷰)에서 회상 카드 토글** *(다음 차례, 시작 안 함)*
  - 보드 카드는 `viewer-shell.js` `renderBoardCards()` 가 `.board-card`/`.board-trace` 로 그림.
  - 계획: 밑줄 있는 단락 카드에 "🧠 회상" 버튼 → 그 단락 밑줄을 인플레이스 cloze 로. `recall.js` 의 cloze 로직 재사용(셀렉터/문장추출 함수 export 하면 됨).
- [ ] **C — 보드 편집형 "내 말 요약"** — 티키타카+주석 모아 LLM 초안(`interpret.js chatLLM`) → 보드에서 편집·`localStorage` 저장(소스별). 기획서의 "티키타카 결과가 시맨틱뷰에" 충족.
- [ ] (보류 합의) 재독 디프(소스별 지난 세션 비교) · 간격 회상 · DB(Vercel/Neon)
- [ ] (선택) 마찰→촛불 트리거 연결 (지금 촛불은 행동 임계만, friction 미연결)

## 3. 시각 검증 (헤드풀) — 로컬에서
이 PR이 `tests/` 하니스를 추가함. `tests/README.md` 참고:
```
npm install
npx playwright install chromium
npm run test:headed       # 실제 창 보며 검증
```
- `tests/recall.spec.js` 가 B v1(회상 워크시트)을 검증/스크린샷.
- **새 기능 만들 때마다 spec 추가**해서 헤드풀로 확인하는 흐름을 유지할 것.

## 4. 데모/검증용 전역 훅
- `window.__layer2Demo.seed()` 즉시 신호 시드 / `.play()` 시간순 재생(촛불 자연 발동) / `.seedSessions()` 과거 세션 / `.runDemo()` 데모 버튼과 동일
- `window.__layer2Candle.fire("annotation"|"isolation"|"transition"|"stuck")`
- `window.__layer2Chat.review()` 독서 후 티키타카 열기
- LLM 기능은 대시보드 'AI 해석'에 **API 키** 필요(키 없으면 정적 폴백 — 데모 안 깨짐)

## 5. 작업 규칙 (이 프로젝트 합의)
- **의사결정은 이론 근거로** — `docs/theory-base.md` 에 출처+가공 방식 기록. AI가 만든 인용은 **웹으로 검증**(허위 인용 주의).
- **파라미터는 미보정 휴리스틱**임을 정직하게(annotationQuality 가중치/임계, friction z-score 결합).
- 사용자(강민서)는 **GitHub Desktop**으로만 git 사용 — 터미널 명령 노출 X.
- extension 사본(`extension/viewer/`)은 빌드 산물 → 소스 바꾸면 `bash scripts/build-extension.sh` 재실행.
- 기능 추가 시 `build-extension.sh` `CORE_FILES` 에 새 .js 등록 잊지 말 것.

## 6. 빠른 파일 지도
- 신호 버스/수집: `signals.js` · 주의 블러: `attention.js`
- 하이라이트/주석: `highlight.js` · 촛불 개입: `candle.js` · 티키타카: `chat.js`
- 해석(마찰/ICAP/LLM): `interpret.js` (+`scripts/interpret.py`)
- 대시보드: `dashboard.js` · 다중세션: `sessions.js` · 회상 카드: `recall.js`
- 뷰 셸(스크롤/스프레드/보드/플라이아웃): `viewer-shell.js` · 독서모드: `portal.js`
- 소스 로더: `sources/*.js` (`surface-tension.js` = 데모 글)
