import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { backendRequest, toolRequest } from '../apiClient.js';

export function registerLetterTools(server: McpServer, backendApiUrl: string): void {
  server.registerTool(
    'event_automation_prepare_recruitment_notice',
    {
      description:
        'Validates, case-insensitively de-duplicates, and saves the manually supplied recruitment recipient list for a program. This is the preparation step before preview; pass an empty list to clear it. Knox Portal contacts are not available yet, so deployments using that source return a clear instruction to use the manual source.',
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
        emails: z.array(z.string().email()).max(5_000).describe('Employee email addresses.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ program_id, emails }) =>
      toolRequest('Prepare recruitment notice recipients', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/recruitment-notice/recipients`,
          { method: 'PUT', body: { emails } },
        ),
      ),
  );

  server.registerTool(
    'event_automation_preview_recruitment_notice',
    {
      description:
        'Dry-runs a recruitment notice without writing or sending anything. Returns exactly which saved recipients would receive it, the subject and email body, the fully rendered letter HTML, and the Sally CTA URL/text. Use this preview before any confirmed send.',
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
        template_id: z.string().uuid().describe('Recruitment letter-template UUID.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ program_id, template_id }) =>
      toolRequest('Preview recruitment notice', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/recruitment-notice/preview`,
          { method: 'POST', body: { template_id } },
        ),
      ),
  );

  server.registerTool(
    'event_automation_send_recruitment_notice',
    {
      description:
        'Irreversibly sends the recruitment letter to real employee addresses. A human is expected to have reviewed event_automation_preview_recruitment_notice first; call this only with confirmed=true after that review. Returns a sent/failed outcome for every recipient, and one failure does not stop the others.',
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
        template_id: z.string().uuid().describe('Recruitment letter-template UUID.'),
        confirmed: z.literal(true).describe('Explicit confirmation after human preview review.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ program_id, template_id, confirmed }) =>
      toolRequest('Send recruitment notice', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/recruitment-notice/send`,
          { method: 'POST', body: { template_id, confirmed } },
        ),
      ),
  );

  server.registerTool(
    'event_automation_list_letter_templates',
    {
      description:
        'Lists active letter templates so callers can discover template IDs for letter generation or participant notification. Optional template_type filters to recruitment, notification, or gift_notification. Returns { templates } with template identity, brand/output/layout metadata, version, active state, dimensions, and standard content; template editing remains a human web-UI task.',
      inputSchema: z.object({
        template_type: z
          .enum(['recruitment', 'notification', 'gift_notification'])
          .optional()
          .describe('Optional template-type filter.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ template_type }) =>
      toolRequest('List letter templates', () =>
        backendRequest(backendApiUrl, '/letter-templates', { query: { template_type } }),
      ),
  );

  server.registerTool(
    'event_automation_generate_letter',
    {
      description:
        'Renders branded letters without sending email. Requires template_id, program_id, one or more applicant_ids, and a non-empty brand_variant. Returns generated_count, cached_count, failed_count, and results with a per-applicant generated/cached/failed status plus generated-letter metadata such as id and file_path or an error. Use notify_participant instead when generation and email delivery should happen together.',
      inputSchema: z.object({
        template_id: z.string().uuid().describe('Active letter-template UUID.'),
        program_id: z.string().uuid().describe('Program UUID.'),
        applicant_ids: z.array(z.string().uuid()).min(1).describe('Applicant UUIDs to render.'),
        brand_variant: z.string().min(1).max(50).describe('Brand variant used for rendering.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) =>
      toolRequest('Generate letter', () =>
        backendRequest(backendApiUrl, '/letters/generate', { method: 'POST', body: input }),
      ),
  );
}
