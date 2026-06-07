# AI 티키타카 (AI Dialogue)

> **한 줄** — 촛불이 "질문 한 마디 던지고 끝"이 아니라, **대화** 버튼을 누르면 그 단락을 맥락(Anchor)으로 삼아 옆에서 *왕복 대화*가 시작된다. 소크라테스식으로 독자가 스스로 생각하게 돕는 채팅.

| | |
|---|---|
| **상태** | v0.1 (1차 구현 — 멀티턴 대화 + Seam 맥락 주입) |
| **핵심 파일** | `chat.js`, `interpret.js` (`chatLLM`), `candle.js` (대화 버튼), `styles.css` (`.chat-panel`) |
| **발화 신호** | (없음) |
| **구독 신호** | `candle_chat_request` (candle.js 가 발화) |
| **TODO** | `TODO.md` Phase 2.5.4 |

---

## 1. 한 줄 요약

촛불이 떴을 때 말풍선 아래 **💬 대화** 버튼이 있다. 누르면 우측에서 채팅 패널이 슬라이드로 열리고, 촛불이 첫 마디를 건넨다 — 그 단락과 *왜 촛불이 떴는지*(주석 직후 / 막힘 / 복귀)를 이미 알고 있는 상태로. 독자가 답하면 LLM 이 이어받아 멀티턴으로 대화한다. 내러티브의 아교 3종(뷰어 전환 · 촛불 · **티키타카**) 중 마지막 조각.

## 2. 왜 생겼나 (배경 · 문제)

촛불(v0.3)까지는 *적절한 순간에 질문을 던지는* 데까지였다. 하지만 페르소나 가설 — *"독자는 능동적 개입과 티키타카를 원하고 환영한다"* — 의 핵심은 **왕복**이다. 질문만 던지고 사라지면 "Active → Constructive 승격"(주석을 사유로 끌어올림)이 미완성이다. 문헌(Johnson 2010)도 *주석은 그 자체보다 되돌아보게 만드는 후속 질문·대화가 붙을 때 메타인지에 기여*한다고 본다. 그래서 촛불의 한 마디를 **대화의 시작점**으로 연다.

## 3. 사용자가 보는 것 (UX)

1. 촛불이 뜬다 (주석 직후 / 막힘 / 복귀 등).
2. 말풍선 아래 **💬 대화** 클릭 → 촛불은 후~ 사라지고, 우측에서 채팅 패널이 열린다.
3. 패널 상단에 맥락 라벨(예: "촛불 · 막힌 지점"), 촛불의 첫 마디가 이미 떠 있다.
4. 독자가 입력 → LLM 응답 → 계속 주고받기.
5. ✕ 로 닫는다.
6. API 키가 없으면 "대시보드에서 키를 넣어달라"고 안내 (대화는 키가 있어야 동작).

## 4. 작동 원리 (기술)

- **트리거** — `candle.js` 의 showCandle 이 말풍선에 `.candle-chat-btn` 을 단다. 클릭 시 `candle_chat_request` 신호를 발화하고(`{ paragraph_id, reason, line, para_text }`) 촛불은 dismiss. 단락 텍스트는 촛불 mount 를 붙이기 *전*에 캡처(안 그러면 촛불 멘트가 섞임).
- **패널** — `chat.js` 의 `initChat()` 이 `#chat-panel` 을 만들고 `signalBus` 에서 `candle_chat_request` 를 구독. 요청이 오면 `openFor()` 가 맥락(`ctx`)을 저장하고 패널을 연다.
- **첫 마디** — 촛불 멘트(`line`)를 화면에만 표시(대화 히스토리엔 미포함 — 첫 LLM 메시지는 user 여야 하므로).
- **LLM 호출** — `interpret.js` 의 `chatLLM({ provider, apiKey, system, messages })` 재사용. interpret 의 JSON 호출과 달리 **평문**을 반환하고 `messages` 배열로 멀티턴을 유지. 시스템 프롬프트 = 촛불 페르소나 + Seam 별 톤(`REASON_TONE`) + 단락 텍스트.
- **자격증명** — 대시보드와 같은 `localStorage`(`layer2.llm.provider` / `layer2.llm.key`)를 공유. 따로 설정할 필요 없음.

## 5. 데이터 (신호 in / out)

- **구독** — `candle_chat_request` `{ paragraph_id, reason, line, para_text }`.
- **발화** — 없음 (대화는 신호 로그에 안 남김. 추후 학습 신호로 기록 고려).
- **외부** — `localStorage` 의 LLM 자격증명, `interpret.js` 의 `chatLLM`.

## 6. 설계 근거 (왜 이렇게)

- **촛불 멘트를 대화 opener 로** — 이미 Seam·단락을 아는 상태에서 시작하니 차가운 빈 채팅창보다 자연스럽다.
- **Seam 별 톤 주입** — annotation=사유 확장 / isolation=구조 진단 / transition=환기. 같은 LLM 이지만 *왜 떴는지*에 따라 다른 동반자.
- **chatLLM 분리** — interpret 의 JSON 강제 호출과 달리 대화는 평문·멀티턴. 인프라(provider 분기·키)는 재사용하되 출력 계약만 다르게.
- **자격증명 공유** — 사용자가 키를 두 번 넣지 않게.

## 7. 현재 상태 & 한계

**됐다 (v0.1):** 대화 버튼, 슬라이드 패널, 멀티턴, Seam 맥락 주입, provider 3종(anthropic/openai/gemini), 키 공유, 다크모드.

**한계 / 다음:**
- **첫 질문이 LLM 생성이 아님** — 촛불 정적 멘트로 연다. 단락 기반 *맞춤 첫 질문*을 LLM 으로 생성하면 더 날카로움.
- **대화가 신호로 안 남음** — 티키타카 빈도·길이도 "상호작용" 축의 데이터인데 아직 기록 X.
- **보드 카드와 미연결** — 보드 모드의 "AI 티키타카 카드"에서 직접 열기 미구현.
- **브라우저 직접 호출** — API 키가 브라우저에 노출(`dangerous-direct-browser-access`). 데모용. 배포 시 서버 프록시 필요(Phase 3).
- **컨텍스트 길이** — 단락 600자 컷 + 대화 누적. 길어지면 비용↑.

## 8. 관련 파일 / 더 읽기

- **코드** — `chat.js`, `interpret.js` (`chatLLM`), `candle.js` (`candle_chat_request` 발화), `app.js` (`initChat`), `styles.css` (`.chat-panel`)
- **관련 기능** — [candle.md](candle.md) (대화의 트리거), [board-mode.md](board-mode.md) (티키타카 카드 자리)
- **의사결정** — `Private/Layer2_제미나이_디벨롭_2026-06-02.md` (페르소나 가설), 문헌 Johnson 2010 (주석+후속 대화)
- **진행** — `TODO.md` 2.5.4
