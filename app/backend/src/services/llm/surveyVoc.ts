import { env } from '../../config/env.js';
import { getProviderForFeature } from './featureFlags.js';
import { redactPersonalData } from '../../utils/redaction.js';
import { LlmUnavailableError, type LlmProvider } from './types.js';

/**
 * Groups free-text survey feedback into positive and improvement themes with counts.
 *
 * Deliberately NOT summarisation. The model classifies; it never returns the feedback text. Each
 * response is sent with an index, the model answers with indices, and this module reassembles the
 * output from the original rows. A paraphrased or invented quote is therefore impossible rather
 * than merely discouraged — which matters because these quotes are read as what employees
 * actually wrote.
 */

export interface VocResponse {
  /** Stable position in the caller's list; the model refers to responses only by this. */
  index: number;
  text: string;
}

export interface VocGroup {
  sentiment: 'positive' | 'negative';
  keyword: string;
  count: number;
  /** Verbatim, exactly as submitted — including typos. */
  responses: string[];
}

export interface VocAnalysis {
  groups: VocGroup[];
  totalResponses: number;
  /** Sent for classification, i.e. total minus the trivially empty ones. */
  analysedCount: number;
  /**
   * Responses that ended up in at least one group. Lower than `analysedCount` when the model
   * judged a response to carry no opinion — "좋아요" and the like — so the counts add up.
   */
  classifiedCount: number;
  excludedCount: number;
  /**
   * Who classified. `ai` is this app's own provider with the prompt below; `agent` is a
   * classification supplied from outside through MCP, which did not pass through it. The report
   * states which, because a reader cannot otherwise tell how the grouping was arrived at.
   */
  analysedBy: 'ai' | 'agent';
  /** Null on the agent path, where this app never saw a model. */
  model: string | null;
  requestId: string | null;
}

/**
 * Responses carrying no opinion to classify. Filtered before the call so they neither consume
 * tokens nor inflate a theme's count; `excludedCount` reports how many were dropped so the
 * arithmetic stays transparent.
 */
const NON_SUBSTANTIVE = new Set([
  '.',
  '-',
  '없음',
  '없습니다',
  '특이사항 없음',
  '특이사항없음',
  '해당없음',
  '해당 없음',
  '무',
  'n/a',
  'na',
]);

export function isSubstantive(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (NON_SUBSTANTIVE.has(trimmed.toLowerCase())) return false;
  // Punctuation-only responses such as "..." or "ㅡ".
  return /[가-힣a-zA-Z0-9]/.test(trimmed);
}

