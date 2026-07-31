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

## 확인 완료된 제약 (2026-07-31, 사내 확인)

### 1. tool calling — 미지원. 코드 변경 불필요

AI Pro는 tool calling / agent 실행을 지원하지 않습니다. 모델은 함수 호출을 인식하고 구조화된
JSON을 만들 수 있지만, 외부 API를 직접 호출하지는 못합니다.

**이 앱은 영향을 받지 않습니다.** 현재 구조가 이미 안내된 우회 방법 1·3번과 동일하기 때문입니다.

| 안내된 우회 방법 | 이 앱의 구현 |
|---|---|
| 구조화 출력으로 인자를 받아 코드가 API 호출 | `response_format: {type:"json_object", schema}`로 받고, DB 조회·저장·발송은 전부 서버 코드가 수행 |
| function-calling 스키마만 정의하고 JSON 반환 | 기능별 JSON Schema를 정의해 응답을 검증 (`justification_assessments`, `voc_classifications`) |
| 프롬프트-레벨 pseudo-agent | 사용하지 않음 |

모델에게 명령 실행을 맡기지 않는 것은 제약에 대한 타협이 아니라 의도한 설계입니다. 모든 부작용이
애플리케이션 코드에 남아 있어야 감사·재현·검증이 가능합니다.

### 2. Data Privacy 승인 — 불가. 개인정보를 보내지 않는 것이 전제

승인을 받을 수 없으므로, **AI Pro로 나가는 요청에 개인정보가 없어야** AI 기능을 쓸 수 있습니다.

구조화된 식별자는 애초에 전송하지 않습니다. 프롬프트에 들어가는 것은 다음이 전부입니다.

| 기능 | 전송 내용 | 이름 | 이메일 | 부서 | 사번 |
|---|---|---|---|---|---|
| 서술형 심사 | DB 내부 id + 지원서 본문 + 프로그램명 | – | ✗ | ✗ | ✗ |
| 레터 문구 | 카테고리·프로그램·조직명 + 병합필드 *이름만* | ✗ | ✗ | ✗ | ✗ |
| 설문 VOC | 응답 순번 + 응답 본문 + 프로그램명 | – | ✗ | ✗ | ✗ |
| 캐릭터 이미지 | 코디네이터가 입력한 묘사 문구 | ✗ | ✗ | ✗ | ✗ |

레터 문구는 `{{applicant_name}}`이라는 **필드 이름**만 보내고 값은 보내지 않습니다. 치환은 발송
시점에 코드가 합니다.

남는 위험은 자유서술입니다. 지원서 본문과 설문 응답은 임직원이 직접 쓴 글이라 연락처나 사번이
섞일 수 있고, 이건 스키마로 막을 수 없습니다. [`utils/redaction.ts`](../backend/src/utils/redaction.ts)가
발신 직전에 제거합니다.

- 제거: 이메일, 전화번호, 주민등록번호, 사번(라벨 유무 무관), 6자리 이상 숫자열
- 유지: **이름** — 조직이 취급을 허용하는 유일한 식별자이며, 평가 공정성은 제거가 아니라
  심사 프롬프트의 "이름·성별·부서·직급을 반영하지 말 것" 지시로 확보합니다
  ([측정 결과](./ai-screening-evaluation.md): 직급 근거 10점, 성별 언급 10점)
- 유지: 연도·수량 등 4자리 이하 숫자 — 지원 동기 판단에 필요하고 개인을 식별하지 않음

마스킹은 **모델로 나가는 사본에만** 적용됩니다. DB 원문은 그대로이므로 코디네이터가 보는 화면,
보고서의 인용문, 비-AI 폴백 채점은 모두 실제 작성 내용을 사용합니다. 이 성질은 테스트로 고정되어
있습니다([redaction.test.ts](../backend/src/utils/redaction.test.ts), 그리고 각 기능의
"stripped from the prompt but not from the quote" 테스트).

### 3. 네트워크 — VPN 불필요

AI Pro는 퍼블릭 클라우드 HTTPS 서비스라 호출하는 쪽에 VPN이 필요 없습니다. 운영 서버에서 그대로
호출하면 됩니다.

반대 방향(AI Pro가 사내 API를 호출)은 이 앱에 해당하지 않습니다. 이 앱은 AI Pro를 호출만 하고,
AI Pro가 이 앱을 호출하지 않습니다. 사내 API 노출이 필요해질 경우에만 아래를 검토합니다.

| 방법 | 장점 | 비용 |
|---|---|---|
| 운영 서버를 사내 VPN에 연결 | 보안성 높음 | VPN 관리·연결 장애 위험 |
| HTTPS-Only 엔드포인트(Nginx·API Gateway) 뒤에 배치 | 데이터 외부 이동 없음 | 프록시·TLS 인증서 관리 |
| 온프레미스 배포 | 완전 내부망 | 초기 설치·라이선스 비용 |

## 아직 확인이 필요한 것

### 모델 품질 재확인

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

이 앱의 **MCP**는 Model Context Protocol(도구 인터페이스 표준)입니다. `app/mcp-server`의 18개 툴은
Claude 데스크톱 클라이언트가 이 앱을 조작하기 위한 것이며, AI Pro 연동과 독립적으로 동작합니다.
AI Pro가 tool calling을 지원하지 않는 것과도 무관합니다.

AI Pro 가이드의 **MCP**는 Managed Cloud Platform(사내 인프라 패키지)으로, 완전히 다른 것입니다.
제출 자료에서는 풀어 써서 혼동을 피하세요.
