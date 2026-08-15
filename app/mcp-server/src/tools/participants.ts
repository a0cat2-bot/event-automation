import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { backendRequest, toolRequest } from '../apiClient.js';
import { withPersonHandles } from '../identity.js';

export function registerParticipantTools(server: McpServer, backendApiUrl: string): void {
  server.registerTool(
    'event_automation_list_participants',
    {
      description:
        'Lists selected participants for a program. Requires program_id (UUID). Returns { participants } ordered by selection rank, each with its id, a display handle, selection reason, notification fields, survey status, and gift eligibility/status. Names and email addresses are not returned; act on a participant by id and refer to one by handle.',
      inputSchema: z.object({ program_id: z.string().uuid().describe('Program UUID.') }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ program_id }) =>
      toolRequest('List participants', async () =>
        withPersonHandles(
          await backendRequest(
            backendApiUrl,
            `/programs/${encodeURIComponent(program_id)}/participants`,
          ),
          'participants',
          '참가자',
        ),
      ),
  );

  server.registerTool(
    'event_automation_notify_participant',
    {
      description:
        'Generates a branded letter from template_id for one selected participant and sends it in a real email to that applicant in the same operation. Requires program_id, participant_id, and template_id (all UUIDs). Returns { participant } with notification_status sent, notification_sent_at, and notification_letter_id. Calling twice sends two emails.',
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
        participant_id: z.string().uuid().describe('Participant UUID.'),
        template_id: z.string().uuid().describe('Active letter-template UUID.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ program_id, participant_id, template_id }) =>
      toolRequest('Notify participant', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/participants/${encodeURIComponent(participant_id)}/notify`,
          { method: 'POST', body: { template_id } },
        ),
      ),
  );
}
