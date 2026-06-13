# Figma 발표 슬라이드 — 진행 메모 (2026-06-14, 다음 세션용)

15일 모의발표 슬라이드를 Figma에 직접 작도 중. `use_figma` MCP + `figma-korean-design-system` 스킬.

## 어디까지 했나
- ✅ **Main 02 — Innovation (HDI → DHI)** 한 장 완성. node `408:8`.
- 기존 **Main 01 — 나를 아는 독서**(node `398:1546`) 오른쪽에 이어 붙임.
- 대본 원본: [15일-script.md](15일-script.md) (12비트, 민서님이 촛불 카피 등 추가 편집함).
- 배치할 스크린샷: [shots/](shots/) (01-reading · 02-candle · 03-tikitaka · 04-board · 05-mentalmap-panel/full). 재생성 `npx playwright test shots`.

## 좌표/파일 (그대로 이어쓰기)
- fileKey: `nmGpVp0Op56V2P8tUmsVdl`
- 페이지: `260602 | Narrative |`
- 섹션: `398:1545` (이름 "0613 Layer 3", 14299×1729)
- 슬라이드 크기: **1920×1080**, 섹션 내 상대좌표. Main01 = (397,397). Main02 = (2477,397). 다음 = x += 2080 씩 우측으로 (gap 160).

## 컨벤션 (스킬 + 민서님 피드백 = 반드시 지킬 것)
1. **텍스트는 파일의 기존 스타일 ID 할당** (`setRangeTextStyleIdAsync`) → 데스크톱에서 진짜 Pretendard 렌더. 직접 폰트 로드 X.
2. **본문 최소 24** (`body`=24). 11(`text`)·14(`body 3`) 같은 작은 스타일 본문에 쓰지 말 것.
3. **슬라이드 패딩 = T/B 80, L/R 40** (Layer 2 컨벤션). ← 멋대로 키우지 말 것.
4. **모든 박스 Auto Layout**. x/y 직접지정은 슬라이드 프레임 위치 + 다이어그램 정렬만.
5. ACCENT = `#2d5e4c` (rgb 45,94,76). styleId 적용 후 size≥28·eyebrow·accent는 **Bold 재적용**.
6. 함정: `setRangeFontNameAsync` 없음(직접 할당) / letterSpacing은 styleId **전**에 / 1슬라이드=1 use_figma 호출(에러 시 전체 롤백) / 명시적 `return`.
7. 사이즈→스타일: 96 h0 / 60 h1 / 42 h2 / 36 h3 / 28 body1.5 / 24 body / 20 body2 / 14 body3 / 11 text · 24 eyebrow all cap.

## 다음 슬라이드 (데모/디벨롭 위주, 과감·미니멀 스토리텔링)
- [ ] Problem — "평평해진 읽기" 빅타입 (빈 중심)
- [ ] How — Wrestle · Trace · Mirror 3분할
- [ ] **Demo** — 읽기·촛불·티키타카 스크린샷 배치 (`upload_assets`로 shots/ PNG 삽입)
- [ ] **Mental Map** — 별자리 스크린샷 (히어로, shots/05-mentalmap-panel.png)
- [ ] Development — 신호 레이어 다이어그램
- (히어로 타이포 슬라이드는 우측 여백 비우는 미니멀, 데모/디벨롭은 스크린샷이 우측 채움)

## 주의
- Figma MCP 읽기(get_metadata/read probe)가 간헐적 타임아웃. 쓰기(use_figma create)는 됨. 읽기 막히면 추정 말고 재시도.
- 17일 자기소개(냉장고자석·비가용성의 가치)는 별도 TODO.
