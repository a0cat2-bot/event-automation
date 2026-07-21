# EHS Wellness Program Automation

Automates the recurring AX센터 EHS program cycle described in [`DESIGN.md`](./DESIGN.md): program setup, applicant intake (CSV upload or Sally survey import), participant selection, branded letter generation, and (still pending) gift selection and reporting.

npm-workspace monorepo: React 18 frontend, Express/TypeScript backend, PostgreSQL. Puppeteer renders letters to PDF; Playwright automates Sally (login + survey results download) since Sally has no public API.

## Prerequisites

- Node.js 20 or newer and npm 10 or newer (`node --version` / `npm --version`)
- Docker Engine with Docker Compose v2
- `psql` is optional; the documented migration command runs it inside the container

### Running on Windows via WSL2 — read this first

If you're setting this up inside WSL2 (Ubuntu), two things fail silently on a fresh install and both come from the same root cause: **headless Chrome needs its sandbox disabled and a handful of system libraries that a bare Ubuntu install doesn't ship with.** Both letter generation (Puppeteer) and Sally automation (Playwright) launch headless Chrome, so both are affected.

1. **Docker must be reachable from inside WSL2.** Install Docker Desktop on the Windows side and enable *Settings → Resources → WSL Integration* for your distro. Running `docker ps` inside the WSL shell should work without errors before you continue.
2. **Install Chromium's OS-level dependencies** (the app's own Chrome launches already pass `--no-sandbox`, which is required inside WSL2/containers — but the shared libraries still have to exist on disk):
   ```bash
   sudo npx playwright install-deps chromium
   ```
   This is the single most common failure point on a fresh WSL2/Ubuntu box — without it, Puppeteer/Playwright fail to launch with a missing shared library error (`libnss3.so`, `libatk-1.0.so`, etc. — not a sandbox error) even after `--no-sandbox` is set.
3. **Download the browser binaries** (separate from the OS libraries above):
   ```bash
   npx playwright install chromium
   ```
   Puppeteer downloads its own Chromium automatically during `npm install`; this command is specifically for Playwright's copy (used by the Sally integration).
4. Everything else below (Docker Postgres, `npm run dev`, ports) works the same as native Linux/macOS — WSL2's localhost port forwarding to Windows is automatic in current versions.

## Install

From the repository root:

```bash
npm install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

The checked-in defaults work with the Docker PostgreSQL service and local development ports. `SALLY_EMAIL`/`SALLY_PASSWORD` in `backend/.env` are only required when you actually call the Sally import endpoint — leave them blank otherwise. Never commit `backend/.env` (it's gitignored) or paste real credentials into any file that isn't `.env`.

## Start PostgreSQL and run the migrations

Start the database:

```bash
docker compose up -d postgres
docker compose ps
```

Apply the schema after the health check passes — both migrations are safe to re-run (idempotent) if you're not sure whether they already applied:

```bash
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U ehs -d ehs_app < backend/db/migrations/001_initial_schema.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U ehs -d ehs_app < backend/db/migrations/002_letter_editor_fields.sql
```

001 creates the nine DESIGN.md §3 entities. 002 adds the letter template editor's `background_image_url` / `canvas_width` / `canvas_height` / `text_fields` columns.

### Seed a local development login

> **Local development only — do not use these credentials anywhere real.**

```bash
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U ehs -d ehs_app < backend/db/seed/001_seed_admin.sql
```

- Email: `admin@ehs.local`
- Password: `Admin123!`

Idempotent by email; reruns restore the account to an active admin without duplicating it.

To stop services without removing the database volume:

```bash
docker compose down
```

## Run the development servers

```bash
npm run dev
```

- Frontend: <http://localhost:5173>
- Backend health check: <http://localhost:3000/health>
- Backend API base: <http://localhost:3000/api/v1>

Independently: `npm run dev:backend`, `npm run dev:frontend`.

## Verification commands

```bash
npm run typecheck
npm run lint
npm run build
npm run test
npm run format:check
```

## What is implemented

- **Auth (§11)** — bcrypt login, 24-hour JWT in an httpOnly cookie (Secure flag is environment-conditional — off in dev over plain HTTP, on in production), logout, current-user lookup, RBAC middleware (admin/coordinator/viewer), business-unit isolation.
- **Applicant import (§5)** — CSV upload → preview → confirm, per-selection-mode validation, duplicate detection (in-upload and against committed data), skip/overwrite conflict resolution, 5000-row warning threshold.
- **Participant selection (§6)** — first-come-first-served, score-based, and written-justification (two-phase: automated candidate scoring + manual override) selection, with audit logging. Implemented synchronously (no job queue) since candidate volumes don't need one yet — see the TODO comment in `selection.ts` before changing that assumption.
- **Letter templates & generation (§4)** — template CRUD, background-image upload, a drag-and-drop text-field editor (React + Konva) for positioning placeholders over the background, Puppeteer PDF rendering with content-hash caching. Four KEMA-branded templates (recruitment, winner notification, satisfaction-survey + gift, not-selected) exist as a reference example; check the seeded data or recreate via the editor UI.
- **Sally import (§7, partial)** — Playwright automates login (session reused via saved storage state) and results-export download for a named survey; the export is parsed into staged applicant rows through the same preview/confirm flow as CSV upload. **Survey creation/duplication is not automated** — create/duplicate the survey in Sally manually, then call the import endpoint with its title. This path has been validated against a real Sally export file's structure but not yet run end-to-end against a live login (that requires real Sally credentials — test it yourself with `SALLY_EMAIL`/`SALLY_PASSWORD` set).
- Program CRUD, list/detail, and route stubs beyond the above.

## What remains stubbed or missing

| Capability | Spec | Location |
| --- | --- | --- |
| Gift eligibility, random selection, manual override | §10 | `backend/src/routes/gifts.ts` |
| Report rendering and Confluence draft posting | §9 | `backend/src/routes/reports.ts` |
| Sally survey creation/duplication automation | §7 | `backend/src/services/sally.ts` (TODO comment marks the gap) |
| Frontend data wiring beyond the letter editor | §8 | `frontend/src/pages/` (Dashboard, Program Setup, Applicant Upload, Selection Review, Survey Results, Gift Selection, Results Report are page shells only) |
| User-management CRUD (creating/editing other users) | §11 | not started |
| Audit log query/export UI | §11 | not started |

Full route-by-route RBAC and DB row-level security beyond what's listed above remain deferred.

## Project layout

```text
.
├── backend/
│   ├── db/
│   │   ├── migrations/    # 001 initial schema, 002 letter editor fields
│   │   └── seed/          # Local dev admin account
│   └── src/
│       ├── config/        # Environment configuration
│       ├── db/            # PostgreSQL pool wiring
│       ├── middleware/    # Validation, JWT authentication, RBAC helpers
│       ├── routes/        # One file per API resource area
│       ├── schemas/       # Zod request contracts
│       ├── services/      # Sally automation/import, letter-related logic
│       └── utils/
├── frontend/
│   └── src/
│       ├── api/           # Backend API clients (letter templates)
│       ├── components/    # App layout and reusable page shell
│       ├── config/        # Backend base URL
│       └── pages/         # DESIGN.md §8 routes
├── docker-compose.yml
├── DESIGN.md
└── package.json
```
