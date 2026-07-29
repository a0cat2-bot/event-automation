---
name: ehs-letter-copywriting
description: Generates actual image-style EHS program letters (모집, 당첨/선정, 상품 수령, 참여 상세, 미당첨, 만족도 설문 등) — not plain-text email copy. Produces a rendered letter with the fixed layout the user requires everywhere it's needed: character/mascot image top-right (blank if none), category + program title top-center, body content in the center, sending organization name pinned to the bottom. Use this whenever the user asks to draft, make, or generate a program letter/notice/안내문/레터 as a visual/image artifact for the EHS app — even without naming a category explicitly, just describing the situation ("합격자한테 보낼 레터 만들어줘", "떨어진 사람들한테 보내는 안내문 이미지로", "상품 받으러 오라는 안내 레터"). Also covers just the body copywriting (tone, structure, required vs optional fields, merge-fields like {{applicant_name}}) when the user only wants the text. Does NOT cover the app's database schema or the production Puppeteer pipeline in ehs-app/backend — that is separate application code.
---

# EHS 레터 생성 가이드 (이미지형 레터)

이 스킬은 EHS 프로그램 레터를 사용자가 요청한 **고정 레이아웃을 가진 실제 이미지형 레터**로 만든다 — 단순 텍스트 메일이 아니라, 배경이 있는 카드형 레터를 생성한다. 문구만 원하는 경우엔 문구만 작성해도 되지만, 기본 동작은 아래 "레터 생성 절차"를 따라 실제 HTML/이미지 산출물까지 만드는 것이다.

`ehs-app/backend/src/routes/letters.ts`, `letterTemplates.ts`는 이 앱의 프로덕션 렌더링 파이프라인(코디네이터가 앱에서 대량 발송할 때 쓰는 것)이며, 이 스킬은 그것과 별개로 Claude Code 세션 안에서 레터 초안/미리보기 이미지를 만드는 용도다. 코드를 수정하라는 요청이 아니라면 `ehs-app/` 쪽 코드는 건드리지 않는다.

## 고정 레이아웃 (모든 카테고리 공통)

- **우측 상단**: 캐릭터/마스코트 이미지 — 있으면 표시, **없으면 그냥 비워둔다** (자리 채우기용 기본 이미지를 억지로 넣지 않는다)
- **상단 중앙**: 카테고리 레이블 + 프로그램명 (예: "미당첨 안내" / "2026 여름 안전교육 프로그램")
- **중앙(본문 영역)**: 아래 순서로 쌓인다
  1. (해당 시) 일시/장소
  2. 본문 텍스트
  3. (해당 시) 상품 정보
  4. (해당 시) 주의사항
  5. (해당 시) CTA/링크 버튼
- **하단**: 발신 소속명 (항상 표시, 문구 안에서 다시 서명하지 않는다)

이 레이아웃은 `assets/letter_template.html`에 실제 HTML/CSS로 구현되어 있다. 색상은 기본값 `#0052CC`(EHS 앱 에디터의 기본 브랜드 컬러와 동일)를 쓰되, 사용자가 다른 브랜드 컬러를 지정하면 그 값을 쓴다.

## 사용 가능한 병합 필드(merge-fields)

`letters.ts`의 플레이스홀더와 동일한 이름을 그대로 사용한다 (새로 만들지 않는다):

`{{applicant_name}}`, `{{applicant_email}}`, `{{department}}`, `{{program_name}}`, `{{program_date}}`, `{{program_location}}`, `{{program_time}}`, `{{survey_link}}`, `{{gift_amount}}`, `{{coordinator_name}}`, `{{coordinator_contact}}`

문구 초안에는 실제 값 대신 이 플레이스홀더 표기를 그대로 남겨서, 나중에 어떤 필드가 어디에 꽂히는지 명확히 보이게 한다.

## 공통 톤 원칙

모든 카테고리에 공통으로 적용:

