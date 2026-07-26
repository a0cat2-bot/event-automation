import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { backendRequest, toolRequest } from '../apiClient.js';

export function registerReportTools(server: McpServer, backendApiUrl: string): void {
  server.registerTool(
    'event_automation_generate_report',
    {
      description:
        'Creates and stores a new results report. Requires program_id, format (markdown, html, or pdf), and at least one include_sections value from summary, participants, survey_results, and gifts. Returns { report } with id, format, summary, and created_at. Markdown/HTML reports contain inline content and no file_path; PDF reports contain file_path and no inline content.',
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
        format: z.enum(['markdown', 'html', 'pdf']).describe('Report output format.'),
        include_sections: z
          .array(z.enum(['summary', 'participants', 'survey_results', 'gifts']))
          .min(1)
          .describe('Report sections to include.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ program_id, ...body }) =>
      toolRequest('Generate report', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/reports/generate`,
          { method: 'POST', body },
        ),
      ),
  );

  server.registerTool(
    'event_automation_get_report',
    {
      description:
        'Gets one stored results report. Requires program_id and report_id (UUIDs). Returns { report } with format, summary, created_at, and either inline content for markdown/HTML or file_path for PDF; returns Results report not found when the IDs do not identify a report.',
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
        report_id: z.string().uuid().describe('Results-report UUID.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ program_id, report_id }) =>
      toolRequest('Get report', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/reports/${encodeURIComponent(report_id)}`,
        ),
      ),
  );
}
