import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { backendRequest, toolRequest } from '../apiClient.js';

export function registerLetterTools(server: McpServer, backendApiUrl: string): void {
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