- 존댓말, 간결한 문장. 한 문단에 하나의 요점.
- 불필요한 미사여구·과장 없이, 무엇을 해야 하는지(또는 무엇이 결정되었는지) 명확히.
- 행정용어보다 참여자가 바로 이해할 수 있는 표현 사용 ("귀하의 신청" 대신 "신청하신 내용" 등, 과하게 딱딱하지 않게).
- 담당자 연락처가 필요한 문구에는 자연스럽게 `{{coordinator_name}}`/`{{coordinator_contact}}`를 문의 안내 문장에 녹인다.

## 카테고리별 작성 가이드

각 카테고리마다: 언제 쓰는지, 필수/선택 요소, 표준 구성 순서, 톤 포인트, 주의사항 문구 예시, 자주 쓰는 병합 필드를 정리했다.

### 1. `recruitment_with_gift` — 모집 안내 (상품 있음)

- **언제**: 참여자를 모집하되, 당첨/선정 시 별도 상품·기프트가 주어지는 프로그램.
- **요소**: `has_datetime`✅ `has_location`✅(장소가 있는 경우) `has_gift_info`✅ `has_precautions`✅ `has_cta_link`✅(신청 링크)
- **구성 순서**: 프로그램 소개 한두 문장 → 일시/장소 → 모집 대상/방법 → 참여 시 제공되는 상품 안내 → 신청 방법/마감일 → 주의사항 → 신청 링크(CTA)
- **톤**: 참여를 유도하되 과대광고처럼 상품을 앞세우지 않는다. 상품은 "참여 혜택" 문장 하나로 담백하게.
- **주의사항 예시 패턴**: "신청 마감 후 접수는 어려운 점 양해 부탁드립니다.", "1인당 신청은 1회로 제한됩니다."
- **병합 필드**: `program_name`, `program_date`, `program_location`, `program_time`, `gift_amount`, `coordinator_name/contact`

### 2. `recruitment_participation_win` — 모집 안내 (참여 자체가 당첨)

- **언제**: 별도 추첨/선정 없이, **신청하면 곧 참여 확정**인 프로그램 (선착순 또는 전원 참여형).
- **요소**: `has_datetime`✅ `has_location`✅ `has_gift_info`❌(보통 없음, 있으면 카테고리 1로) `has_precautions`✅ `has_cta_link`✅
- **구성 순서**: 프로그램 소개 → "신청하시면 별도 심사 없이 참여가 확정됩니다" 명시 → 일시/장소 → 신청 방법/마감일 → 주의사항 → 신청 링크
- **톤**: 카테고리 1과 헷갈리지 않도록 **선정 절차가 없다는 사실을 문장으로 명확히** 짚어준다. 참여자가 "또 기다려야 하나?"라고 오해하지 않게.
- **병합 필드**: `program_name`, `program_date`, `program_location`, `program_time`, `coordinator_name/contact`

### 3. `selection_notice` — 당첨/참여 확정 안내

- **언제**: 추첨·심사를 거쳐 참여자가 확정된 뒤, 그 결과를 알리는 레터.
- **요소**: `has_datetime`✅ `has_location`✅ `has_gift_info`✅(있는 경우) `has_precautions`✅ `has_cta_link`✅(상세 안내/설문 등 후속 링크가 있으면)
- **구성 순서**: 축하/확정 사실 한 문장 → `{{applicant_name}}`님 참여 확정 → 일시/장소 재확인 → (있으면) 참여 시 제공 사항 안내 → 준비물/사전 안내(주의사항) → 문의처
- **톤**: 명확하고 실행 가능하게. "축하드립니다" 정도의 짧은 환영 문구 후 바로 실무 정보(언제/어디서/무엇을 준비)로 넘어간다 — 장황한 축하 인사로 실무 정보를 늦추지 않는다.
- **주의사항 예시 패턴**: "당일 신분 확인을 위해 사원증을 지참해 주세요.", "부득이하게 참여가 어려우신 경우 {{coordinator_contact}}로 사전에 알려주세요."
- **병합 필드**: `applicant_name`, `program_name`, `program_date`, `program_location`, `program_time`, `gift_amount`, `coordinator_name/contact`

