import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { backendRequest, toolRequest } from '../apiClient.js';

export function registerGiftTools(server: McpServer, backendApiUrl: string): void {
  server.registerTool(
    'event_automation_create_gift_item',
    {
      description:
        'Creates a gift catalog entry for a program (e.g. "Starbucks gift card" with a quantity of 20). This is a prerequisite for event_automation_select_gift_recipients — recipients are always selected against one specific gift item, and its quantity caps how many can ever be selected for it. Image upload is UI-only (not exposed here); this tool creates the entry without an image, which can be added later from the web UI. Returns { gift_item }.',
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
        name: z.string().min(1).max(255).describe('Gift name, e.g. "Starbucks gift card".'),
        description: z.string().max(2000).optional().describe('Optional longer description.'),
        quantity: z
          .number()
          .int()
          .positive()
          .max(1000)
          .describe('How many recipients can receive this gift.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ program_id, ...body }) =>
      toolRequest('Create gift item', () =>
        backendRequest(backendApiUrl, `/programs/${encodeURIComponent(program_id)}/gift-items`, {
          method: 'POST',
          body,
        }),
      ),
  );

  server.registerTool(
    'event_automation_list_gift_items',
    {
      description:
        'Lists a program’s gift catalog entries. Requires program_id (UUID). Returns { gift_items } with each item’s name, description, image_url, configured quantity, and selected_count (how many recipients have already been picked for it) — use quantity minus selected_count to see remaining slots before calling event_automation_select_gift_recipients.',
      inputSchema: z.object({ program_id: z.string().uuid().describe('Program UUID.') }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ program_id }) =>
      toolRequest('List gift items', () =>
        backendRequest(backendApiUrl, `/programs/${encodeURIComponent(program_id)}/gift-items`),
      ),
  );

  server.registerTool(
    'event_automation_select_gift_recipients',
    {
      description:
        'Randomly selects gift recipients for one gift catalog item (gift_item_id — create one first with event_automation_create_gift_item), filling up to its remaining quantity (quantity minus already-selected recipients for that item). Eligible participants have a completed survey, are gift-eligible, are not delivered or already recipients of ANY gift, and have their latest satisfaction score at or above minimum_satisfaction_score (optional, backend default 3). Returns selected recipients, requested_count (remaining slots), selected_count, and a warning when fewer were eligible. A later call may validly return selected_count 0 because the item is full or earlier recipients are excluded.',
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
        gift_item_id: z.string().uuid().describe('Gift catalog item UUID to select recipients for.'),
        minimum_satisfaction_score: z
          .number()
          .min(1)
          .max(5)
          .optional()
          .describe('Eligibility threshold from 1 to 5; defaults to 3.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ program_id, ...body }) =>
      toolRequest('Select gift recipients', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/gifts/select`,
          { method: 'POST', body },
        ),
      ),
  );

  server.registerTool(
    'event_automation_list_gift_recipients',
    {
      description:
        'Lists a program’s gift recipients. Requires program_id (UUID). Returns { gift_recipients } with participant identity, selection rank/reason/time, gift delivery state, and applicant name/email.',
      inputSchema: z.object({ program_id: z.string().uuid().describe('Program UUID.') }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ program_id }) =>
      toolRequest('List gift recipients', () =>
        backendRequest(backendApiUrl, `/programs/${encodeURIComponent(program_id)}/gifts`),
      ),
  );
}
