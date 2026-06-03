# Layer 2

**나를 아는 독서** — 읽는 동안 발생하는 신호(밑줄·체류·되돌아가기·주석)를 수집해, 그 독서 흔적을 다시 나에게 비춰주는 한국어 디지털 리딩 도구.

단순 집중 트래커도, 학습 보조 도구도 아니다. 다회독 시의 **인지적 마찰을 줄이고**, 나의 독서 패턴을 객관화한 **메타인지 리포트**를 만드는 것이 목표다.

## 둘러보기

- **기능 문서** — [`docs/features/`](docs/features/) : 각 기능이 *왜 생겼고 어떻게 작동하는가* (케이스 스터디용)
  - [촛불 (Stick Candle)](docs/features/candle.md) — 신호 기반 AI 개입의 의인화
- **진행 상황** — [`TODO.md`](TODO.md) (Phase 2.5)
- **변경 이력** — [`CHANGELOG.md`](CHANGELOG.md)
- **아키텍처 · 작업 메모** — [`CLAUDE.md`](CLAUDE.md)

## 실행

브라우저에서 `index.html` 을 열면 바로 동작한다 (VSCode Live Server 권장). Chrome 확장 빌드는 `bash scripts/build-extension.sh` 로 `extension/viewer/` 를 생성한 뒤 `chrome://extensions` 에서 압축 해제 로드.

> 최신 작업 브랜치는 `claude/viewer-layout`.
