# 이론적 근거 대장 (Theory Base)

> **목적** — 코드/문서에 흩어진 모든 이론·프레임워크 인용을 한 곳에서 검증·추적한다.
> 각 항목: **주장 → 코드 위치 → 코드에 적힌 인용 → 검증 결과(실재 여부) → 정확한 서지/링크 → 코드로 어떻게 가공했나 → 신뢰도/플래그.**
>
> **왜 필요한가** — 원 인용의 출처가 그동안 `Private/Layer2_제미나이_디벨롭_2026-06-02.md`(레포에 없음, gitignore)에만 있었다. 즉 인용이 *Gemini 브레인스토밍 산물*이라 **허위 인용(hallucinated citation)·오귀속 위험**이 있었다. 아래는 2026-06-08 웹 검증 결과다.
>
> 검증 범례: ✅ 실재·매핑 타당 · 🟡 실재하나 해석적 비약/연도주의 · 🔴 오귀속/미확인(수정 필요)

---

## 요약 (한눈에)

| 인용 (코드 표기) | 검증 | 비고 |
|---|---|---|
| Chi & Wylie 2014 (ICAP) | ✅ | 정확. ICAP=I>C>A>P |
| Grusky 2017 (viewport attention) | ✅ | CHI 2017, viewport-time 주의 모델. 매핑 정확 |
| Mason 2024 (주석 품질) | ✅ | JCAL 2024, highlighting 품질→이해/전이 |
| Zhang 2025 (주석 품질) | ✅ | JCAL 2025, constructive>active 주석 |
| Hefter 2023 (개입/방해) | ✅ | 자기설명 중 방해가 학습 저해 |
| Johnson 2010 (주석+성찰) | ✅ | social annotation→메타인지 |
| Qlarify (Fok 2024) | 🟡 | 논문 실재. 단 "확장형 초록"→"하이라이트 후 질문" 매핑은 해석적 비약 |
| D'Mello "2017" | 🟡 | 개념 실재. **연도 부정확** → D'Mello et al. 2014 / D'Mello&Graesser 2012 |
| **Luo 2017 (height-effort)** | 🔴 | **오귀속 의심.** 매칭 논문은 Brady et al. 2018 (저자·연도 불일치) |
| Maryanne Wolf (deep reading) | ✅ | 실재(Reader, Come Home 2018). 에세이/배경용, 코드 비핵심 |
| **"소크라테스식"** (chat.js) | 🔴 | **무인용.** 내가 프롬프트에 쓴 일반 용어 — 근거 보강 필요 |

---

## 1. ICAP — 인지 관여 4단계
- **주장** — 관여가 Passive<Active<Constructive<Interactive 순으로 깊어질수록 학습이 증가(I>C>A>P).
- **코드** — `interpret.js` `computeFriction` 의 `icap_mode`(촛불대화=I / 주석=C / 표시=A / 체류=P), 대시보드 배지.
- **코드 인용** — `Chi&Wylie 2014`.
- **검증 ✅** — Chi, M. T. H., & Wylie, R. (2014). *The ICAP Framework: Linking Cognitive Engagement to Active Learning Outcomes.* Educational Psychologist, 49(4), 219–243.
  - https://www.tandfonline.com/doi/abs/10.1080/00461520.2014.965823 · https://eric.ed.gov/?id=EJ1044018
- **가공** — 4단계를 우리 신호에 사상(촛불 대화/주석/하이라이트·동그라미/체류). 타당.
- **신뢰도** — 높음.

## 2. 가시성-가중 주의 (visible_frac, viewport attention)
- **주장** — 화면에 보인 시간/비율이 주의의 프록시가 된다(아이트래킹 없이).
- **코드** — `signals.js` dwell의 `visible_frac`(intersectionRatio 평균), `interpret.js` `attention = visible_ms`.
- **코드 인용** — `Grusky 2017 (viewport attention)`.
- **검증 ✅** — Grusky, M., et al. (2017). *Modeling Sub-Document Attention Using Viewport Time.* CHI 2017. (1.2M news reading sessions; viewport time를 onscreen 주의로 모델링)
  - https://s.tech.cornell.edu/assets/papers/viewport-time-chi2017.pdf