### 4. `gift_pickup_notice` — 상품 수령 안내

- **언제**: 이미 당첨/참여가 끝난 뒤, 상품(기프트)을 수령하는 절차만 안내.
- **요소**: `has_datetime`✅(수령 가능 기간) `has_location`✅(수령 장소, 온라인 수령이면 대체) `has_gift_info`✅(필수) `has_precautions`✅ `has_cta_link`✅(수령 신청/기프티콘 링크 등)
- **구성 순서**: 수령 대상 확정 안내 → 상품 내용(`gift_amount` 등) → 수령 방법/기간/장소 → 준비물(신분증 등, 주의사항) → 미수령 시 처리 안내 → 문의처
- **톤**: 절차 안내에 집중. 상품을 다시 홍보하듯 쓰지 않고, "무엇을 어떻게 받는지"만 명확히.
- **주의사항 예시 패턴**: "수령 기간 내 미수령 시 지급이 취소될 수 있습니다.", "본인 확인을 위해 신분증을 지참해 주세요."
- **병합 필드**: `applicant_name`, `program_name`, `gift_amount`, `coordinator_name/contact`

### 5. `participation_detail_notice` — 참여 상세 안내

- **언제**: 이미 참여가 확정된 사람에게, 당일 일정/준비물 등 **상세 실행 정보**를 추가로 안내 (selection_notice보다 더 구체적/실무적인 후속 안내).
- **요소**: `has_datetime`✅ `has_location`✅ `has_gift_info`❌(보통 이 카테고리에서는 다루지 않음) `has_precautions`✅(필수, 준비물/유의사항이 핵심) `has_cta_link`✅(선택, 지도/자료 링크 등)
- **구성 순서**: 프로그램 임박 안내(리마인더 성격) → 상세 일정(시간대별이면 bullet) → 장소/오시는 길 → 준비물/복장/유의사항(핵심) → 문의처
- **톤**: 실무적·구체적. 참여자가 당일 헤매지 않도록 정보 누락 없이. bullet list를 적극 활용.
- **주의사항 예시 패턴**: "우천 시에도 실내에서 정상 진행됩니다.", "편안한 복장으로 참석해 주세요."
- **병합 필드**: `applicant_name`, `program_name`, `program_date`, `program_location`, `program_time`, `coordinator_name/contact`

### 6. `non_selection_notice` — 미당첨 안내

- **언제**: 신청했지만 선정되지 않은 경우.
- **요소**: `has_datetime`❌ `has_location`❌ `has_gift_info`❌ `has_precautions`❌(보통 불필요) `has_cta_link`✅(선택, 다음 기회/다른 프로그램 안내 링크가 있다면)
- **구성 순서**: 신청에 대한 감사 → 결과 안내(완곡하지만 명확하게 "이번에는 함께하지 못하게 되었습니다" 등) → (있으면) 사유를 짧게 — 경쟁률/정원 등 담백한 이유만, 개인 사유 언급 금지 → 다음 기회 안내(재모집 예정, 다른 프로그램 등이 있으면) → 문의처
- **톤 — 특별히 신경 쓸 부분**: 이 카테고리가 가장 조심스럽다.
  - 결과는 **명확하게** 전달하되, 어조는 **정중하고 낙담시키지 않게**.
  - "부족해서", "경쟁에서 밀려서" 같은 결핍/비교 프레이밍 금지. "많은 분들이 신청해 주셔서 전원을 모실 수 없었다"는 식의 **중립적 사실** 프레이밍 사용.
  - 신청 자체에 대한 감사 인사를 반드시 포함 (형식적이라도 생략하지 않는다).
  - 가능하면 다음 기회에 대한 긍정적 언급으로 마무리 (없다면 억지로 만들지 않는다).
