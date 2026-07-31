import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { after, before, test } from 'node:test';

/**
 * Pins the wire format against the AI Pro API developer guide (v1).
 *
 * The real endpoint is internal-network only, so these run against a local stub. That is enough to
 * catch the mistakes that actually matter here — the guide's shapes differ from the public OpenAI
 * and Anthropic APIs in ways that are easy to get wrong (`X-API-Key` rather than a bearer token,
 * and `response_format: {type: "json_object", schema}` rather than OpenAI's nested `json_schema`).
 *
 * config/env.ts snapshots process.env at import, so the environment is set before the module graph
 * is loaded. node:test runs each file in its own process, so this does not leak into other tests.
 */

interface CapturedRequest {
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

let server: Server;
let captured: CapturedRequest | null = null;
let respondWith: { status: number; body: unknown; headers?: Record<string, string> } = {
  status: 200,
  body: {},
};

type AiProModule = typeof import('./aiProProvider.js');
let AiProProvider: AiProModule['AiProProvider'];

before(async () => {
  server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      captured = { headers: request.headers, body: JSON.parse(raw || '{}') as Record<string, unknown> };
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
  process.env.LLM_MODEL = 'aipro-claude-sonnet';

  ({ AiProProvider } = await import('./aiProProvider.js'));
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function openAiReply(content: string) {
  return {
    id: 'chatcmpl-123',
    object: 'chat.completion',
    model: 'aipro-claude-sonnet',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
  };
}

test('authenticates with X-API-Key, not a bearer token', async () => {
  respondWith = { status: 200, body: openAiReply('ok') };
  await new AiProProvider().complete({ system: 'sys', prompt: 'hello' });

  assert.equal(captured?.headers['x-api-key'], 'test-service-key');
  assert.equal(captured?.headers['authorization'], undefined, 'must not send an Authorization header');
});

test('sends a request id and an API version for tracing', async () => {
  respondWith = { status: 200, body: openAiReply('ok') };
  await new AiProProvider().complete({ system: 'sys', prompt: 'hello' });

  assert.match(
    String(captured?.headers['x-request-id']),
    /^[0-9a-f-]{36}$/,
    'X-Request-ID must be a UUID so it can be matched against the platform audit log',
  );
  assert.equal(captured?.headers['x-api-version'], 'v1');
});

test('uses the OpenAI-compatible body by default, with system inside messages', async () => {
  respondWith = { status: 200, body: openAiReply('ok') };
  await new AiProProvider().complete({ system: 'sys', prompt: 'hello', maxTokens: 1234 });

  assert.equal(captured?.headers['x-model-style'], undefined, 'default style sends no style header');
  assert.equal(captured?.body.model, 'aipro-claude-sonnet');
  assert.equal(captured?.body.max_tokens, 1234);
  assert.deepEqual(captured?.body.messages, [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hello' },
  ]);
  assert.equal(captured?.body.system, undefined, 'OpenAI style must not lift system to the top level');
});

test('requests structured output in AI Pro\'s shape, not the public OpenAI one', async () => {
  respondWith = { status: 200, body: openAiReply('{"score":85}') };
  const schema = {
    type: 'object',
    properties: { score: { type: 'integer' } },
    required: ['score'],
  };

  const completion = await new AiProProvider().complete({
    system: 'sys',
    prompt: 'hello',
    jsonSchema: { name: 'assessment', schema },
  });

  // The guide documents {type: "json_object", schema}. OpenAI's public API uses
  // {type: "json_schema", json_schema: {name, schema}} — sending that here would be rejected.
  assert.deepEqual(captured?.body.response_format, { type: 'json_object', schema });
  assert.deepEqual(completion.json, { score: 85 });
});

test('reports usage, model and the server request id back to the caller', async () => {
  respondWith = {
    status: 200,
    body: openAiReply('ok'),
    headers: { 'X-Request-ID': 'server-assigned-id' },
  };

  const completion = await new AiProProvider().complete({ system: 'sys', prompt: 'hello' });

  assert.equal(completion.model, 'aipro-claude-sonnet');
  assert.equal(completion.inputTokens, 123);
  assert.equal(completion.outputTokens, 45);
  assert.equal(completion.requestId, 'server-assigned-id');
});

test('surfaces the gateway error message rather than a bare status code', async () => {
  respondWith = { status: 429, body: { error: { message: 'Too Many Requests' } } };

  await assert.rejects(
    () => new AiProProvider().complete({ system: 'sys', prompt: 'hello' }),
    (error: unknown) => {
      assert.match((error as Error).message, /Too Many Requests/);
      // The request id is included so a failed call can still be traced.
      assert.match((error as Error).message, /request [0-9a-f-]{36}/);
      return true;
    },
  );
});

test('a response that ignores the schema is rejected rather than acted on', async () => {
  // The guide documents no fallback mode, so a model may return prose. Callers must degrade to
  // their non-AI path rather than receive a half-parsed result.
  respondWith = { status: 200, body: openAiReply('점수는 85점입니다.') };

  await assert.rejects(
    () =>
      new AiProProvider().complete({
        system: 'sys',
        prompt: 'hello',
        jsonSchema: { name: 'assessment', schema: { type: 'object' } },
      }),
    /not valid JSON/,
  );
});

test('tolerates a fenced JSON block, which models often emit anyway', async () => {
  respondWith = { status: 200, body: openAiReply('```json\n{"score":72}\n```') };

  const completion = await new AiProProvider().complete({
    system: 'sys',
    prompt: 'hello',
    jsonSchema: { name: 'assessment', schema: { type: 'object' } },
  });

  assert.deepEqual(completion.json, { score: 72 });
});
