import { randomUUID } from 'node:crypto';

import { env } from '../../config/env.js';
import { getProviderForFeature } from './featureFlags.js';
import { LlmUnavailableError, type LlmProvider } from './types.js';

/**
 * Generates illustration assets through AI Pro's image endpoint.
 *
 * Scope is deliberately narrow: decorative artwork only, never a finished letter. AI Pro's image
 * model is Stable Diffusion 3 based, which cannot render legible Korean, so a generated letter
 * would carry mangled text and — worse — dates and headcounts nobody could verify. Letters stay
 * rendered from data by the HTML pipeline; this supplies the character illustration that sits on
 * top of that layout.
 */

const DEFAULT_BASE_URL = 'https://aipro.samsung.net/v1';
const IMAGE_MODEL = 'aipro-image-gen-v1';
/** The guide allows up to 1,024x1,024 today. Letters show the character in a small circle. */
const IMAGE_SIZE = 1024;
/** Image generation is slower than text; the guide documents a 90s timeout. */
const REQUEST_TIMEOUT_MS = 95_000;

/**
 * Kept out of the caller's prompt so every generated character suits the letter frame, whatever
 * the coordinator types. The negative prompt is what keeps text out of the image: a character with
 * invented Korean lettering baked in would be unusable.
 */
const STYLE_SUFFIX =
  'friendly mascot character illustration, soft rounded shapes, flat vector style, ' +
  'centred single subject, plain light background, gentle pastel palette, no text';
const NEGATIVE_PROMPT =
  'text, letters, words, korean characters, watermark, signature, logo, ' +
  'photorealistic, harsh shadows, cluttered background, multiple subjects';

export interface GeneratedImage {
  /** PNG bytes. Stored by the caller alongside uploaded images so both behave the same. */
  data: Buffer;
  /** AI Pro's own request id, recorded so a generated asset can be traced to its call. */
  requestId: string | null;
  model: string;
}

interface ImageGenerationResponse {
  request_id?: string;
  data?: Array<{ b64_json?: string; url?: string; size_bytes?: number }>;
  error?: { message?: string };
}

/**
 * Returns the generated image, or null when the feature is off or unconfigured.
 *
 * Throws only when generation was attempted and failed, so the caller can distinguish "not
 * available" from "tried and broke" and say so.
 */
export async function generateCharacterImage(
  description: string,
  deps: { resolveProvider?: () => Promise<LlmProvider | null> } = {},
): Promise<GeneratedImage | null> {
  const resolveProvider = deps.resolveProvider ?? (() => getProviderForFeature('character_image'));
  const provider = await resolveProvider();
  if (!provider) return null;

  // The image endpoint is AI Pro's own; the other providers have no equivalent this app uses.
  if (provider.name !== 'ai_pro') {
    throw new LlmUnavailableError(
      `이미지 생성은 AI Pro에서만 지원합니다. 현재 제공자: ${provider.name}`,
    );
  }
  if (!env.aiProApiKey) {
    throw new LlmUnavailableError('AI_PRO_API_KEY is required to generate images.');
  }

  const baseUrl = (env.aiProApiUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const requestId = randomUUID();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.aiProApiKey,
        'X-Request-ID': requestId,
        'X-API-Version': env.aiProApiVersion,
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: `${description.trim()}, ${STYLE_SUFFIX}`,
        negative_prompt: NEGATIVE_PROMPT,
        width: IMAGE_SIZE,
        height: IMAGE_SIZE,
        num_images: 1,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new LlmUnavailableError(
        `이미지 생성이 ${REQUEST_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다.`,
        { cause: error },
      );
    }
    throw new LlmUnavailableError(
      'AI Pro 이미지 생성 요청에 실패했습니다. 사내망 또는 VPN 연결을 확인하세요.',
      { cause: error },
    );
  }

  const bodyText = await response.text();
  if (!response.ok) {
    throw new LlmUnavailableError(
      `AI Pro 이미지 생성 오류 (HTTP ${response.status}, 요청 ${requestId}): ${errorDetail(bodyText)}`,
    );
  }

  let parsed: ImageGenerationResponse;
  try {
    parsed = JSON.parse(bodyText) as ImageGenerationResponse;
  } catch {
    throw new LlmUnavailableError('AI Pro가 JSON이 아닌 응답을 반환했습니다.');
  }

  const first = parsed.data?.[0];
  if (!first) throw new LlmUnavailableError('AI Pro가 이미지를 반환하지 않았습니다.');

  // Prefer the inline payload. The `url` is a 24h internal Object Storage link, so persisting it
  // would leave a letter pointing at an address that expires.
  const data = first.b64_json
    ? Buffer.from(first.b64_json, 'base64')
    : first.url
      ? await downloadImage(first.url)
      : null;
  if (!data || data.length === 0) {
    throw new LlmUnavailableError('AI Pro가 빈 이미지를 반환했습니다.');
  }

  return {
    data,
    requestId: response.headers.get('X-Request-ID') ?? parsed.request_id ?? requestId,
    model: IMAGE_MODEL,
  };
}

async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: env.aiProApiKey ? { 'X-API-Key': env.aiProApiKey } : {},
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new LlmUnavailableError(`생성된 이미지를 내려받지 못했습니다 (HTTP ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function errorDetail(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
    return parsed.error?.message ?? bodyText.slice(0, 500);
  } catch {
    return bodyText.slice(0, 500) || 'no response body';
  }
}
