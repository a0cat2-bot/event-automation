import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { backendRequest, toolRequest } from '../apiClient.js';

const selectionMode = z.enum(['first_come_first_served', 'score', 'written_justification']);
const programStatus = z.enum([
  'planning',
  'recruitment_active',
  'selection_in_progress',
  'completed',
]);
const programFields = {
  name: z.string().min(1).max(255).describe('Program name.'),
  business_unit: z.string().min(1).max(100).describe('Business unit running the program.'),
  selection_mode: selectionMode.describe('Applicant selection method.'),
  max_participants: z.number().int().positive().max(4999).describe('Maximum participant count.'),
  intake_data: z.record(z.unknown()).optional().describe('Optional free-form intake metadata.'),
  status: programStatus.optional().describe('Optional lifecycle status; defaults to planning.'),
};

const createProgramInput = z.object(programFields);
const updateProgramInput = z
  .object({
    program_id: z.string().uuid().describe('Program UUID.'),
    name: programFields.name.optional(),
    business_unit: programFields.business_unit.optional(),
    selection_mode: programFields.selection_mode.optional(),
    max_participants: programFields.max_participants.optional(),
    intake_data: programFields.intake_data,
    status: programFields.status,
  })
  .refine(({ program_id: _programId, ...fields }) => Object.values(fields).some((v) => v !== undefined), {
    message: 'At least one program field must be supplied',
  });

export function registerProgramTools(server: McpServer, backendApiUrl: string): void {
  server.registerTool(
    'event_automation_create_program',
    {
      description:
        'Creates a program. Requires name, business_unit, selection_mode, and positive max_participants; intake_data and status are optional, with status defaulting to planning. Returns { program } containing the created program, timestamps, and zero applicant_count and participant_count.',
      inputSchema: createProgramInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) =>
      toolRequest('Create program', () =>
        backendRequest(backendApiUrl, '/programs', { method: 'POST', body: input }),
      ),
  );

  server.registerTool(
    'event_automation_list_programs',
    {
      description:
        'Lists every non-deleted program; no parameters are required. Returns { programs } ordered newest first, with each program including applicant_count and participant_count.',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    () => toolRequest('List programs', () => backendRequest(backendApiUrl, '/programs')),
  );

  server.registerTool(
    'event_automation_get_program',
    {
      description:
        'Gets one non-deleted program. Requires program_id (UUID). Returns { program } with applicant_count and participant_count; returns a clear tool error when the program is not found.',
      inputSchema: z.object({ program_id: z.string().uuid().describe('Program UUID.') }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ program_id }) =>
      toolRequest('Get program', () =>
        backendRequest(backendApiUrl, `/programs/${encodeURIComponent(program_id)}`),
      ),
  );

  server.registerTool(
    'event_automation_update_program',
    {
      description:
        'Updates one program. Requires program_id (UUID) and at least one of name, business_unit, selection_mode, max_participants, intake_data, or status. Returns { program } with the final fields and current applicant_count and participant_count.',
      inputSchema: updateProgramInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ program_id, ...body }) =>
      toolRequest('Update program', () =>
        backendRequest(backendApiUrl, `/programs/${encodeURIComponent(program_id)}`, {
          method: 'PUT',
          body,
        }),
      ),
  );
}
