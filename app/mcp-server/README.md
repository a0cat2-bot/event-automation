# Event Automation MCP Server

This workspace exposes the event-automation backend’s recurring employee-program workflow as MCP tools for internal AI agents. It is an API adapter only: business logic and persistence remain in the existing Express/PostgreSQL backend.

## Running

Install and build from the repository root, then choose a transport:

```bash
npm install
npm run build

# Primary: stateless Streamable HTTP at POST /mcp
MCP_TRANSPORT=http npm run start --workspace mcp-server

# Secondary: local subprocess over stdio
MCP_TRANSPORT=stdio npm run start --workspace mcp-server
```

`MCP_TRANSPORT` accepts `http` (the default) or `stdio`. `BACKEND_API_URL` defaults to `http://localhost:3000/api/v1`. `MCP_PORT` controls the HTTP listener and defaults to `3100`; it is ignored for stdio. The backend must be running and reachable. Protocol messages use stdout in stdio mode, so startup and errors are written only to stderr.

## Tools

- `event_automation_create_program` — Create a program and its selection configuration.
- `event_automation_list_programs` — List non-deleted programs with applicant/participant counts.
- `event_automation_get_program` — Get one program by UUID.
- `event_automation_update_program` — Update one or more program fields.
- `event_automation_upload_applicants` — Stage raw applicant CSV for validation.
- `event_automation_preview_applicant_upload` — Preview and filter a staged CSV upload.
- `event_automation_confirm_applicant_upload` — Import or discard a staged upload.
- `event_automation_list_applicants` — List a program’s committed applicants.
- `event_automation_run_selection` — Regenerate selected participant rows.
- `event_automation_sync_sally_results` — Download and stage Sally survey results.
- `event_automation_list_participants` — List selected participants and workflow statuses.
- `event_automation_notify_participant` — Generate a letter and email it to one participant.
- `event_automation_list_letter_templates` — Discover active human-authored letter templates.
- `event_automation_generate_letter` — Render letters without sending email.
- `event_automation_select_gift_recipients` — Randomly add eligible gift recipients.
- `event_automation_list_gift_recipients` — List a program’s gift recipients.
- `event_automation_generate_report` — Create a markdown, HTML, or PDF results report.
- `event_automation_get_report` — Get a stored results report by UUID.
