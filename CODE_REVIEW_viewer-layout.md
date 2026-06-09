# 코드 리뷰 메모 — `claude/viewer-layout` (집 세션 본편)

> 작성: 2026-06-08 / 대상: `claude/viewer-layout` (main 대비 97파일·+25k줄)
> 용도: 집에서 코드 고칠 때 참조. 수업 MVP 기준 = "발표 데모에서 안 깨지고,
> 기획 의도가 화면에 드러나는가"에 초점.
>
> 전반 인상: 문헌 근거·주석·구조가 정말 탄탄함(신호 파이프라인 → 마찰 계수 →
> ICAP/load → 촛불 Seam → 티키타카 → 매크로 리포트가 한 줄로 꿰어짐). 아래는
> 그 위에서 "데모 전에 손보면 좋은 것" 위주.

---

## 🔴 버그 / 정확성 (발표 전 확인 권장)

### R-1. 매크로 리포트의 "마찰 추이/시간대 색농도"가 구조적으로 죽은 값 ★최우선
- `interpret.js computeFriction`에서 friction = **문서 내 z-score 4종의 합**
  (`zAtt+zRev+zRet+zRvr`, 156~160행). z-score는 정의상 **문단 평균이 0**.
- 그런데 `sessions.js summarizeSession`은 단락 friction의 **평균**을 세션 대표값으로 저장
  (`mean`, 79~80행) → **항상 ≈ 0.00**.
- 그 값을 `dashboard.js`의 매크로가 그대로 씀:
  - "마찰 추이 (세션 순)" 스파크라인(`sparkline(m.trend.map(x=>x.mean))`, 147행) → **거의 평평한 직선**.
  - "시간대별 인지 리듬" 막대 색농도(`0.35 + min(1,avg/2)*0.65`, 197행) → avg≈0이라 **항상 최저(0.35)**.
- 즉 friction은 **"이 문서 안에서 어느 단락이 상대적으로 어려웠나"**(percentile)엔 맞지만,
  **세션 간 비교/추이에는 못 쓰는 양**인데 매크로가 그 용도로 쓰고 있음.
- **고치기:** 세션 대표값을 절대 지표로 교체. 후보:
  - `friction.high`(상위20% 단락 **개수**, 이미 저장 중) 또는
  - 절대 attention(평균 `visible_ms`), reread 총합, annotation+chat 수 등.
  - 트렌드/시간대 농도를 이 절대 지표로 바꾸면 의미가 살아남.

### R-2. 대시보드 `paint()`가 모든 시그널마다 호출 (옛 프로토타입에서 그대로 이어짐)
- `dashboard.js onSignal()` 끝 128행 `paint()` 무조건 호출. `mouse_trail`(120ms마다)·
  `scroll`에도 reading/highlight/recent **innerHTML 3블록 통째 재생성**.
- 데모 중 우측 패널 미세 깜빡임/버벅임 유발. 매크로(`renderSessions`)는 분리돼 있어 그나마 다행.
- **고치기:** `switch`에서 통계가 실제 바뀐 case일 때만 `paint()`.

### R-3. `_persistentMarks`가 소스 전환 시 초기화 안 됨 (signals.js)
- 동그라미 제스처 흔적 배열 `_persistentMarks`(signals.js:12)는 새 글 로드 시 안 비워짐.
  reader DOM은 교체되며 마크 element는 detached → **메모리 누수**.
- 더 실질적 문제: pid가 매 소스 `p0,p1,…`로 재생성되므로, 새 글에서 우연히 같은
  `pid:start-end` wordKey가 나오면 Jaccard dedup(586행)이 **정당한 동그라미를 억제**.
- **고치기:** `resetCandle`처럼 소스 전환 콜백에서 `_persistentMarks` 비우고 element 제거.
  (export한 reset 함수 하나 추가해 `app.js setSource`에서 호출.)

### R-4. (minor) chat.js 에러 시 타이핑 인디케이터 스타일 안 벗겨짐
- 성공 경로만 `typing.classList.remove("chat-typing")`(182행). catch에선 안 지워서
  "대화 실패…" 텍스트가 점 바운스 스타일로 보일 수 있음(193행). catch에도 클래스 제거.

---

## 🟡 견고성 / 보안

### S-1. LLM API 키가 localStorage 평문 + 브라우저에서 직접 호출
- `dashboard.js`가 키를 `localStorage["layer2.llm.key"]`에 저장(363~370행), interpret/chat이
  `anthropic-dangerous-direct-browser-access`로 브라우저에서 직접 호출.
