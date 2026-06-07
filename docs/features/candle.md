# 촛불 (Stick Candle)

> **한 줄** — 글을 읽는 동안 수집되는 신호(밑줄·체류·되돌아가기 등)가 *개입할 조건*을 만들면, 작은 촛불 캐릭터가 그 단락 옆에 나타나 한 마디를 건네는 기능. 추상적인 "AI 개입 프로토콜"을 *눈에 보이는 얼굴 하나*로 번역한 것.

| | |
|---|---|
| **상태** | v0.3 (Seam 3종 정식화 — annotation·isolation·transition) |
| **핵심 파일** | `candle.js`, `styles.css` (`.candle-mount` 섹션) |
| **발화 신호** | `candle_intervene`, `candle_dismiss` |
| **구독 신호** | `highlight_annotation`, `reread`, `attention_resume`, `scroll` |
| **TODO** | `TODO.md` Phase 2.5.2 (Seam 정식화), 2.5.8 (주석 품질) |

---

## 1. 한 줄 요약

촛불은 Layer 2 의 **AI 개입을 의인화한 캐릭터**다. 시스템은 독자가 읽는 동안 여러 신호를 모으는데(어디서 오래 머물렀나, 무엇에 밑줄을 쳤나, 어디로 되돌아갔나), 이 신호들이 특정 조건을 만족하면 촛불이 본문 옆에 *스윽* 나타나 말을 건넨다 — *"방금 친 거, 왜 중요하다고 느꼈어?"* 같은. 사용자가 클릭하거나 잠시 두면 불꽃이 **후~** 꺼지듯 사라진다.

핵심은 **언제 나타나느냐**다. 아무 때나 끼어들면 방해지만, 독자가 *이미 멈춘 순간*에 나타나면 거든다. 그 "멈춘 순간"을 노리는 게 이 기능의 전부다.

## 2. 왜 생겼나 (배경 · 문제)

**문제 1 — 읽기는 일방향이다.** 기존 디지털 독서는 텍스트가 눈을 통해 흘러갈 뿐, 시스템은 독자가 어디서 헤매는지 모른다. Layer 2 의 한 문장은 *"나를 아는 독서"* — 읽는 동안의 흔적을 다시 나에게 비춰주자는 것. 그러려면 시스템이 그냥 관찰만 하지 않고, 적절한 순간에 **말을 걸 수 있어야** 한다.

**문제 2 — 추상적인 신호는 사용자에게 안 보인다.** Layer 2 는 dwell·reread·attention 같은 신호를 쌓고 있었지만, 그건 콘솔 로그일 뿐 독자에게는 아무것도 아니었다. 2026-05-27 회의에서 이 추상적 프로토콜을 *하나의 캐릭터*로 번역하기로 결정했다 — "지식에 등불을 켜준다"는 톤의 촛불.

**문제 3 — 끼어들기는 위험하다.** 몰입 중에 함부로 끼어들면 오히려 학습을 해친다 (문헌: Hefter 2023 — *지각된 interruption 수가 학습 성과를 떨어뜨림*). 그래서 촛불은 **독자가 스스로 멈춘 "경계면(Seam)"에서만** 나타나야 한다는 원칙을 세웠다.

> 전제가 되는 페르소나 가설: *"독자는 자신의 독서 패턴을 발견하기 위해 시스템의 능동적인 개입(AI 촛불)을 원하고 환영한다."* — 단, 그 환영은 *멈춘 자리*에서만 성립한다.

## 3. 사용자가 보는 것 (UX)

1. 독자가 평소처럼 글을 읽는다. 촛불은 보이지 않는다.
2. 어떤 조건이 충족되면 (예: 한 단락에 핵심 구절을 밑줄 치고 주석을 제대로 남김), **본문 오른쪽 여백에 작은 촛불이 흔들리는 불꽃과 함께 나타난다.**
3. 촛불 옆 말풍선에 한 마디가 뜬다 — *"방금 친 거, 왜 중요하다고 느꼈어?"*
4. 독자가 촛불을 클릭하면 → 불꽃이 꺼지고 연기가 피어오르며 사라진다. 12초 동안 두어도 자동으로 사라진다.
5. 다른 글을 열면 촛불은 깨끗이 사라진다.

화면이 좁으면(폭 980px 미만) 오른쪽 여백 대신 단락 아래에 붙는다. 다크모드에서는 풍선이 어두운 톤으로 바뀐다.

## 4. 작동 원리 (기술)

촛불은 두 가지 방식으로 "개입할 순간"을 감시한다.

**(A) 신호 구독** — `signalBus`(전역 신호 버스)를 듣다가, 특정 신호가 오면 트리거를 판정한다.
**(B) 폴링** — 4초마다 현재 화면 중앙의 단락을 확인해, 같은 단락에 오래 머물면(stuck) 트리거한다.

