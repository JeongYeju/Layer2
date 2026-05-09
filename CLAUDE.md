# Layer 2 — 작업 메모

## 사용자 환경
- 사용자는 **GitHub Desktop**으로만 git 작업을 합니다.
- git 관련 안내는 **터미널 명령어 대신 GitHub Desktop UI 기준**으로 설명할 것.
  (예: "Branch 메뉴 → New Branch", "Push origin 버튼" 등)
- 터미널/CLI 명령어(`git checkout`, `git push` 등)를 답변에 노출하지 말 것.

## 프로젝트 상태 (2026-05-09 기준)
- `main` 브랜치가 최신. 다음이 모두 들어있음:
  - 하이라이팅 프로토타입 (밑줄 → 주석 전이) — PR #1
  - 협업자의 마우스 트레일 시각화 + 원 그리기 제스처 감지 (signals.js의
    circle gesture detection) — PR #2, #3
  - CLAUDE.md, .gitignore
- 두 명이 협업 중. 각자 본인 브랜치를 **`main`에서** 따서 작업.
- 사용자(나와 대화하는 사람)는 **민서**, 작업 브랜치는 **`minseo`**.
- 협업자는 **여주**, 작업 브랜치는 **`yeju`**.
- 본인 브랜치 작명 패턴: 단순히 이름만 사용 (`minseo`, `yeju`).

## 사실 확인 습관
- "main 상태가 어떻다" 같은 단정적 답을 하기 전에 항상
  `git fetch origin` 후 `origin/main` 기준으로 확인할 것.
- 사용자가 "웹에서는 보인다"라고 하면 로컬이 stale일 가능성을 먼저 의심.
