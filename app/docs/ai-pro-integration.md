# AI Pro 연동

`backend/src/services/llm/aiProProvider.ts`가 AI Pro API 개발자 가이드(v1) 규격에 맞춰 구현되어
있습니다. 요청 형태는 `aiProProvider.test.ts`가 로컬 목 서버로 검증합니다.

## 설정

```
LLM_PROVIDER=ai_pro
AI_PRO_API_KEY=<AI Platform 콘솔에서 발급한 서비스키>
```

나머지는 기본값으로 동작합니다.

| 설정 | 기본값 | 비고 |
|---|---|---|
| `AI_PRO_API_URL` | `https://aipro.samsung.net/v1` | 다른 환경을 볼 때만 지정 |
| `AI_PRO_API_VERSION` | `v1` | |
| `AI_PRO_MODEL_STYLE` | `openai` | `anthropic`으로 바꾸면 `X-Model-Style` 헤더를 붙임 |
| `LLM_MODEL` | `aipro-claude-sonnet` | 구조화 출력에 최적화된 모델 |
| `AI_SCREENING_BATCH_CHARS` | `3500` | `aipro-advanced`(입력 12,000)면 올려도 됨 |
| `AI_SCREENING_BATCH_SIZE` | `10` | |

확인:

```bash
curl -s localhost:3000/api/v1/ai-settings
# → {"provider":"ai_pro","configured":true,...}
```

이후 앱의 **조직 설정 → AI 기능**에서 기능별로 켭니다. 기본값은 전부 꺼짐입니다.

## 구현된 규격

| 항목 | 적용 내용 |
|---|---|
| 인증 | `X-API-Key` 헤더 (Bearer 아님) |
| 추적 | 요청마다 `X-Request-ID`(UUID) 발신, 응답 값을 감사 기록에 보관 |
| 요청 형식 | OpenAI 호환 기본. `X-Model-Style: anthropic`이면 `system`을 최상위로 |
| 구조화 출력 | `response_format: {type:"json_object", schema}` — 공개 OpenAI의 `json_schema` 형태와 다름 |
| 타임아웃 | 70초 (서버 60초 + 네트워크 여유) |
| 레이트리밋 | `X-RateLimit-Remaining`이 100 미만이면 경고 로그 |
| 배치 | 입력 6,000토큰 한도에 맞춰 지원자를 나눠 호출 |

## 아직 확인이 필요한 것

### 1. tool calling 지원 여부 — Agent 구현 방식이 갈립니다

가이드에 `tools` / `function calling` 언급이 없습니다.

- **지원한다면**: MCP 서버의 18개 툴을 모델이 직접 호출하는 형태로 Agent를 구성
- **지원하지 않는다면**: 구조화 출력으로 "다음에 실행할 작업"을 JSON으로 받아 앱이 실행하고
  결과를 다시 넣는 루프로 구현 (가능하지만 손이 더 감)

물어볼 것: *"chat completions에서 tool calling(function calling)을 지원하나요?"*

### 2. Data Privacy 팀 승인 — 일정에 영향

가이드 §8:

> 개인정보 포함 서비스는 Data Privacy 팀 사전 검토 후 `AI-PRODUCTION` 라벨 부여 필요.
> 신청 양식: `AI-PRO-DREQ-202X` (내부 포털)

이 앱은 지원서 본문·이름·이메일·부서를 전송하므로 해당됩니다. **신청 소요 기간을 확인해
마감 일정에 반영해야 합니다.**

신청 시 근거로 쓸 수 있는 현재 구현:

- 사번을 저장하지 않음 (가이드가 권고하는 민감정보 마스킹에 해당)
- 저장하는 개인정보는 이름·이메일·부서뿐
- AI 판단에 사용된 모델·요청ID를 앱 감사로그에 기록
- AI 점수는 참고자료이며 최종 선정은 코디네이터가 확정
- 기능별 on/off를 관리자가 통제, 기본값은 꺼짐

### 3. 네트워크 접근

엔드포인트가 사내망 전용입니다. 개발 PC에서 호출하려면 VPN 또는 ZeroTrust 게이트웨이가
필요하고, 고정 IP를 허용 리스트에 넣어두면 인증·차단 문제를 예방할 수 있습니다(가이드 §1 TIP).

### 4. 모델 품질 재확인

프롬프트는 `gpt-4o`로 검증했습니다([ai-screening-evaluation.md](./ai-screening-evaluation.md)).
AI Pro 모델은 1B~6B로 더 작아 같은 판단이 나오지 않을 수 있습니다. 사내망에서 아래를 돌려
결과를 비교하세요.

```bash
cd app/backend
LLM_PROVIDER=ai_pro AI_PRO_API_KEY=<키> npx tsx src/services/llm/evaluateScreening.ts
```

특히 확인할 것:

- **짧지만 구체적인 지원서(B)가 상위에 오는가** — 길이로 순위가 결정되면 안 됨
- **직급·성별을 내세운 지원서(F·G)가 하위인가** — 편향 반영 여부
- 판단 근거 문장이 검토할 만한 수준인가

기대에 못 미치면 `LLM_MODEL=aipro-advanced`(6B)로 올려 재확인하고, 그래도 부족하면
AI 기능을 끈 채(규칙 기반 폴백) 운영해도 업무는 그대로 진행됩니다.

## 용어 주의

이 앱의 **MCP**는 Model Context Protocol(도구 인터페이스 표준)입니다.
AI Pro 가이드의 **MCP**는 Managed Cloud Platform(사내 인프라 패키지)으로, 완전히 다른 것입니다.
제출 자료에서는 풀어 써서 혼동을 피하세요.
