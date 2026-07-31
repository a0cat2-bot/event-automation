import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { after, before, test } from 'node:test';

import { LlmUnavailableError, type LlmProvider } from './types.js';

/**
 * Pins the image endpoint's wire format and, more importantly, the two properties that decide
 * whether a generated character is usable at all: the negative prompt that keeps text out of the
 * picture, and preferring the inline payload over the 24h-expiring URL.
 *
 * Runs against a local stub because the real endpoint is internal-network only. config/env.ts
 * snapshots process.env at import, so the environment is set before the module graph loads.
 */

interface CapturedRequest {
  url: string | undefined;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

let server: Server;
let captured: CapturedRequest | null = null;
let respondWith: { status: number; body: unknown; headers?: Record<string, string> } = {
  status: 200,
  body: {},
};
/** Serves the bytes the stub hands out when a test exercises the URL path. */
const REMOTE_IMAGE = Buffer.from('remote-png-bytes');

let generateCharacterImage: typeof import('./imageGeneration.js').generateCharacterImage;

const aiPro: LlmProvider = {
  name: 'ai_pro',
  complete: async () => {
    throw new Error('not used by image generation');
  },
};
const useAiPro = { resolveProvider: async () => aiPro };

before(async () => {
  server = createServer((request, response) => {
    if (request.url?.startsWith('/remote-image')) {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(REMOTE_IMAGE);
      return;
    }

    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      captured = {
        url: request.url,
        headers: request.headers,
        body: JSON.parse(raw || '{}') as Record<string, unknown>,
      };
      response.writeHead(respondWith.status, {
        'Content-Type': 'application/json',
        ...respondWith.headers,
      });
      response.end(JSON.stringify(respondWith.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  process.env.AI_PRO_API_URL = `http://127.0.0.1:${port}/v1`;
  process.env.AI_PRO_API_KEY = 'test-service-key';

  ({ generateCharacterImage } = await import('./imageGeneration.js'));
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function imageReply(data: Array<Record<string, unknown>>) {
  return { request_id: 'req-image-1', data };
}

const PNG_B64 = Buffer.from('inline-png-bytes').toString('base64');

test('posts to the image endpoint with the documented headers and model', async () => {
  respondWith = { status: 200, body: imageReply([{ b64_json: PNG_B64 }]) };
  await generateCharacterImage('청진기를 든 파란 곰', useAiPro);

  assert.equal(captured?.url, '/v1/images/generations');
  assert.equal(captured?.headers['x-api-key'], 'test-service-key');
  assert.equal(captured?.headers['authorization'], undefined);
  assert.match(String(captured?.headers['x-request-id']), /^[0-9a-f-]{36}$/);
  assert.equal(captured?.body.model, 'aipro-image-gen-v1');
});

test('blocks text and Korean lettering through the negative prompt', async () => {
  // A character with invented lettering baked into the artwork is unusable on a letter, and the
  // model cannot render legible Korean, so this is the guard that keeps output shippable.
  respondWith = { status: 200, body: imageReply([{ b64_json: PNG_B64 }]) };
  await generateCharacterImage('마스코트', useAiPro);

  const negative = String(captured?.body.negative_prompt);
  for (const banned of ['text', 'korean characters', 'watermark']) {
    assert.ok(negative.includes(banned), `negative prompt must exclude ${banned}`);
  }
});

test("keeps the coordinator's wording and appends the house style", async () => {
  respondWith = { status: 200, body: imageReply([{ b64_json: PNG_B64 }]) };
  await generateCharacterImage('  청진기를 든 파란 곰  ', useAiPro);

  const prompt = String(captured?.body.prompt);
  assert.ok(prompt.startsWith('청진기를 든 파란 곰,'), 'the description leads, trimmed');
  assert.ok(prompt.includes('no text'));
  assert.ok(prompt.includes('flat vector style'));
});

test('prefers the inline payload over the expiring url', async () => {
  // The url is a 24h internal Object Storage link; persisting it would leave letters pointing at
  // an address that has since expired.
  respondWith = {
    status: 200,
    body: imageReply([{ b64_json: PNG_B64, url: 'http://127.0.0.1:1/remote-image' }]),
  };
  const generated = await generateCharacterImage('마스코트', useAiPro);

  assert.equal(generated?.data.toString(), 'inline-png-bytes');
});

test('downloads the url when no inline payload is returned', async () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  respondWith = {
    status: 200,
    body: imageReply([{ url: `http://127.0.0.1:${port}/remote-image` }]),
  };

  const generated = await generateCharacterImage('마스코트', useAiPro);
  assert.equal(generated?.data.toString(), REMOTE_IMAGE.toString());
});

test("reports AI Pro's request id so a stored asset can be traced", async () => {
  respondWith = {
    status: 200,
    body: imageReply([{ b64_json: PNG_B64 }]),
    headers: { 'X-Request-ID': 'gateway-req-42' },
  };
  const generated = await generateCharacterImage('마스코트', useAiPro);

  assert.equal(generated?.requestId, 'gateway-req-42');
  assert.equal(generated?.model, 'aipro-image-gen-v1');
});

test('returns null — not an error — when the feature is switched off', async () => {
  // The caller distinguishes this from a failure: uploading an image by hand still works.
  assert.equal(
    await generateCharacterImage('마스코트', { resolveProvider: async () => null }),
    null,
  );
});

test('refuses providers that have no image endpoint this app uses', async () => {
  await assert.rejects(
    () =>
      generateCharacterImage('마스코트', {
        resolveProvider: async () => ({ name: 'claude', complete: aiPro.complete }),
      }),
    LlmUnavailableError,
  );
});

test('surfaces an API error rather than saving a broken image', async () => {
  respondWith = { status: 429, body: { error: { message: 'rate limit exceeded' } } };
  await assert.rejects(() => generateCharacterImage('마스코트', useAiPro), (error: Error) => {
    assert.ok(error instanceof LlmUnavailableError);
    assert.match(error.message, /429/);
    assert.match(error.message, /rate limit exceeded/);
    return true;
  });
});

test('an empty result is an error, not a zero-byte image on disk', async () => {
  respondWith = { status: 200, body: imageReply([]) };
  await assert.rejects(() => generateCharacterImage('마스코트', useAiPro), LlmUnavailableError);

  respondWith = { status: 200, body: imageReply([{ b64_json: '' }]) };
  await assert.rejects(() => generateCharacterImage('마스코트', useAiPro), LlmUnavailableError);
});
