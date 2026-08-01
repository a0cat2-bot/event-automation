import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { backendRequest, toolRequest } from '../apiClient.js';

export function registerReportTools(server: McpServer, backendApiUrl: string): void {
  server.registerTool(
    'event_automation_list_survey_responses',
    {
      description:
        "Lists the free-text survey responses for a program, numbered, so they can be classified into themes. Requires program_id (UUID). Returns { responses } as [{index, text}] covering participants who completed the survey and wrote something; empty and filler answers are already excluded. Contact details and employee numbers written inside a response are redacted. Use these indices with event_automation_generate_report's external_voc when the app's own AI provider is unavailable.",
      inputSchema: z.object({ program_id: z.string().uuid().describe('Program UUID.') }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ program_id }) =>
      toolRequest('List survey responses', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/survey-responses`,
        ),
      ),
  );

  server.registerTool(
    'event_automation_generate_report',
    {
      description:
        "Creates and stores a new results report. Requires program_id, format (markdown, html, or pdf), and at least one include_sections value from summary, participants, survey_results, and gifts. Returns { report } with id, format, summary, and created_at. Markdown/HTML reports contain inline content and no file_path; PDF reports contain file_path and no inline content.\n\nOPTIONAL external_voc: when the app's own AI provider is unavailable, you may group the free-text survey feedback yourself. Read the responses with event_automation_list_survey_responses, then pass [{index, sentiment: 'positive'|'negative', keyword}] here. Sort each response into positive feedback or an improvement request, and give it a short 2-6 character Korean noun phrase as the keyword (전문가, 건강정보, 시간제한, 체험확대, 장소, 진행방식). Reuse a keyword for similar content rather than inventing near-duplicates. A response containing both praise and a complaint gets one entry of each. Leave out contentless encouragement such as 좋아요 or 화이팅. Refer to responses only by index and never send the text back — the report quotes the stored original, so quotes stay exactly as employees wrote them. The report states that the grouping came from an agent.",
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
        format: z.enum(['markdown', 'html', 'pdf']).describe('Report output format.'),
        include_sections: z
          .array(z.enum(['summary', 'participants', 'survey_results', 'gifts']))
          .min(1)
          .describe('Report sections to include.'),
        external_voc: z
          .array(
            z.object({
              index: z.number().int().nonnegative(),
              sentiment: z.enum(['positive', 'negative']),
              keyword: z.string().trim().min(1).max(30),
            }),
          )
          .max(2000)
          .optional()
          .describe('Your own theme grouping of the survey responses, referenced by index.'),
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