- **병합 필드**: `applicant_name`, `program_name`, `coordinator_name/contact`

### 7. `satisfaction_survey` — 만족도 설문

- **언제**: 프로그램 종료 후 참여자에게 설문 응답을 요청.
- **요소**: `has_datetime`❌ `has_location`❌ `has_gift_info`❌(설문 참여 리워드가 있으면만 표시) `has_precautions`❌ `has_cta_link`✅(필수 — 설문 링크)
- **구성 순서**: 참여에 대한 감사 → 설문 요청 취지(운영 개선에 활용됨을 짧게) → 소요 시간 안내(예: "3분이면 충분합니다") → (있으면) 응답 리워드 안내 → 설문 링크(CTA) → 마감일(있으면)
- **톤**: 짧고 부담 없게. 설문을 "숙제"처럼 느끼지 않도록 소요 시간을 반드시 명시.
- **병합 필드**: `applicant_name`, `program_name`, `survey_link`, `coordinator_name/contact`

## 레터 생성 절차

1. **카테고리 판단** — 위 7개 카테고리 중 어느 것인지 확인 (모호하면 사용자에게 짧게 확인).
2. **본문 콘텐츠 작성** — 위 카테고리별 가이드에 따라 제목 레이블, 일시/장소, 본문, 상품 정보, 주의사항, CTA를 작성. 실제 값을 모르는 필드는 `{{applicant_name}}` 같은 병합 필드 표기를 그대로 남긴다.
3. **config JSON 작성** — 아래 스키마로 값을 채운다 (해당 없는 선택 필드는 생략하거나 `null`):
   ```json
   {
     "category_label": "미당첨 안내",
     "program_name": "2026 여름 안전교육 프로그램",
     "org_name": "AX센터 EHS팀",
     "character_image": null,
     "brand_color": "#0052CC",
     "datetime_location": "2026-08-10 (월) 14:00 · 본사 대강당",
     "body": "본문 텍스트...",
     "gift_info": null,
     "precautions": ["문구1", "문구2"],
     "cta": null
   }
   ```
   `character_image`는 사용자가 실제 캐릭터 이미지 파일 경로를 준 경우에만 채운다. 없으면 `null`로 두어 빈 상태로 렌더링한다.
4. **HTML 생성** — 스크립트를 실행해 config를 고정 레이아웃에 채운 HTML을 만든다:
   ```bash
   python3 .claude/skills/ehs-letter-copywriting/scripts/build_letter.py \
     --config <config.json 경로> \
     --out <output.html 경로>
   ```
   이 스크립트는 외부 의존성이 없고(순수 Python 표준 라이브러리), 캐릭터 이미지가 있으면 base64로 임베드해 결과 HTML 파일 하나로 완결된다.
5. **미리보기/이미지 확인** — 이 세션에 브라우저 프리뷰 도구(예: `mcp__Claude_Browser__navigate` + `computer` screenshot)가 있으면 생성된 HTML을 열어 실제 이미지로 스크린샷해 사용자에게 보여준다. 브라우저 도구가 없는 환경이면 생성된 HTML 파일 경로를 안내하고, 브라우저에서 열어 확인(또는 인쇄 → PDF 저장)하도록 안내한다.
6. **확인 및 반영** — 사용자에게 톤/레이아웃/캐릭터 배치에 조정이 필요한지 물어보고, 필요하면 config를 수정해 다시 생성한다.

여러 명에게 각기 다른 내용을 보내야 하는 대량 발송 상황이라면, 이 스킬로 만든 콘텐츠 구조를 참고 삼아 `ehs-app`의 실제 발송 파이프라인(코드)으로 넘기도록 안내한다 — 이 스킬은 개별 초안/미리보기용이다.