### 트리거 4종 (= Seam 타겟팅)

| 트리거 | 언제 | 무슨 Seam | 멘트 톤 |
|---|---|---|---|
| **annotation** | `highlight_annotation` 신호 + **품질 ≥ 0.55** | 능동적 정지 (주석 직후) | 사유 확장 질문 |
| **isolation** | `reread` 신호: `enter_count ≥ 3 AND reverse_rate ≥ 0.5 AND 무흔적` | 인지적 고립 (막혀서 헤맴) | 구조 진단 |
| **transition** | 완전 비활성 **180초** 복귀 OR 탭 hidden→복귀(3초+) | 세션 전환점 | 흐름 환기 |
| **stuck** | 같은 단락 화면 중앙에 누적 **45초** (폴링) | (추정값, friction 대체 예정) | 막힘 거들기 |

> v0.3 (2026-06-03): `reread`(visit≥2)·`welcome`(30초)를 PDF 1차본의 정식 조건으로 교체. **isolation** 은 단순 재방문이 아니라 *역방향으로 되돌아 읽으며(reverse_rate) 아무 흔적도 안 남긴* 막힘 상태에서만 발동 — `paraTraces` Map 으로 단락별 밑줄·주석 유무를 추적해 "무흔적"을 판정한다. **transition** 은 candle 자체 `visibilitychange` 리스너(탭 복귀) + `attention_resume.paused_ms ≥ 180s`(완전 비활성)로 발동.

> `stuck` 의 45초는 1차 추정값이다. v1 에서는 문헌 기반 **마찰 계수(friction)의 문서 내 상위 20% percentile** 로 대체할 계획 (→ [예정: friction.md], `TODO.md` 2.5.5).

### 주석 품질 휴리스틱 — `annotationQuality()`

`annotation` 트리거의 핵심. **모든 주석에 촛불이 뜨면 방해**이므로, *진짜 고민이 담긴* 주석만 골라낸다. 문헌(Mason 2024)의 *"무엇을 남겼나보다 어떻게 남겼나가 인지 상태를 더 잘 대변한다"* 를 따라, **이미 수집된 행동 데이터만으로** 0~1 점수를 낸다 — 실시간 AI도, UI 라벨도 없이.

```
quality = 0.4·선택범위비율 + 0.3·전이시간 + 0.3·산출물밀도

선택 범위 비율  anchor_text 길이 / 문단 글자수
                <5% → 0.25 (거의 안 침) · 15~40% → 1.0 (핵심 구문) · >80% → 0.25 (blanket)
전이 시간       textarea_appeared_t − transition_t  (밑줄 완료→주석창 등장까지 머문 시간)
                <0.9초 → 0.35 (반사적) · 길수록 ↑ (구성적 재구성) · 6초+ → 1.0
산출물 밀도     annotation_text 길이 + 반복문자 비율
                2자 미만 → 0.1 · 반복 위주("ㅋㅋㅋㅋ") → 0.3 · 길수록 ↑
```

`quality ≥ 0.55` 면 촛불 발동. "ㅋㅋ" 나 문단을 통째로 칠한 blanket highlight 는 자연히 걸러진다.

### 쿨다운 & 소멸

- **전역 쿨다운 25초** — 촛불끼리 너무 자주 안 뜨게. *단, `annotation` 은 우회한다* — 사용자가 방금 능동적으로 주석을 단 직후라 개입 환영도가 가장 높은 순간이라서. (per-para 쿨다운 + 품질 임계가 여전히 spam 을 막음.)
- **단락별 쿨다운 2분** — 같은 단락에서 반복 발동 방지.
- **소멸** — 클릭 즉시 / 12초 무반응 자동 / 새 소스 로드 시 제거. 모두 *후~* 연기 애니메이션.

## 5. 데이터 (신호 in / out)

**구독 (읽는 신호)** — 전부 다른 모듈이 이미 발화하던 것. 촛불은 새 수집을 추가하지 않는다.

| 신호 | 발화처 | 쓰는 필드 |
|---|---|---|
| `highlight_annotation` | highlight.js | `paragraph_id`, `anchor_text`, `annotation_text`, `transition_t`, `textarea_appeared_t` |
| `reread` | signals.js | `paragraph_id`, `visit_count` |
| `attention_resume` | attention.js | `paused_ms` |
| `scroll` | signals.js | (화면 밖 단락의 stuck 타이머 정리용) |

**발화 (쏘는 신호)** — 이후 대시보드·interpret 가 "AI 가 언제 몇 번 개입했나"를 집계할 수 있게.

| 신호 | 페이로드 |
|---|---|
| `candle_intervene` | `{ paragraph_id, reason }` (reason = annotation/isolation/transition/stuck) |
| `candle_dismiss` | `{ reason }` (user/timeout/replace/source_switch …) |

