# E2E 검증 (Playwright, 헤드풀)

로컬에서 **실제 브라우저 창**을 띄워 기능을 눈으로 검증한다. (클라우드 세션은 브라우저
다운로드가 막혀 못 돌리므로, 로컬/집 세션에서 실행할 것.)

## 처음 한 번
```
npm install
npx playwright install chromium      # 브라우저 받기
```

## 실행
```
npm run test:headed     # 실제 창 띄워서 (기본 검증 방식)
npm run test:e2e        # 창 없이(headless)
npm run test:ui         # Playwright UI 모드(스텝별로 보기)
```
- 정적 서버(`python3 -m http.server 8000`)는 Playwright가 자동 기동/종료한다.
- 스크린샷은 `test-results/` 에 저장(깃 무시됨).

## 지금 커버 (`recall.spec.js`)
- 회상 워크시트: 밑줄→cloze 카드, 빈칸 표시, 풀이→정답 공개→self-rate
- "더 어렵게"(자유 회상) 모드: 빈칸 없이 프롬프트만

## 새 기능 추가 시
`tests/*.spec.js` 에 케이스를 더한다. 셀렉터/전역 참고:
- 데모 시드: `window.__layer2Demo.seed()` / `.play()` / `.seedSessions()`
- 데모 글: 사이드바 `#src-demo-doc` (표면장력)
- 대시보드 열기: 헤더 `#menu-records` ("기록")
- 독서 끝내기(세션 종료): 헤더 `#btn-finish` (또는 사이드바 `#src-session-end`)
- 촛불 강제: `window.__layer2Candle.fire("annotation"|"isolation"|"transition"|"stuck")`
- 복습 대화 열기: `window.__layer2Chat.review()`
