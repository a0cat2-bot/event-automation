import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { backendRequest, toolRequest } from '../apiClient.js';

export function registerSallyTools(server: McpServer, backendApiUrl: string): void {
  server.registerTool(
    'event_automation_create_sally_survey',
    {
      description:
        'Creates the requested Sally survey through server-side browser automation. On success returns the generated draft and survey_url captured from the address bar after publication; recruitment survey URLs are also stored on the program. A Sally UI mismatch returns the draft with created=false so a human can recover manually.',
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
        kind: z.enum(['recruitment', 'satisfaction']).describe('Survey purpose.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ program_id, kind }) =>
      toolRequest('Create Sally survey', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/sally/surveys/create`,
          { method: 'POST', body: { kind } },
        ),
      ),
  );

  server.registerTool(
    'event_automation_get_recruitment_survey_url',
    {
      description:
        'Reads the Sally recruitment survey URL currently stored on a program. Returns { survey_url }, which is null until automated recruitment-survey creation succeeds.',
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ program_id }) =>
      toolRequest('Read recruitment survey URL', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/sally/surveys/recruitment`,
        ),
      ),
  );

  server.registerTool(
    'event_automation_sync_sally_results',
    {
      description:
        'Uses server-side Playwright automation to log in to sally.coach, find and download the survey whose title exactly equals survey_title, parse it, and stage the resulting rows for the given program_id. This can take up to a couple of minutes. Returns { upload_id, row_count, validation_summary }; failures distinguish login/configuration, survey not found, download, and export parsing problems so the caller can decide whether to retry or correct the title.',
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
        survey_title: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .describe('Exact Sally survey title.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ program_id, survey_title }) =>
      toolRequest('Sync Sally results', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/sally/import`,
          { method: 'POST', body: { survey_title } },
        ),
      ),
  );
}
