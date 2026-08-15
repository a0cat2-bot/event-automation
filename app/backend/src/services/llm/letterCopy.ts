import { getProviderForFeature } from './featureFlags.js';
import { LlmUnavailableError, type LlmProvider } from './types.js';

/**
 * Drafts the body copy for a standard-layout letter.
 *
 * Advisory only: the draft lands in the editor for the coordinator to change before anything is
 * sent. Unlike justification screening this affects nobody's selection outcome, so a weaker result
 * costs an edit rather than a wrong decision.
 */

export interface LetterCopyRequest {
  /** Category display name, e.g. 당첨 안내. Sets the letter's purpose and tone. */
  categoryName: string;
  /** Which optional sections the category renders, so the body does not duplicate them. */
  sections: {
    hasDatetime: boolean;
    hasLocation: boolean;
    hasGiftInfo: boolean;
    hasPrecautions: boolean;
  };
  programName: string;
  programDescription: string | null;
  orgDisplayName: string;
}

export interface LetterCopyDraft {
  bodyText: string;
  model: string;
  requestId: string | null;
}

/**
 * Merge fields the body may use. Anything outside this list would render literally in a sent
 * letter, so the model is given the list and the result is checked against it.
 */
const ALLOWED_MERGE_FIELDS = [
  'applicant_name',
  'applicant_email',
  'program_name',
  'program_date',
  'program_location',
  'program_time',
  'survey_link',
  'gift_amount',
  'coordinator_name',
  'coordinator_contact',
] as const;

const SYSTEM_PROMPT = `당신은 사내 프로그램 안내 레터의 본문을 작성합니다.

작성 원칙:
- 사내 공지 문체. 정중하되 사무적으로 씁니다. 과장된 표현이나 감탄사를 쓰지 않습니다.
- 3~5문장으로 짧게 씁니다. 읽는 사람이 할 일이 무엇인지 분명해야 합니다.
- 수신자를 부를 때는 {{applicant_name}} 병합 필드를 씁니다.
- 일시·장소·상품·주의사항은 레터의 다른 영역에 별도로 표시됩니다.
  본문에서 그 내용을 반복하지 마세요.
- 확인되지 않은 사실을 지어내지 않습니다. 모르는 정보는 병합 필드로 두거나 생략합니다.

병합 필드는 {{key}} 형식이며 아래 목록에 있는 것만 사용할 수 있습니다:
${ALLOWED_MERGE_FIELDS.join(', ')}

본문 텍스트만 출력합니다. 제목, 인사말 머리, 서명은 레터의 다른 영역에서 처리하므로
포함하지 않습니다.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { body_text: { type: 'string' } },
  required: ['body_text'],
  additionalProperties: false,
} as const;

/**
 * Returns a draft, or null when the feature is off, unconfigured, or the call fails.
 *
 * Null rather than throwing: the coordinator simply writes the letter by hand, which is how this
 * screen worked before AI existed.
 */
export async function draftLetterCopy(
  request: LetterCopyRequest,
  deps: { resolveProvider?: () => Promise<LlmProvider | null> } = {},
): Promise<LetterCopyDraft | null> {
  const resolveProvider = deps.resolveProvider ?? (() => getProviderForFeature('letter_copy'));

  let provider: LlmProvider | null;
  try {
    provider = await resolveProvider();
  } catch {
    return null;
  }
  if (!provider) return null;

  try {
    const completion = await provider.complete({
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(request),
      maxTokens: 1200,
      jsonSchema: { name: 'letter_copy', schema: RESPONSE_SCHEMA },
    });

    const parsed = completion.json as { body_text?: unknown } | null;
    const bodyText = typeof parsed?.body_text === 'string' ? parsed.body_text.trim() : '';
    if (!bodyText) throw new LlmUnavailableError('본문이 비어 있습니다.');

    return {
      bodyText: stripUnknownMergeFields(bodyText),
      model: completion.model,
      requestId: completion.requestId,
    };
  } catch {
    return null;
  }
}

function buildPrompt(request: LetterCopyRequest): string {
  // Named so the model does not restate what the letter already shows elsewhere.
  const renderedElsewhere = [
    request.sections.hasDatetime ? '일시' : null,
    request.sections.hasLocation ? '장소' : null,
    request.sections.hasGiftInfo ? '상품 정보' : null,
    request.sections.hasPrecautions ? '주의사항' : null,
  ].filter(Boolean);

  return [
    `레터 종류: ${request.categoryName}`,
    `프로그램: ${request.programName}`,
    request.programDescription ? `프로그램 설명: ${request.programDescription}` : null,
    `보내는 조직: ${request.orgDisplayName}`,
    renderedElsewhere.length > 0
      ? `본문 밖에 따로 표시되는 항목: ${renderedElsewhere.join(', ')}`
      : null,
    '',
    '위 정보로 이 레터의 본문을 작성하세요.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Removes merge fields outside the allowed list.
 *
 * A hallucinated `{{event_fee}}` would be sent to employees verbatim, since the renderer only
 * substitutes known keys. Dropping the braces leaves readable text instead of visible template
 * syntax, and the coordinator still reviews the draft.
 */
export function stripUnknownMergeFields(bodyText: string): string {
  const allowed = new Set<string>(ALLOWED_MERGE_FIELDS);
  return bodyText.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) =>
    allowed.has(key.toLowerCase()) ? `{{${key.toLowerCase()}}}` : '',
  );
}
