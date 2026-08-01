# Employee Program Automation

A reusable web application for running employee-facing programs and events from intake through follow-up. Clone it as a starting point for wellness programs, training cohorts, internal events, campaigns, benefits, or any similar workflow.

The npm-workspace monorepo contains a React 18 frontend, an Express/TypeScript backend, and PostgreSQL. It supports:

- Applicant intake from CSV files or Sally survey-tool exports.
- Configurable letters using either a freeform drag-and-drop editor or category-based standard layouts.
- First-come-first-served, score-based, and written-justification participant selection.
- Branded PDF and PNG letter generation.
- Notification email through a swappable provider layer (Gmail today; an internal portal can be added later).
- Optional satisfaction-survey synchronization through browser automation for [Sally](https://sally.coach/).

The historical design material uses EHS/KEMA as a worked example. Fresh installs start with a
generic organization and no programs or applicants; adopters configure their own organization,
letter templates, and program data in the app.

[`DESIGN.md`](./DESIGN.md) is retained as a historical record of the original EHS-focused build. It includes decisions that no longer describe current behavior, including the removed authentication and RBAC design.

## Prerequisites

- Node.js 20 or newer and npm 10 or newer (`node --version` / `npm --version`)
- Docker Engine with Docker Compose v2

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

## Start everything with Docker

```bash
docker compose up --build
```

This starts PostgreSQL, applies every pending migration in filename order, installs the minimal
seed data, and serves the web app and API together. Open <http://localhost:3000>. Migration
checksums are recorded in `schema_migrations`; startup stops instead of guessing if an applied SQL
file changes.

PostgreSQL is exposed on host port 5432 by default. If another local container or service already
uses that port, keep the container's internal configuration unchanged and choose another host port:

```bash
POSTGRES_PORT=5433 docker compose up --build
```

Stop services without deleting the database volume with `docker compose down`.

## Run locally for development

Start only PostgreSQL (use `POSTGRES_PORT=5433` here too if port 5432 is occupied), then run the
same migration and seed entry points used by the app container:

```bash
docker compose up -d postgres
npm run migrate
npm run seed
npm run dev
```

- Frontend: <http://localhost:5173>
- Backend health check: <http://localhost:3000/health>
- Backend API: <http://localhost:3000/api/v1>

Run either side independently with `npm run dev:backend` or `npm run dev:frontend`.

The seed is idempotent and intentionally contains no programs or applicants. It creates only one
`Default` business unit, the seven built-in letter categories, and the fallback organization
settings row. Rename the business unit and organization from the app before using it with a team.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
npm test
```

## Project layout

```text
app/
├── backend/
│   ├── db/migrations/    # Ordered PostgreSQL schema migrations
│   ├── db/seed/          # Idempotent minimum startup data
│   └── src/              # API, selection, letters, email, and Sally automation
├── frontend/
│   └── src/              # React UI, API clients, components, and pages
├── Dockerfile
├── docker-compose.yml
├── DESIGN.md             # Historical EHS-focused design record
└── package.json          # Workspace scripts
```
