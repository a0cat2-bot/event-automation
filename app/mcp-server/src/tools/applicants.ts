import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  backendMultipartRequest,
  backendRequest,
  toolRequest,
} from '../apiClient.js';

const uploadIdentity = {
  program_id: z.string().uuid().describe('Program UUID.'),
  upload_id: z.string().uuid().describe('Staged upload UUID.'),
};

export function registerApplicantTools(server: McpServer, backendApiUrl: string): void {
  server.registerTool(
    'event_automation_upload_applicants',
    {
      description:
        'Stages applicant CSV data for validation without writing applicants yet. Requires program_id and raw csv_content; filename is optional and defaults to applicants.csv. The server creates the multipart csv_file upload. Returns { upload_id, row_count, validation_summary }; use preview and then confirm to inspect and commit it.',
      inputSchema: z.object({
        program_id: z.string().uuid().describe('Program UUID.'),
        csv_content: z.string().describe('Raw CSV text, including its header row.'),
        filename: z.string().min(1).optional().default('applicants.csv').describe('CSV filename.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ program_id, csv_content, filename }) =>
      toolRequest('Upload applicants', () =>
        backendMultipartRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/applicants/upload`,
          csv_content,
          filename,
        ),
      ),
  );

  server.registerTool(
    'event_automation_preview_applicant_upload',
    {
      description:
        'Previews a staged applicant upload. Requires program_id and upload_id; status may be all, errors, warnings, or duplicates, and page/page_size are optional (backend defaults: 1 and 50, maximum page_size 50). Returns upload metadata, validation_summary, pagination totals, matching rows, and validation_issues.',
      inputSchema: z.object({
        ...uploadIdentity,
        status: z.enum(['all', 'errors', 'warnings', 'duplicates']).optional(),
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().max(50).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ program_id, upload_id, status, page, page_size }) =>
      toolRequest('Preview applicant upload', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/applicants/upload/${encodeURIComponent(upload_id)}/preview`,
          { query: { status, page, page_size } },
        ),
      ),
  );

  server.registerTool(
    'event_automation_confirm_applicant_upload',
    {
      description:
        'Consumes a staged upload. Requires program_id, upload_id, action (import or discard), and conflict_resolution (skip_duplicates or overwrite). Import transactionally writes valid rows to applicants and returns imported_count, skipped_count, and failed_count; discard writes nothing and returns { discarded: true }. The upload is removed after either successful action, so repeating the call returns Upload not found.',
      inputSchema: z.object({
        ...uploadIdentity,
        action: z.enum(['import', 'discard']).describe('Import rows or discard the staged upload.'),
        conflict_resolution: z
          .enum(['skip_duplicates', 'overwrite'])
          .describe('How import handles existing external IDs or emails.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ program_id, upload_id, ...body }) =>
      toolRequest('Confirm applicant upload', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/applicants/upload/${encodeURIComponent(upload_id)}/confirm`,
          { method: 'POST', body },
        ),
      ),
  );

  server.registerTool(
    'event_automation_list_applicants',
    {
      description:
        'Lists applicants for a program. Requires program_id (UUID). Returns { applicants } ordered by application time, with IDs, contact fields, score, justification, and timestamps.',
      inputSchema: z.object({ program_id: z.string().uuid().describe('Program UUID.') }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ program_id }) =>
      toolRequest('List applicants', () =>
        backendRequest(
          backendApiUrl,
          `/programs/${encodeURIComponent(program_id)}/applicants`,
        ),
      ),
  );
}
