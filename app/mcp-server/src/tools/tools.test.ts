import assert from 'node:assert/strict';
import test from 'node:test';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { backendRequest } from '../apiClient.js';
import { registerApplicantTools } from './applicants.js';
import { registerGiftTools } from './gifts.js';
import { registerLetterTools } from './letters.js';
import { registerParticipantTools } from './participants.js';
import { registerProgramTools } from './programs.js';
import { registerReportTools } from './reports.js';
import { registerSallyTools } from './sally.js';
import { registerSelectionTools } from './selection.js';
import { withPersonHandles } from '../identity.js';
import { withoutRecipientAddresses } from './letters.js';

interface RegisteredTool {
  description?: string;
  inputSchema: z.ZodType;
  annotations?: { readOnlyHint?: boolean };
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

function registeredTools(server: McpServer): Record<string, RegisteredTool> {
  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
    ._registeredTools;
}

function buildServer(): McpServer {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const backendApiUrl = 'http://backend.test/api/v1';
  registerProgramTools(server, backendApiUrl);
  registerApplicantTools(server, backendApiUrl);
  registerSelectionTools(server, backendApiUrl);
  registerSallyTools(server, backendApiUrl);
  registerParticipantTools(server, backendApiUrl);
  registerLetterTools(server, backendApiUrl);
  registerGiftTools(server, backendApiUrl);
  registerReportTools(server, backendApiUrl);
  return server;
}

function requestRecorder(paths: string[]): typeof backendRequest {
  return async <T>(_backendApiUrl: string, path: string): Promise<T> => {
    paths.push(path);
    return {} as T;
  };
}

const programId = '11111111-1111-4111-8111-111111111111';
const applicantId = '22222222-2222-4222-8222-222222222222';

test('list applicants asks the backend to withhold identity as well as free text', async () => {
  const paths: string[] = [];
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerApplicantTools(server, 'http://backend.test/api/v1', requestRecorder(paths));

  await registeredTools(server).event_automation_list_applicants?.handler({
    program_id: programId,
  });

  assert.deepEqual(paths, [
    `/programs/${programId}/applicants?redact_free_text=true&redact_identity=true`,
  ]);
});

test('list survey responses uses the backend endpoint that redacts responses', async () => {
  const paths: string[] = [];
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerReportTools(server, 'http://backend.test/api/v1', requestRecorder(paths));

  await registeredTools(server).event_automation_list_survey_responses?.handler({
    program_id: programId,
  });

  assert.deepEqual(paths, [`/programs/${programId}/survey-responses`]);
});

test('run selection rejects invalid external assessment guardrails', () => {
  const schema = registeredTools(buildServer()).event_automation_run_selection?.inputSchema;
  assert.ok(schema);
  const base = {
    program_id: programId,
    selection_mode: 'written_justification',
    quality_score_threshold: 0,
    manual_review_count_multiplier: 3,
    override_selections: [],
  };
  const assessment = { applicant_id: applicantId, score: 50, rationale: '근거' };

  assert.equal(
    schema.safeParse({
      ...base,
      external_assessments: [{ ...assessment, applicant_id: 'not-a-uuid' }],
    }).success,
    false,
  );
  for (const score of [-1, 101]) {
    assert.equal(
      schema.safeParse({
        ...base,
        external_assessments: [{ ...assessment, score }],
      }).success,
      false,
    );
  }
  assert.equal(
    schema.safeParse({
      ...base,
      external_assessments: Array.from({ length: 501 }, () => assessment),
    }).success,
    false,
  );
});

test('all tools have descriptions, annotations, and correct read-only hints', () => {
  const tools = registeredTools(buildServer());
  const readOnlyTools = new Set([
    'event_automation_get_program',
    'event_automation_get_recruitment_survey_url',
    'event_automation_get_report',
    'event_automation_list_applicants',
    'event_automation_list_gift_items',
    'event_automation_list_gift_recipients',
    'event_automation_list_letter_templates',
    'event_automation_list_participants',
    'event_automation_list_programs',
    'event_automation_list_survey_responses',
    'event_automation_preview_applicant_upload',
    'event_automation_preview_recruitment_notice',
  ]);

  assert.ok(Object.keys(tools).length > 0);
  for (const [name, tool] of Object.entries(tools)) {
    assert.ok(tool.description?.trim(), `${name} must have a description`);
    assert.ok(tool.annotations, `${name} must have annotations`);
    assert.ok(
      Object.keys(tool.annotations ?? {}).length > 0,
      `${name} annotations must not be empty`,
    );
    assert.equal(
      tool.annotations?.readOnlyHint,
      readOnlyTools.has(name),
      `${name} has the wrong readOnlyHint`,
    );
  }
});

test('a person list keeps what an agent acts on and drops who they are', () => {
  const result = withPersonHandles(
    {
      participants: [
        { id: 'p1', name: '김철수', email: 'a@samsung.com', survey_status: 'completed' },
        { id: 'p2', name: '이영희', email: 'b@samsung.com', survey_status: 'sent' },
      ],
    },
    'participants',
    '참가자',
  ) as { participants: Array<Record<string, unknown>> };

  assert.deepEqual(result.participants, [
    { id: 'p1', survey_status: 'completed', handle: '참가자 1' },
    { id: 'p2', survey_status: 'sent', handle: '참가자 2' },
  ]);
  assert.equal(JSON.stringify(result).includes('samsung.com'), false);
  assert.equal(JSON.stringify(result).includes('김철수'), false);
});

test('a gift item name is not mistaken for a person name', () => {
  const result = withPersonHandles(
    { gift_recipients: [{ id: 'g1', name: '홍길동', gift_item_name: '스타벅스 기프티콘' }] },
    'gift_recipients',
    '수령자',
  ) as { gift_recipients: Array<Record<string, unknown>> };

  assert.equal(result.gift_recipients[0]?.gift_item_name, '스타벅스 기프티콘');
  assert.equal('name' in (result.gift_recipients[0] ?? {}), false);
});

test('the letter preview keeps the letter and drops the address list', () => {
  const result = withoutRecipientAddresses({
    recipients: ['a@samsung.com', 'b@samsung.com'],
    subject: '참여자 모집',
    letter_html: '<html>운동강좌</html>',
  }) as Record<string, unknown>;

  assert.equal(result.recipient_count, 2);
  assert.equal(result.letter_html, '<html>운동강좌</html>');
  assert.equal(result.subject, '참여자 모집');
  assert.equal('recipients' in result, false);
});