const SYSTEM_PROMPT = `당신은 사내 프로그램 만족도 설문의 주관식 제언을 분류합니다.

수행할 일:
- 각 제언을 긍정(positive) 또는 개선요청(negative)으로 구분합니다.
- 제언의 내용을 대표하는 키워드를 도출합니다. 키워드는 2~6자의 명사구로 짧게 씁니다.
  예: 전문가, 건강정보, 시간제한, 체험확대, 장소, 진행방식
- 비슷한 내용은 같은 키워드로 묶습니다. 키워드 종류를 불필요하게 늘리지 마세요.
- 한 제언에 긍정과 개선 요소가 함께 있으면 두 항목으로 각각 분류합니다.
- "좋아요", "화이팅"처럼 내용이 없는 단순 호응은 분류에서 제외합니다.

반드시 지킬 것:
- 제언 원문을 출력하지 않습니다. 번호(index)로만 지칭합니다.
- 원문을 요약하거나 바꿔 쓰지 않습니다.
- 주어진 번호만 사용합니다. 없는 번호를 만들지 않습니다.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          sentiment: { type: 'string', enum: ['positive', 'negative'] },
          keyword: { type: 'string' },
        },
        required: ['index', 'sentiment', 'keyword'],
        additionalProperties: false,
      },
    },
  },
  required: ['classifications'],
  additionalProperties: false,
} as const;

interface AiClassification {
  index: number;
  sentiment: 'positive' | 'negative';
  keyword: string;
}

/**
 * Returns the analysis, or null when the feature is off, unconfigured, or the call fails.
 *
 * There is no rule-based fallback: grouping feedback by theme is not something a rule can do, and
 * inventing one (say, splitting on satisfaction score) would present a different analysis under
 * the same label. Callers omit the section instead.
 */
export async function analyseSurveyVoc(
  responses: VocResponse[],
  context: { programName: string },
  deps: { resolveProvider?: () => Promise<LlmProvider | null> } = {},
): Promise<VocAnalysis | null> {
  const resolveProvider = deps.resolveProvider ?? (() => getProviderForFeature('survey_summary'));

  const substantive = responses.filter((response) => isSubstantive(response.text));
  if (substantive.length === 0) return null;

  let provider: LlmProvider | null;
  try {
    provider = await resolveProvider();
  } catch {
    return null;
  }
  if (!provider) return null;

  const textByIndex = new Map(substantive.map((response) => [response.index, response.text]));
  const classifications: AiClassification[] = [];
  const knownKeywords = new Set<string>();
  let model: string | null = null;
  let requestId: string | null = null;

  try {
    for (const batch of splitVocBatches(substantive)) {
      const completion = await provider.complete({
        system: SYSTEM_PROMPT,
        // Keywords already chosen are carried into later batches, otherwise the same theme comes
        // back as 전문가 in one batch and 강사 in the next, splitting a single group in two.
        prompt: buildPrompt(batch, context, [...knownKeywords]),
        maxTokens: Math.min(4000, 400 + batch.length * 60),
        jsonSchema: { name: 'voc_classifications', schema: RESPONSE_SCHEMA },
      });

      const parsed = completion.json as { classifications?: AiClassification[] } | null;
      if (!parsed?.classifications) throw new LlmUnavailableError('분류 결과가 없습니다.');

      model ??= completion.model;
      requestId ??= completion.requestId;

      for (const entry of validClassifications(parsed.classifications, textByIndex)) {
        classifications.push(entry);
        knownKeywords.add(entry.keyword);
      }
    }
  } catch {
    return null;
  }

  if (classifications.length === 0 || !model) return null;

  return {
    groups: assembleGroups(classifications, textByIndex),
    totalResponses: responses.length,
    analysedCount: substantive.length,
    classifiedCount: new Set(classifications.map((entry) => entry.index)).size,
    excludedCount: responses.length - substantive.length,
    analysedBy: 'ai',
    model,
    requestId,
  };
}

/**
 * Keeps only classifications that refer to a response actually sent and carry a usable sentiment
 * and keyword. Shared by both paths so an agent's output is filtered exactly as the model's is.
 */
function validClassifications(
  classifications: Array<{ index: number; sentiment: string; keyword: string }>,
  textByIndex: Map<number, string>,
): AiClassification[] {
  const valid: AiClassification[] = [];
  for (const entry of classifications) {
    // Ignore indices the caller invented or that belong to another batch.
    if (!textByIndex.has(entry.index)) continue;
    const keyword = entry.keyword?.trim();
    if (!keyword) continue;
    if (entry.sentiment !== 'positive' && entry.sentiment !== 'negative') continue;
    valid.push({ index: entry.index, sentiment: entry.sentiment, keyword });
  }
  return valid;
}

/**
 * Assembles an analysis from classifications an agent produced through MCP, for deployments where
 * the in-app provider is unavailable.
 *
 * Deliberately runs through the same `assembleGroups` as the AI path: quotes are read from the
 * stored text by index, never from what the agent sent. The no-paraphrasing guarantee therefore
 * holds identically here — an agent cannot put words into an employee's mouth either.
 */
export function buildAgentVocAnalysis(
  responses: VocResponse[],
  classifications: Array<{ index: number; sentiment: string; keyword: string }>,
): VocAnalysis | null {
  const substantive = responses.filter((response) => isSubstantive(response.text));
  if (substantive.length === 0) return null;

  const textByIndex = new Map(substantive.map((response) => [response.index, response.text]));
  const valid = validClassifications(classifications, textByIndex);
  if (valid.length === 0) return null;

  return {
    groups: assembleGroups(valid, textByIndex),
    totalResponses: responses.length,
    analysedCount: substantive.length,
    classifiedCount: new Set(valid.map((entry) => entry.index)).size,
    excludedCount: responses.length - substantive.length,
    analysedBy: 'agent',
    model: null,
    requestId: null,
  };
}

/**
 * Builds the output from the original text, keyed by index.
 *
 * This is where the no-paraphrasing guarantee is enforced: the quote can only ever be whatever was
 * stored, because that is the only place the text is read from.
 */
function assembleGroups(
  classifications: AiClassification[],
  textByIndex: Map<number, string>,
): VocGroup[] {
  const byGroup = new Map<string, { sentiment: 'positive' | 'negative'; keyword: string; indices: Set<number> }>();

  for (const entry of classifications) {
    const key = `${entry.sentiment}:${entry.keyword}`;
    const group = byGroup.get(key) ?? {
      sentiment: entry.sentiment,
      keyword: entry.keyword,
      indices: new Set<number>(),
    };
    group.indices.add(entry.index);
    byGroup.set(key, group);
  }

  return [...byGroup.values()]
    .map((group) => ({
      sentiment: group.sentiment,
      keyword: group.keyword,
      count: group.indices.size,
      responses: [...group.indices]
        .sort((left, right) => left - right)
        .map((index) => textByIndex.get(index))
        .filter((text): text is string => text !== undefined),
    }))
    // Positive first, then by size, matching how the analysis is read.
    .sort(
      (left, right) =>
        Number(right.sentiment === 'positive') - Number(left.sentiment === 'positive') ||
        right.count - left.count ||
        left.keyword.localeCompare(right.keyword),
    );
}

export function splitVocBatches(responses: VocResponse[]): VocResponse[][] {
  const maxChars = env.aiScreeningBatchChars;
  const batches: VocResponse[][] = [];
  let current: VocResponse[] = [];
  let currentChars = 0;

  for (const response of responses) {
    const size = response.text.length + 12;
    if (current.length > 0 && currentChars + size > maxChars) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(response);
    currentChars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function buildPrompt(
  responses: VocResponse[],
  context: { programName: string },
  knownKeywords: string[],
): string {
  return [
    `프로그램: ${context.programName}`,
    knownKeywords.length > 0
      ? `이미 사용 중인 키워드(가능하면 재사용): ${knownKeywords.join(', ')}`
      : null,
    '',
    '아래 제언을 각각 분류하세요.',
    '',
    // Only the model's copy is redacted. Quotes are assembled from the stored original by index,
    // so the report still shows exactly what the respondent wrote.
    ...responses.map((response) => `[${response.index}] ${redactPersonalData(response.text)}`),
  ]
    .filter((line) => line !== null)
    .join('\n');
}
