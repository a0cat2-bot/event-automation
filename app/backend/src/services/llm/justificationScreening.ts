import { getProviderForFeature } from './featureFlags.js';
import { LlmUnavailableError, type LlmProvider } from './types.js';

export interface JustificationCandidate {
  applicantId: string;
  justification: string | null;
}

export interface JustificationAssessment {
  applicantId: string;
  /** 0-100. Comparable only within a single screening run. */
  qualityScore: number;
  /** Why this score was given, shown to the coordinator. Never empty on an AI result. */
  rationale: string | null;
  /** How the score was produced, so the UI and audit log never imply AI where there was none. */
  method: 'ai' | 'heuristic';
  /** Populated on heuristic results; the AI path explains itself in `rationale` instead. */
  matchedKeywords: string[];
}

export interface ScreeningOutcome {
  assessments: JustificationAssessment[];
  method: 'ai' | 'heuristic';
  /** Model id when method is 'ai' — recorded in the audit log for traceability. */
  model: string | null;
  /** Set when AI was requested but could not run, so the caller can surface why. */
  fallbackReason: string | null;
}

const SYSTEM_PROMPT = `당신은 사내 프로그램 지원자의 서술형 지원서를 심사하는 보조자입니다.

평가 원칙:
- 지원 동기의 구체성과 진정성을 봅니다. 글의 길이는 그 자체로 점수가 아닙니다.
- 같은 말을 반복하거나 분량만 채운 글은 낮게 평가합니다.
- 짧아도 구체적인 경험과 이유가 담겼다면 높게 평가합니다.
- 맞춤법이나 문장력보다 내용을 봅니다.
- 지원자의 이름, 성별, 부서, 직급으로 추측되는 어떤 요소도 평가에 반영하지 않습니다.
  그런 정보가 글에 있더라도 무시하고 오직 지원 내용만 평가합니다.

각 지원자에 대해 0-100 점수와, 그 점수를 준 이유를 한국어 한두 문장으로 씁니다.
이유는 코디네이터가 읽고 판단을 검토할 수 있도록 구체적으로 씁니다.

당신의 점수는 최종 결정이 아니라 코디네이터의 검토를 돕는 참고 자료입니다.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          applicant_id: { type: 'string' },
          score: { type: 'number' },
          rationale: { type: 'string' },
        },
        required: ['applicant_id', 'score', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['assessments'],
  additionalProperties: false,
} as const;

interface AiResponse {
  assessments: Array<{ applicant_id: string; score: number; rationale: string }>;
}

/**
 * Scores written justifications, preferring the LLM and falling back to the built-in heuristic.
 *
 * Never throws for AI reasons: if the feature is off, unconfigured, or the call fails, the
 * heuristic result is returned with `fallbackReason` set. Selection must keep working in
 * environments where AI is unavailable.
 */
export async function screenJustifications(
  candidates: JustificationCandidate[],
  context: { programName: string; programDescription: string | null },
  // Injectable so tests can pin the gate instead of depending on ambient env and database state —
  // without it a test asserting the fallback silently makes a paid API call when a developer has
  // a provider configured locally.
  deps: { resolveProvider?: () => Promise<LlmProvider | null> } = {},
): Promise<ScreeningOutcome> {
  const resolveProvider =
    deps.resolveProvider ?? (() => getProviderForFeature('justification_screening'));
  const heuristic = () =>
    candidates.map<JustificationAssessment>((candidate) => ({
      applicantId: candidate.applicantId,
      ...heuristicQuality(candidate.justification),
      method: 'heuristic' as const,
    }));

  if (candidates.length === 0) {
    return { assessments: [], method: 'heuristic', model: null, fallbackReason: null };
  }

  let provider: LlmProvider | null;
  try {
    provider = await resolveProvider();
  } catch (error) {
    return {
      assessments: heuristic(),
      method: 'heuristic',
      model: null,
      fallbackReason: `AI 설정을 확인하지 못했습니다: ${errorText(error)}`,
    };
  }

  if (!provider) {
    return { assessments: heuristic(), method: 'heuristic', model: null, fallbackReason: null };
  }

  try {
    const completion = await provider.complete({
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(candidates, context),
      maxTokens: Math.min(16000, 400 + candidates.length * 220),
      jsonSchema: { name: 'justification_assessments', schema: RESPONSE_SCHEMA },
    });

    const parsed = completion.json as AiResponse | null;
    if (!parsed?.assessments) throw new LlmUnavailableError('AI 응답에 평가 결과가 없습니다.');

    const byId = new Map(parsed.assessments.map((entry) => [entry.applicant_id, entry]));
    // Any applicant the model skipped falls back individually rather than failing the whole run.
    const assessments = candidates.map<JustificationAssessment>((candidate) => {
      const entry = byId.get(candidate.applicantId);
      if (!entry || !Number.isFinite(entry.score)) {
        return {
          applicantId: candidate.applicantId,
          ...heuristicQuality(candidate.justification),
          method: 'heuristic' as const,
        };
      }
      return {
        applicantId: candidate.applicantId,
        qualityScore: clamp(entry.score, 0, 100),
        rationale: entry.rationale?.trim() || null,
        method: 'ai' as const,
        matchedKeywords: [],
      };
    });

    return { assessments, method: 'ai', model: completion.model, fallbackReason: null };
  } catch (error) {
    return {
      assessments: heuristic(),
      method: 'heuristic',
      model: null,
      fallbackReason: `AI 평가에 실패해 기본 방식으로 채점했습니다: ${errorText(error)}`,
    };
  }
}

function buildPrompt(
  candidates: JustificationCandidate[],
  context: { programName: string; programDescription: string | null },
): string {
  const entries = candidates
    .map(
      (candidate) =>
        `<지원자 id="${candidate.applicantId}">\n${candidate.justification?.trim() || '(작성 내용 없음)'}\n</지원자>`,
    )
    .join('\n\n');

  return [
    `프로그램: ${context.programName}`,
    context.programDescription ? `프로그램 설명: ${context.programDescription}` : null,
    '',
    `아래 ${candidates.length}명의 지원 내용을 각각 평가하세요. 모든 지원자에 대해 빠짐없이 결과를 내야 합니다.`,
    '',
    entries,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Language-neutral fallback used whenever AI is unavailable.
 *
 * This is a coarse pre-filter, not a judgement of writing quality — a rule can't assess whether a
 * motivation is genuine, so the coordinator still decides. It deliberately avoids the
 * English-only keyword list and English-syllable readability formula it replaced, which scored
 * every Korean submission on length alone and so ranked padded text above concise, specific text.
 */
export function heuristicQuality(text: string | null): {
  qualityScore: number;
  rationale: string | null;
  matchedKeywords: string[];
} {
  const justification = (text ?? '').trim();
  if (!justification) {
    return { qualityScore: 0, rationale: '작성 내용이 없습니다.', matchedKeywords: [] };
  }

  // Repetition discounts length rather than being scored alongside it. Adding the two lets pure
  // padding win on length despite near-zero variety, which is exactly the inversion this replaces;
  // multiplying means repeating yourself shrinks your effective length instead.
  const tokens = justification.split(/\s+/).filter(Boolean);
  const distinctRatio = tokens.length > 0 ? new Set(tokens).size / tokens.length : 1;

  // Character-based, so Korean and Latin scripts behave the same. Saturates so that beyond a
  // reasonable length more text stops earning more score.
  const effectiveLength = justification.length * distinctRatio;
  const qualityScore = Math.round(Math.min(effectiveLength / 300, 1) * 100);
  const repetitive = distinctRatio < 0.5;

  return {
    qualityScore,
    rationale: repetitive
      ? '규칙 기반 채점: 같은 표현이 많이 반복되어 낮게 평가했습니다. 내용 검토가 필요합니다.'
      : '규칙 기반 채점: 분량과 표현의 다양성만 반영한 참고 점수입니다. 내용은 직접 확인하세요.',
    matchedKeywords: [],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