- **수업 데모 단일 PC면 OK.** 다만:
  - 공용/공유 PC나 화면 공유 시 키 노출 위험. XSS가 있으면 키 탈취 가능(현재 입력은 escape돼 XSS 표면은 작음).
  - 발표 후 키 지우는 안내, 또는 데모는 sessionStorage(탭 닫으면 소멸)로.
- (참고: pretext는 `extension/viewer/vendor/`로 vendoring돼 있어 옛 esm.sh 리스크는 해결됨 👍)

### S-2. friction 상위20% 컷이 표본 작으면 거의 무의미
- `computeFriction`의 `cut = ceil(n*0.2)`(167행). 데모 문서가 짧아 단락이 5개면 항상 1개만
  "상위20%". z-score도 표본 5개면 노이즈가 큼.
- **데모 팁:** 충분히 긴(단락 10+개) 글로 시연해야 마찰 분포가 의미 있게 보임.

---

## 🟢 기획서 기준 UX / 흐름

### U-1. 촛불 트리거가 5분 데모에서 자연 발생하기 어려움 ★데모 설계 필요
- 임계가 현실적 독서 기준(`candle.js`): isolation = enter_count≥3 & reverse_rate≥0.5 & 무흔적,
  stuck = 같은 단락 **45초**, transition = 비활성 **180초**/탭 복귀.
- 발표 중 organically 안 뜸. → `window.__layer2Candle.fire("annotation"|"isolation"|…)`
  데모 훅이나 `__layer2Demo` 시드로 **시연 시나리오를 미리 스크립트화**할 것.
- 가장 자연스럽게 보여줄 수 있는 건 **annotation seam**: 주석 한 줄 길게 쓰면(품질≥0.55)
  바로 촛불 → 💬대화까지 끊김 없이 시연 가능. 이걸 메인 데모 동선으로.

### U-2. 마찰 리포트 카피가 "절대 판단"처럼 읽히지 않게
- friction은 **문서 내 상대값(percentile)**인데, "단락별 인지 상태/상위20%" 배지가
  사용자에겐 "여기가 객관적으로 어려운 곳"이라는 단정으로 읽힐 수 있음.
- **제안:** "이 글 안에서 상대적으로 더 붙잡았던 곳" 정도로 카피를 상대화. 기획의
  "메타인지 거울" 톤과도 맞음.

### U-3. 대시보드 정보 과밀
- 신호가 많아짐(dwell/reread/underline/annotation/circle/bookmark/capture/candle/chat/
  attention…) + 대시보드에 다중세션·AI해석·Reading·하이라이트·Recent·Timeline 6섹션.
- 발표에선 **"AI 해석 + 단락별 마찰" 한 화면**에 집중하고, raw 카운터/timeline은 접기(details)
  권장. 기획 핵심 산출물 = 메타인지 리포트이지 이벤트 카운터가 아님.

### U-4. 좋은 점 (유지)
- 촛불을 "질문 후 💬대화(티키타카)"로 이어 ICAP의 I까지 닫은 설계, attention blur로
  "독서 중단 지점"을 몸으로 보여주는 것, board 모드의 의미론적 접기 — 기획 의도가 화면에
  잘 드러남. 데모의 클라이맥스로 쓰기 좋음.

---

## ⚪ 정리 / 유지보수

- **cursor-hud.js** — viewer-layout `app.js`엔 이미 import 없음(분리 완료 👍). 파일만 남아
  있으니 확정됐으면 삭제.
- **`console.log("[signal]", …)` 상시 출력**(signals.js:27) — 데모 콘솔 노이즈. 디버그 플래그로.
- **`escapeHtml`는 비문자 들어오면 throw** — 현재 호출부는 대부분 문자열 보장이라 OK이나,
  LLM 응답 객체를 직접 넣는 경로 생기면 방어 필요.

---

## 발표 전 체크리스트 (요약)
1. [ ] R-1: 매크로 세션 대표값을 절대 지표로 교체 (안 그러면 추이 그래프가 평평)
2. [ ] U-1: 촛불 시연 동선 스크립트화 (annotation seam 중심 + 데모 훅 백업)
3. [ ] S-1: 데모용 API 키 처리 방침 (발표 후 삭제 / sessionStorage)
4. [ ] R-2: paint() 게이팅 (패널 버벅임 제거)
5. [ ] S-2: 단락 10+개 긴 글로 시연
6. [ ] R-3: 소스 전환 시 동그라미 마크 초기화
