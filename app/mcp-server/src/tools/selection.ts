import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { backendRequest, toolRequest } from '../apiClient.js';

export function registerSelectionTools(server: McpServer, backendApiUrl: string): void {
  server.registerTool(
    'event_automation_run_selection',
    {
      description:
        'Computes participant selection for a program. Requires program_id, selection_mode (which must match the program), nonnegative quality_score_threshold, positive integer manual_review_count_multiplier, and override_selections (use [] for none); each override requires applicant_id, selected, and reason. Set dry_run: true to preview who would be selected and why WITHOUT writing anything (recommended first step — review the list, then call again with dry_run: false and any overrides for people who should be excluded). dry_run: false (the default) replaces the program\'s current participant rows transactionally. Returns a job envelope with dry_run, selected_participants, total_selected, timestamps, and written-justification candidates when applicable.',
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
        selection_mode: z.enum([
          'first_come_first_served',
          'score',
          'written_justification',
        ]),
        quality_score_threshold: z.number().nonnegative(),
        manual_review_count_multiplier: z.number().int().positive(),
        override_selections: z.array(
          z.object({
            applicant_id: z.string().uuid(),
            selected: z.boolean(),
            reason: z.string().min(1).max(255),
          }),
        ),
        dry_run: z
          .boolean()
          .optional()
          .describe('true = preview only, no writes. Defaults to false (commits).'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ program_id, ...body }) =>
      toolRequest('Run selection', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/selection/generate`,
          { method: 'POST', body },
        ),
      ),
  );
}