- **가공** — viewport ratio를 dwell에 곱해 "실제로 보인 만큼"의 주의로 가중. 정확한 적용.
- **신뢰도** — 높음.

## 3. 주석/하이라이트의 *질* (annotationQuality)
- **주장** — "무엇을 남겼나"보다 "어떻게 남겼나(선택성·구성성)"가 인지 상태/전이를 더 잘 예측. constructive-level 주석이 우월.
- **코드** — `candle.js` `annotationQuality`(선택 범위 비율·전이 시간·산출물 밀도), 임계 0.55.
- **코드 인용** — `Mason 2024`, `Zhang 2025`.
- **검증 ✅(둘 다 실재)**
  - Mason, L. et al. (2024). *Highlighting and highlighted information in text comprehension and learning from digital reading.* Journal of Computer Assisted Learning. — 학습자 하이라이트의 *질*이 이해·전이·메타인지 보정을 예측. https://onlinelibrary.wiley.com/doi/10.1111/jcal.12903
  - Zhang, L. et al. (2025). *How the Quality of Annotation Influences Academic Reading: An Eye-Tracking Study.* JCAL. — constructive 주석이 active보다 더 깊은 처리 유발. https://onlinelibrary.wiley.com/doi/10.1111/jcal.70062
  - (보강 후보) Content & quantity of highlights/annotations predict learning from multiple digital texts, *Computers & Education* 2023. https://www.sciencedirect.com/science/article/abs/pii/S0360131523000684
- **가공** — selective(15~40%) 우대·blanket(>80%) 감점, 전이시간/밀도 가중합. **단, 가중치(0.4/0.3/0.3)·임계(0.55)는 1차 추정값이지 논문 수치가 아님** — 코드 주석에도 명시. 데이터로 보정 필요.
- **신뢰도** — 개념 높음 / 파라미터는 임의(검증 대상).

## 4. 개입 타이밍 — Seam(경계면)에서만
- **주장** — 몰입 중 끼어들면 학습 저해. 독자가 스스로 멈춘 지점(주석 직후·막힘·복귀)에서만 개입해야.
- **코드** — `candle.js` 트리거(annotation/isolation/transition/stuck) + 쿨다운.
- **코드 인용** — `Hefter 2023`(방해 최소화), `D'Mello 2017`(상태 관측 시점 개입), `Qlarify (Fok 2024)`(하이라이트 직후 질의).
- **검증**
  - ✅ **Hefter 2023** — 자기설명 학습 중 방해(interruption)가 성과를 떨어뜨림. ("Can prompts improve self-explaining… *Yes, but do not disturb!*", Int. J. Educ. Tech. in Higher Ed., 2023) https://educationaltechnologyjournal.springeropen.com/articles/10.1186/s41239-023-00383-9
  - 🟡 **D'Mello — 연도 부정확.** 개념(혼란=인지 불균형, 적시 개입)은 실재하나 정전은 **D'Mello, Lehman, Pekrun, Graesser (2014). *Confusion can be beneficial for learning.* Learning and Instruction** + D'Mello & Graesser (2012) 정서 역학 모델. → **코드의 "D'Mello 2017"을 2014로 정정 권장.** https://www.sciencedirect.com/science/article/abs/pii/S0959475211000806
  - 🟡 **Qlarify (Fok 2024) — 논문은 실재**(Fok, Chang, August, Zhang, Weld. *Qlarify: Recursively Expandable Abstracts…* UIST 2024; arXiv 2310.07581, 2023). 다만 원 논문은 "초록을 점진 확장"이지 "하이라이트 후 one-click 질문"이 아님 → **매핑은 해석적 비약.** "읽던 자리에서 가벼운 in-context 질의"라는 정신만 차용했음을 명시할 것. https://dl.acm.org/doi/10.1145/3654777.3676397
- **가공** — Seam별 트리거 + 전역/단락 쿨다운으로 "방해 최소화" 구현. 방향은 타당.
- **신뢰도** — Hefter 높음 / D'Mello 개념 높음·서지 정정요 / Qlarify 매핑 약함.

