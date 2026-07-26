# Employee Program Automation

A reusable web application for running employee-facing programs and events from intake through follow-up. Clone it as a starting point for wellness programs, training cohorts, internal events, campaigns, benefits, or any similar workflow.

The npm-workspace monorepo contains a React 18 frontend, an Express/TypeScript backend, and PostgreSQL. It supports:

- Applicant intake from CSV files or Sally survey-tool exports.
- Configurable letters using either a freeform drag-and-drop editor or category-based standard layouts.
- First-come-first-served, score-based, and written-justification participant selection.
- Branded PDF and PNG letter generation.
- Notification email through a swappable provider layer (Gmail today; an internal portal can be added later).
- Optional satisfaction-survey synchronization through browser automation for [Sally](https://sally.coach/).

The EHS/KEMA content included in seed data and example letter templates is only a worked example. Adopters are expected to replace the organization name in the in-app **Organization Settings** page and configure their own letter categories and templates.

[`DESIGN.md`](./DESIGN.md) is retained as a historical record of the original EHS-focused build. It includes decisions that no longer describe current behavior, including the removed authentication and RBAC design.

## Prerequisites

- Node.js 20 or newer and npm 10 or newer (`node --version` / `npm --version`)
- Docker Engine with Docker Compose v2
- `psql` is optional; the commands below run it inside the PostgreSQL container

On a fresh WSL2/Ubuntu installation, make Docker Desktop available through WSL integration and install the browser dependencies and binary used by letter generation and Sally automation:

```bash
sudo npx playwright install-deps chromium
npx playwright install chromium
```

## Install

From the repository root:

```bash
cd app
npm install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

The example environment files use the Docker PostgreSQL defaults and local development ports. `SALLY_EMAIL` and `SALLY_PASSWORD` are needed only for Sally automation. Gmail notification delivery requires the Gmail variables documented in `backend/.env.example`. Never commit real credentials or local `.env` files.

## Start PostgreSQL and apply migrations

```bash
docker compose up -d postgres
docker compose ps
```

After the health check passes, apply the migrations in order:

```bash
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U app -d app_db < backend/db/migrations/001_initial_schema.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U app -d app_db < backend/db/migrations/002_letter_editor_fields.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U app -d app_db < backend/db/migrations/003_letter_categories.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U app -d app_db < backend/db/migrations/004_remove_auth.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U app -d app_db < backend/db/migrations/005_genericize_org_default.sql
```

Stop services without deleting the database volume with `docker compose down`.

## Run the app

```bash
npm run dev
```

- Frontend: <http://localhost:5173>
- Backend health check: <http://localhost:3000/health>
- Backend API: <http://localhost:3000/api/v1>

Run either side independently with `npm run dev:backend` or `npm run dev:frontend`.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
cd backend && npm test
```

## Project layout

```text
app/
├── backend/
│   ├── db/migrations/    # PostgreSQL schema migrations
│   └── src/              # API, selection, letters, email, and Sally automation
├── frontend/
│   └── src/              # React UI, API clients, components, and pages
├── docker-compose.yml
├── DESIGN.md             # Historical EHS-focused design record
└── package.json          # Workspace scripts
```
