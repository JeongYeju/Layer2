# Layer2 viewer — TODO

## Phase 2 (오늘 밤)

- [ ] "독서 끝내기" 버튼 (toolbar 또는 sidebar)
- [ ] SignalLog + source content + meta 를 한 JSON으로 묶어서 다운로드
- [ ] Python CLI script (`scripts/interpret.py`)
  - [ ] 1차: SignalLog 정제 — 노이즈 제거, mouse_trail 다운샘플링, 단어/문장 단위로 묶기, dwell/reread 집계
  - [ ] 2차: 정제된 로그 + 본문 → OpenAI(or Anthropic) API → 해석 결과 (어떤 문장에서 멈췄는지, 어디서 막혔는지, 관심사 패턴 등)
  - [ ] 결과 JSON 출력
- [ ] viewer에서 결과 JSON 불러와서 사이드바/대시보드에 표시
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
- [ ] 웹 게시물 CORS 우회 — 백엔드 프록시 또는 브라우저 익스텐션
- [ ] 마크다운 이미지 / 링크 hover 인터랙션
- [ ] 다크 모드