구독 신호에 `highlight_underline`(흔적 기록), `reread`(enter_count·reverse_rate, isolation 판정) 추가됨 (v0.3).

**DevTools 데모 훅** — `window.__layer2Candle`:
- `.fire("annotation"\|"isolation"\|"transition"\|"stuck")` — 쿨다운 무시하고 즉시 발동
- `.enable(bool)` · `.dismiss()` · `.state()` (현재 상태 덤프 — paraTraces 포함)

## 6. 설계 근거 (왜 이렇게)

- **캐릭터로 의인화** — 2026-05-27 회의. 추상 프로토콜을 "보이는 한 마디"로 번역. 촛불 = "지식에 등불, 사라질 때 후~".
- **Seam(경계면)에서만 개입** — 디벨롭 §13 + 문헌. 읽기 관성을 꺾지 않는 세 지점:
  - annotation_seam ← **Qlarify (Fok 2024)** — 하이라이트 직후 one-click 질문이 탐색을 깊게 함.
  - isolation/transition ← **D'Mello 2017** (상태 관측 시점 개입), **Hefter 2023** (interruption 최소화).
- **주석 품질 = 행동 휴리스틱** (G-7). 두 대안을 *기각*하고 택한 것:
  - ❌ 실시간 Ollama 분류 — latency 로 개입 타이밍을 놓치고, "ㅋㅋ" 에도 추론이 돌아 낭비.
  - ❌ UI 중요도 라벨/펜 색 — 독자에게 "빨간펜? 1순위?" 고민을 전가 → extraneous load 증가, 독서를 데이터 라벨링으로 변질.
  - ✅ 이미 있는 행동 데이터로 프록시 — 근거: **Mason 2024 / Zhang 2025** (하이라이트의 *질*, constructive-level annotation 이 학습/전이를 예측).

## 7. 현재 상태 & 한계

**됐다 (v0.3):** 트리거 4종(annotation·isolation·transition·stuck), 주석 품질 3종 휴리스틱, isolation 의 역방향·무흔적 판정, transition 의 탭복귀·180초, 쿨다운, 후~ 소멸 애니메이션, 확장 빌드 반영.

**한계 / 다음:**
- **isolation_seam 의 friction 조건이 아직 빠짐** — v0.3 은 행동 조건(enter_count≥3, reverse_rate≥0.5, 무흔적)만. "friction 상위 20%" 는 단계3(마찰 계수)이 서면 결합 예정. 그래야 "오래 머물렀다"까지 묶여 정밀해진다.
- **숫자는 전부 추정값** — `stuck` 45초, isolation 임계(3·0.5), transition(180s·3s 탭), 품질 가중치 0.4/0.3/0.3·임계 0.55. 실사용 로그로 튜닝 필요.
- **`stuck` 은 friction 으로 대체 예정** — 절대 45초가 아니라 문서 내 percentile 로 (2.5.5 마찰 계수).
- **paraTraces 는 세션 한정** — 새 소스 로드 시 초기화. 다중 세션 흔적은 영속화 안 됨 (Phase 3).
- ~~티키타카가 없다~~ → ✅ 해결: 말풍선 "💬 대화" 버튼이 [tikitaka](tikitaka.md) 왕복 대화를 연다 (v0.3, 2026-06-03). 단, 첫 질문은 아직 정적 멘트.
- **품질 계산이 candle.js 안에 있음** — 원래 설계는 `interpret.js` 의 일이다. 해석 레이어가 서면 이전.
- **티키타카가 없다** — 지금은 촛불이 질문을 *던지고 끝*. 클릭하면 그냥 사라진다. 진짜 왕복 대화는 [예정: tikitaka] (2.5.4). 그게 붙어야 annotation_seam 이 "Active→Constructive 승격"을 완성한다.
- **Lazy Evaluation 의 batch 절반 미구현** — 세션 끝에 고품질 주석만 모아 AI 로 개념망 그리는 부분 (2.5.6 리포트).

## 8. 관련 파일 / 더 읽기

- **코드** — `candle.js`, `styles.css` (`.candle-mount` 섹션), `app.js` (init 순서)
- **신호 인프라** — `signals.js` (signalBus, reread/dwell), `highlight.js` (highlight_annotation 페이로드), `attention.js` (attention_resume)
- **의사결정** — `Private/Layer2_회의록_2026-05-27.md` §4 (촛불 결정), `Private/Layer2_제미나이_디벨롭_2026-06-02.md` §13 (Seam), §12 (주석 품질 G-7)
- **문헌** — `Documents/Claude/Projects/Layer 2/...문헌 리뷰.pdf` (Qlarify, Mason, Zhang, Hefter, D'Mello)
- **진행** — `TODO.md` Phase 2.5.2 / 2.5.8 · `CHANGELOG.md` 2026-06-02~03