## 5. 스크롤·높이 = 노력/회귀 프록시 (return_effort, reverse_rate) 🔴
- **주장** — 위로 되돌아 스크롤/높은 이동은 인지적 머뭇거림(회귀)의 프록시.
- **코드** — `signals.js` reread의 `reverse_rate`·`scroll_top`, `interpret.js` `return_effort`.
- **코드 인용** — `Luo 2017 (height-effort)`.
- **검증 🔴 오귀속 의심** — "Luo 2017 / height-effort"에 정확히 대응하는 논문을 **확인하지 못함.** 스크롤 빈도↔이해(상·하향 스크롤 구분 포함)를 다룬 매칭 논문은 **Brady, K. A., Cho, S.-J., Narasimham, G., Fisher, D. H., & Goodwin, A. P. (2018). *Is Scrolling Disrupting While Reading?* ISLS** (저자·연도 모두 불일치). https://repository.isls.org/handle/1/497
- **조치** — 코드 주석의 `Luo 2017`을 **삭제 또는 Brady et al. 2018로 교체**. 원 `제미나이 디벨롭 §`에 실제 Luo 논문 DOI가 있으면 그걸로 확정, 없으면 허위 인용으로 간주.
- **신뢰도** — 개념(스크롤 회귀=머뭇거림)은 문헌상 지지되나, **이 인용 키는 신뢰 불가.**

## 6. 깊은 읽기 / 매체와 인지 (배경)
- **주장** — 디지털 매체가 읽기 신경 회로를 재배선; 깊은 읽기는 학습된 기술.
- **위치** — 샘플 에세이(`content.js` "디지털 시대의 읽기"), CHANGELOG 배경.
- **코드 인용** — Maryanne Wolf.
- **검증 ✅** — Wolf, M. (2018). *Reader, Come Home* / (2007) *Proust and the Squid*. 실재. (코드 로직의 근거는 아니고 서사/배경)
- **신뢰도** — 높음(비핵심).

## 7. "소크라테스식" 대화 🔴(무인용)
- **위치** — `chat.js` 시스템 프롬프트("소크라테스식으로 독자가 스스로 생각하도록").
- **검증 🔴** — **특정 논문 근거 없이 일반 교육 용어로 사용**(2026-06-08 A 기능 구현 시 내가 작성).
- **조치(근거화 후보)** — 자기설명 효과(Chi et al. 1994), 안내된 질문/상호 질문(King, 1994 *Guided peer questioning*), 튜토링 대화(Graesser, AutoTutor; D'Mello) 중 택해 근거를 붙이거나, "소크라테스식"이라는 강한 표현을 "스스로 답을 떠올리게 돕는 질문형"으로 완화.
- **신뢰도** — 현재 근거 없음.

---

## 권고 (다음 작업)
1. ✅ **적용됨** — 소스(CLAUDE.md·AGENTS.md·TODO.md·docs/features/candle.md)의 `Luo 2017`→`Brady et al. 2018`, `D'Mello 2017`→`D'Mello et al. 2014` 정정. *(extension/viewer/ 사본은 빌드 산물 — `scripts/build-extension.sh` 재실행 시 반영)*
2. ✅ **적용됨** — candle.md에 Qlarify "정신만 차용" 주석 추가, `chat.js`의 "소크라테스식"을 "질문으로 자기설명 유도"로 완화.
3. **단일 진실 원천화**: 지금 인용의 출처인 `Private/제미나이 디벨롭 §9~§14`가 레포에 없음 → **이 문서(theory-base.md)를 정본 서지로 삼고**, 코드 주석은 여기로 링크(CLAUDE.md/AGENTS.md 반영 완료). (또는 원 디벨롭 문서의 서지 부분만 정제해 커밋)
4. **파라미터 정직성**: annotationQuality 가중치/임계, friction z-score 결합은 **논문 수치가 아니라 추정값**임을 발표·문서에서 명확히("휴리스틱, 미보정").

> 검증 방법: 2026-06-08 웹 검색으로 각 인용의 제목·저자·연도·게재처를 대조. 링크는 출판사/ERIC/arXiv 등 1차에 가까운 것을 우선 수록.
