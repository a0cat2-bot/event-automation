# EHS Wellness Program Automation — Design Document

## Table of Contents

1. [Executive Summary & Problem Statement](#1-executive-summary--problem-statement)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Data Model & Schema](#3-data-model--schema)
4. [Letter Template & Generation System](#4-letter-template--generation-system)
5. [Applicant Management & Import](#5-applicant-management--import)
6. [Participant Selection Engine](#6-participant-selection-engine)
7. [Satisfaction Survey Integration (Sally)](#7-satisfaction-survey-integration-sally)
8. [Core Screens & User Flows](#8-core-screens--user-flows)
9. [Results Report & Confluence Integration](#9-results-report--confluence-integration)
10. [Gift Recipient Selection & Notification](#10-gift-recipient-selection--notification)
11. [Authentication, Authorization & Multi-Program Support](#11-authentication-authorization--multi-program-support)
12. [Scalability & Performance](#12-scalability--performance)
13. [Error Handling & Validation](#13-error-handling--validation)
14. [Testing & Rollout Strategy](#14-testing--rollout-strategy)

---

## 1. Executive Summary & Problem Statement

### Current State
- **Duration:** 6–9 hours per program cycle
- **Workflow:** Linear, highly manual, prone to coordination gaps across steps
- **Users:** Multiple EHS coordinators per business unit; recurring monthly programs

### Pain Points
| Step | Pain Point |
|------|-----------|
| Intake | Program brief scattered across emails/documents; no centralized schema |
| Letter Generation | Manual brand-template insertion, repeated per recruitment + notification letter |
| Applicant Upload | CSV parsing errors, no duplicate detection, manual preview validation |
| Selection | Mode-specific logic (FCFS, scoring, justification review) applied manually or in spreadsheets |
| Survey Integration | Manual export from Sally, mapping applicants to survey responses, missing matches |
| Gift Selection | No systematic eligibility rules; selection often ad-hoc or spreadsheet-based |
| Reporting | Manual aggregation of data, copy-paste into Confluence, formatting inconsistency |

### Success Metrics
1. **Cycle time reduction:** <1.5 hours per cycle (from 6–9 hours)
2. **Accuracy:** 100% applicant-to-survey match rate; zero duplicate participants
3. **Audit trail:** Complete log of all selection decisions, exports, and template versions
4. **Coordinator satisfaction:** No need to touch spreadsheets for core workflow

### Out of Scope
- Employee self-service portal (applicants do not log in; coordinators upload CSV)
- Detailed analytics dashboards (summary stats only, as part of final report)
- Mobile app; web-only
- Integration with payroll or HR systems (Sally and Confluence only)
- Localization beyond Korean/English in UI (document generation supports Korean)

---

## 2. System Architecture Overview

### Tech Stack Rationale

| Component | Choice | Justification |
|-----------|--------|--------------|
| **Frontend** | React 18 + TypeScript | Rapid UI iteration, type safety, strong library ecosystem (PDF generation, CSV parsing) |
| **Backend** | Node.js + Express | JavaScript across stack, lightweight, strong async/file handling for CSV + letter generation |
| **Database** | PostgreSQL | ACID transactions for selection integrity, excellent JSON support for flexible program metadata |
| **Letter Generation** | Server-side: `pdfkit` or `puppeteer` | Consistent PDF output, embeds fonts/branding, no client-side rendering latency; output is deterministic for audits |
| **File Storage** | S3 or local filesystem (configurable) | Letters and CSV uploads; local filesystem for MVP (on-premise deployment acceptable) |
| **Sally Integration** | HTTP polling + webhook ingestion | Sally API for participant matching; optional webhook endpoint to receive survey-complete events in real-time |
| **Confluence Integration** | Confluence REST API (v3) | Native draft page creation and update without OAuth complexity |
| **Deployment** | Docker + single-server or ECS | Fits AX센터's on-premise or light-cloud needs; simple to manage, minimal DevOps overhead |
| **Session/Auth** | JWT in cookies (httpOnly, Secure flags) | Stateless, supports multi-coordinator scenarios; no external identity provider required initially |

### Deployment Model
- **MVP:** Single Ubuntu/CentOS server (4GB RAM, 20GB storage) running Docker
- **Scaling:** Move to Kubernetes if needed; database replication for HA
- **Network:** Internal network access only (no internet-facing public endpoint)

### Integration Architecture
```
┌─────────────────────────────────────────────────────────┐
│ EHS Webapp (React + Node.js/Express + PostgreSQL)       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────┐      ┌──────────────────────┐ │
│  │   CSV Upload / CSV   │      │  Template + Letter   │ │
│  │   Store (S3/Local)   │      │  Generation (pdfkit) │ │
│  └──────────────────────┘      └──────────────────────┘ │
│                                                          │
│  ┌──────────────────────────────────────────────────────┤
│  │  Sally Integration (Polling + Optional Webhook)      │
│  │  - Poll participant survey completion status        │
│  │  - Ingest survey results on webhook event           │
│  └──────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────────────┤
│  │  Confluence Integration (REST API v3)                │
│  │  - Draft report page creation/update                │
│  └──────────────────────────────────────────────────────┤
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Data Model & Schema

### Core Entities

#### Program
```sql
CREATE TABLE programs (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  business_unit VARCHAR(100) NOT NULL,  -- e.g., "Sales", "Engineering"
  intake_data JSONB,  -- Flexible: program_name, date, location, budget, etc.
  template_version_id UUID REFERENCES letter_templates(id),
  selection_mode ENUM ('first_come_first_served', 'score', 'written_justification'),
  max_participants INT,
  status ENUM ('planning', 'recruitment_active', 'selection_in_progress', 'completed'),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  
  -- Audit
  deleted_at TIMESTAMP NULL  -- Soft delete
);
```

#### Applicant
```sql
CREATE TABLE applicants (
  id UUID PRIMARY KEY,
  program_id UUID NOT NULL REFERENCES programs(id),
  external_id VARCHAR(50),  -- Employee ID or unique identifier from CSV
  email VARCHAR(255),
  name VARCHAR(255),
  department VARCHAR(100),
  
  -- Mode-specific fields
  score INT,  -- Used if selection_mode = 'score'
  justification TEXT,  -- Used if selection_mode = 'written_justification'
  applied_at TIMESTAMP NOT NULL,
  
  -- Tracking
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(program_id, external_id)
);

CREATE INDEX idx_applicants_program_id ON applicants(program_id);
```

#### Participant
```sql
CREATE TABLE participants (
  id UUID PRIMARY KEY,
  program_id UUID NOT NULL REFERENCES programs(id),
  applicant_id UUID NOT NULL REFERENCES applicants(id),
  selection_rank INT,  -- Order of selection within program
  selection_reason VARCHAR(255),  -- e.g., "Top score", "FCFS", "High justification quality"
  
  -- Status tracking
  notification_status ENUM ('pending', 'sent', 'bounced', 'failed') DEFAULT 'pending',
  notification_sent_at TIMESTAMP NULL,
  notification_letter_id UUID REFERENCES generated_letters(id),
  
  -- Survey
  survey_id VARCHAR(100),  -- Sally survey ID or link identifier
  survey_status ENUM ('not_sent', 'sent', 'in_progress', 'completed') DEFAULT 'not_sent',
  
  -- Gift eligibility
  is_gift_eligible BOOLEAN DEFAULT TRUE,
  gift_status ENUM ('not_selected', 'selected', 'delivered') DEFAULT 'not_selected',
  gift_selected_at TIMESTAMP NULL,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(program_id, applicant_id)
);

CREATE INDEX idx_participants_program_id ON participants(program_id);
CREATE INDEX idx_participants_survey_status ON participants(survey_status);
```

#### LetterTemplate
```sql
CREATE TABLE letter_templates (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,  -- e.g., "Recruitment Letter v2", "Acceptance Letter v1"
  template_type ENUM ('recruitment', 'notification', 'gift_notification'),
  brand_variant VARCHAR(50),  -- e.g., "ax_center_standard", "division_blue"
  body TEXT NOT NULL,  -- Markdown or HTML with {{placeholder}} syntax
  brand_assets JSONB,  -- { logo_url, colors, fonts, header_html, footer_html }
  output_format ENUM ('pdf', 'image') DEFAULT 'pdf',
  
  -- Version control
  version INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_letter_templates_name ON letter_templates(name);
```

#### GeneratedLetter
```sql
CREATE TABLE generated_letters (
  id UUID PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES letter_templates(id),
  program_id UUID NOT NULL REFERENCES programs(id),
  applicant_id UUID NOT NULL REFERENCES applicants(id),
  
  -- Output
  file_path VARCHAR(512),  -- S3 path or local /uploads/letters/{id}.pdf
  file_size_bytes INT,
  content_hash VARCHAR(64),  -- SHA256 for idempotency
  
  -- Context for audit
  generated_at TIMESTAMP DEFAULT NOW(),
  generated_by UUID REFERENCES users(id),
  template_variables_snapshot JSONB  -- Snapshot of placeholders used
);

CREATE INDEX idx_generated_letters_program_id ON generated_letters(program_id);
```

#### SurveyResult
```sql
CREATE TABLE survey_results (
  id UUID PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id),
  program_id UUID NOT NULL REFERENCES programs(id),
  
  -- Survey metadata from Sally
  sally_survey_id VARCHAR(100),
  completion_date TIMESTAMP,
  
  -- Captured fields (flexible schema)
  responses JSONB,  -- { question_key: answer, ... }
  satisfaction_score INT,  -- e.g., 1–5 or 1–10
  feedback_text TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(participant_id, sally_survey_id)
);

CREATE INDEX idx_survey_results_program_id ON survey_results(program_id);
```

#### GiftRecipient
```sql
CREATE TABLE gift_recipients (
  id UUID PRIMARY KEY,
  program_id UUID NOT NULL REFERENCES programs(id),
  participant_id UUID NOT NULL REFERENCES participants(id),
  
  -- Selection details
  selection_rank INT,  -- e.g., 1st, 2nd, 3rd gift recipient
  selection_reason VARCHAR(255),
  selected_at TIMESTAMP DEFAULT NOW(),
  selected_by UUID REFERENCES users(id),
  
  -- Fulfillment
  gift_status ENUM ('selected', 'delivered', 'failed') DEFAULT 'selected',
  delivery_date TIMESTAMP NULL,
  delivery_method VARCHAR(50),  -- e.g., "hand_delivery", "mail", "pickup"
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(program_id, participant_id)
);

CREATE INDEX idx_gift_recipients_program_id ON gift_recipients(program_id);
```

#### User
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  role ENUM ('admin', 'coordinator', 'viewer') DEFAULT 'coordinator',
  business_units TEXT[],  -- Array of business unit codes this user can access
  hashed_password VARCHAR(255),  -- bcrypt
  last_login TIMESTAMP NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
```

#### AuditLog
```sql
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action VARCHAR(100),  -- e.g., 'applicant_upload_started', 'selection_generated', 'letter_sent'
  entity_type VARCHAR(50),  -- e.g., 'Program', 'Participant', 'Applicant'
  entity_id UUID,
  program_id UUID REFERENCES programs(id),
  
  details JSONB,  -- Action-specific metadata (counts, file names, etc.)
  ip_address INET,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_program_id ON audit_logs(program_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
```

### Key Enums
| Enum | Values |
|------|--------|
| **SelectionMode** | `first_come_first_served`, `score`, `written_justification` |
| **NotificationStatus** | `pending`, `sent`, `bounced`, `failed` |
| **GiftStatus** | `not_selected`, `selected`, `delivered` |
| **SurveyStatus** | `not_sent`, `sent`, `in_progress`, `completed` |
| **ProgramStatus** | `planning`, `recruitment_active`, `selection_in_progress`, `completed` |
| **UserRole** | `admin`, `coordinator`, `viewer` |

---

## 4. Letter Template & Generation System

### Template Storage & Placeholders

**Placeholder Syntax:** `{{variable_name}}`

**Standard Placeholders:**
```
{{applicant_name}}
{{applicant_email}}
{{department}}
{{program_name}}
{{program_date}}
{{program_location}}
{{program_time}}
{{survey_link}}  [For notification letters]
{{gift_amount}}  [For gift notification letters]
{{coordinator_name}}
{{coordinator_contact}}
```

**Template Example (Recruitment Letter):**
```html
<html>
<body style="font-family: Arial, sans-serif;">
  <div style="text-align: center; margin-bottom: 30px;">
    <img src="{{brand_logo_url}}" alt="Company Logo" height="60" />
  </div>
  
  <p>Dear {{applicant_name}},</p>
  
  <p>We are pleased to invite you to participate in our {{program_name}} 
  wellness program on {{program_date}} at {{program_location}}.</p>
  
  <p>Best regards,<br/>
  {{coordinator_name}}<br/>
  {{coordinator_contact}}</p>
</body>
</html>
```

### Brand Binding

**Brand Variant Record:**
```json
{
  "variant_name": "ax_center_standard",
  "logo_url": "s3://company-assets/ax-logo.png",
  "colors": {
    "primary": "#0052CC",
    "secondary": "#F5A623"
  },
  "fonts": {
    "family": "Noto Sans KR, Arial, sans-serif",
    "fallback": "Arial"
  },
  "header_html": "<div style='border-bottom: 2px solid #0052CC; padding: 20px;'>AX센터 Wellness</div>",
  "footer_html": "<div style='text-align: center; font-size: 10px; margin-top: 40px; color: #999;'>© 2026 AX센터. All rights reserved.</div>"
}
```

### Output Format

**PDF (Selected)**

**Rationale:**
- Professional appearance, brand consistency across all coordinators and recipients
- Embeds fonts and logo (no missing assets on recipient end)
- Preserves layout regardless of viewer device/email client
- Easier to audit and archive (immutable once generated)
- Supports Korean font rendering natively

**Generation Engine:** Puppeteer (headless Chrome)
- Handles HTML+CSS rendering more reliably than pdfkit for complex branding layouts
- Server-side only; generated once, stored in S3 or local filesystem

### Letter Generation API

**Endpoint:** `POST /api/v1/letters/generate`

**Request:**
```json
{
  "template_id": "uuid",
  "program_id": "uuid",
  "applicant_ids": ["uuid", "uuid"],
  "brand_variant": "ax_center_standard"
}
```

**Response:**
```json
{
  "job_id": "uuid",
  "status": "queued",
  "message": "Generating 2 letters..."
}
```

**Callback** (`POST /api/v1/letters/generate-complete` — async webhook):
```json
{
  "job_id": "uuid",
  "status": "completed",
  "generated_letters": [
    {
      "letter_id": "uuid",
      "applicant_id": "uuid",
      "file_path": "s3://bucket/letters/uuid.pdf",
      "file_size_bytes": 145000,
      "content_hash": "abc123def456..."
    }
  ],
  "failed_count": 0,
  "completed_at": "2026-07-19T14:32:00Z"
}
```

**Idempotency:** Hash of (template_id, applicant_id, placeholder values) ensures same input = same output PDF. If regenerating, check hash; if match found, return cached letter.

---

## 5. Applicant Management & Import

### CSV Schema per Selection Mode

#### FCFS Mode
```csv
external_id,name,email,department,applied_at
EMP001,Kim Sung-ho,kim.sungh@ax.co.kr,Engineering,2026-07-15T09:30:00
EMP002,Lee Min-jun,lee.minj@ax.co.kr,Marketing,2026-07-15T09:45:00
EMP003,Park Ji-won,park.ji@ax.co.kr,Sales,2026-07-15T10:15:00
```

#### Score Mode
```csv
external_id,name,email,department,score,applied_at
EMP001,Kim Sung-ho,kim.sungh@ax.co.kr,Engineering,95,2026-07-15T09:30:00
EMP002,Lee Min-jun,lee.minj@ax.co.kr,Marketing,87,2026-07-15T09:45:00
EMP003,Park Ji-won,park.ji@ax.co.kr,Sales,92,2026-07-15T10:15:00
```

#### Written Justification Mode
```csv
external_id,name,email,department,justification,applied_at
EMP001,Kim Sung-ho,kim.sungh@ax.co.kr,Engineering,"Dedicated to improving health metrics through regular fitness",2026-07-15T09:30:00
EMP002,Lee Min-jun,lee.minj@ax.co.kr,Marketing,"Seeking stress management techniques for better work-life balance",2026-07-15T09:45:00
```

### Validation Rules

| Rule | Check |
|------|-------|
| **Required fields** | external_id, name, email, department; score (if Score mode); justification (if Written Justification mode) |
| **Email format** | RFC 5322 basic validation |
| **Duplicate detection** | Same (program_id, external_id) pair; flag for review or auto-skip |
| **Score range** | Integer, typically 0–100; configurable per program |
| **Justification length** | Min 10 chars, max 500 chars (configurable) |
| **File encoding** | UTF-8 or ISO-8859-1; auto-detect and convert |
| **Row count** | Max 5,000 applicants per upload (coordinator warning if exceeded) |

### Upload → Preview → Confirm Flow

**Step 1: Upload CSV**
- Endpoint: `POST /api/v1/programs/{program_id}/applicants/upload`
- Multipart form-data, file field = `csv_file`
- Returns: `upload_id`, row count, validation summary (errors, warnings, duplicates count)

**Step 2: Preview**
- Endpoint: `GET /api/v1/programs/{program_id}/applicants/upload/{upload_id}/preview`
- Returns: First 50 rows (paginated), list of validation issues with row numbers
- Allows filtering by status (all, errors, warnings, duplicates)

**Step 3: Confirm & Commit**
- Endpoint: `POST /api/v1/programs/{program_id}/applicants/upload/{upload_id}/confirm`
- Request body: `{ "action": "import" | "discard", "conflict_resolution": "skip_duplicates" | "overwrite" }`
- Atomically inserts all valid rows, logs audit entry with upload_id and row counts
- Returns: `{ "imported_count": 150, "skipped_count": 3, "failed_count": 0 }`

**Partial Failure Handling:**
- Duplicate applicants: Flag with row number; coordinator chooses skip or overwrite (program_id + external_id unique constraint)
- Invalid rows: Displayed in preview; can be manually fixed in CSV and re-uploaded
- If upload fails mid-commit: Rollback all rows; return error with failed row details

---

## 6. Participant Selection Engine

### Algorithm: First Come, First Served
```
INPUT: program.max_participants, applicants sorted by applied_at ASC
OUTPUT: selected participant list (ordered by applied_at)

1. Sort applicants by applied_at (earliest first)
2. For i = 0 to min(len(applicants), max_participants) - 1:
     Create Participant record with selection_rank = i+1
     Set selection_reason = "First Come, First Served"
3. Return selected list
```

**Complexity:** O(n log n) for sort, single pass to create records.

### Algorithm: Score-Based
```
INPUT: program.max_participants, applicants with score field
OUTPUT: selected participant list (ordered by score DESC, then applied_at ASC for tie-break)

1. Sort applicants by (score DESC, applied_at ASC)
2. For i = 0 to min(len(applicants), max_participants) - 1:
     Create Participant record with selection_rank = i+1
     Set selection_reason = "Score: {score}"
3. Return selected list
```

**Complexity:** O(n log n)

### Algorithm: Written Justification Quality
```
INPUT: program.max_participants, applicants with justification text, max_selected_count
OUTPUT: selected participant list (manual review + programmatic scoring)

PHASE 1: Programmatic Filtering (pre-filter to top N candidates for manual review)
1. Compute "quality score" for each justification:
   - Length bonus: min(len(text) / 500, 1.0) * 20 points
   - Keyword matching: predefined wellness keywords (e.g., "health", "exercise", "balance", "stress") 
     → +10 points per keyword (max 30 points)
   - Readability: Flesch-Kincaid grade < 12 → +10 points
   - Score range: 0–60 points
2. Sort by quality score DESC, applied_at ASC
3. Filter to top 3 × max_participants (for manual review by coordinator)
4. Return sorted list

PHASE 2: Manual Review & Selection (coordinator task in UI)
- UI presents filtered candidates with highlighted keywords, quality score
- Coordinator selects top max_participants candidates manually
- System records selection_reason as "Manual review: {coordinator_name}"
```

**Rationale for two-phase:** Avoids flooding coordinator with 200+ justifications; AI-assisted filtering reduces scope to top candidates.

### Selection API

**Endpoint:** `POST /api/v1/programs/{program_id}/selection/generate`

**Request:**
```json
{
  "selection_mode": "first_come_first_served" | "score" | "written_justification",
  "quality_score_threshold": 0,
  "manual_review_count_multiplier": 3,
  "override_selections": [
    { "applicant_id": "uuid", "selected": true, "reason": "Manager recommendation" }
  ]
}
```

**Response:**
```json
{
  "job_id": "uuid",
  "status": "in_progress",
  "estimated_completion_time": "2026-07-19T14:35:00Z"
}
```

**Completion Webhook** (`POST /api/v1/programs/{program_id}/selection/complete`):
```json
{
  "job_id": "uuid",
  "status": "completed",
  "selected_participants": [
    {
      "participant_id": "uuid",
      "applicant_id": "uuid",
      "selection_rank": 1,
      "selection_reason": "Score: 95"
    }
  ],
  "total_selected": 50,
  "completed_at": "2026-07-19T14:34:00Z"
}
```

**Manual Override:** POST request body allows coordinators to override auto-selected list (e.g., add a manager's pick, remove an ineligible applicant).

---

## 7. Satisfaction Survey Integration (Sally)

### Sync Flow

**Assumption:** Sally provides:
1. REST API endpoint to query participant surveys by identifier (email, ID, or survey link)
2. Webhooks to notify on survey completion (optional; fallback to polling)

### Integration Approach: Hybrid Polling + Webhook

**Webhook (Preferred):**
- Register webhook URL with Sally: `https://app.ax.local/webhooks/sally/survey-complete`
- Sally sends: `{ "survey_id": "...", "recipient_email": "...", "completion_date": "...", "responses": {...} }`
- App receives, matches to Participant by email, updates `survey_status = 'completed'`, stores responses in SurveyResult

**Polling (Fallback):**
- Background job runs every 1 hour (configurable)
- Queries Sally API for all surveys matching participants in `survey_status = 'sent'`
- Updates local database with completion status and responses
- Logs polling metrics (matched, unmatched, errors) to audit table

### Participant-to-Survey Matching

**Matching Logic:**
```
1. For each Participant with survey_status = 'sent':
   a. Query Sally: GET /surveys?email={applicant.email}
   b. If found:
      - Match on email + program_id (verify correct program context)
      - Update participant.survey_id = sally_survey_id
      - Update participant.survey_status = 'in_progress' | 'completed'
   c. If not found after polling window (7+ days):
      - Flag as unmatched; mark participant.survey_status = 'failed'
      - Log to audit trail for coordinator review
2. Store matched survey_id in Participant record for future lookups
```

### Data Captured

**Survey metadata stored in SurveyResult:**
```json
{
  "participant_id": "uuid",
  "program_id": "uuid",
  "sally_survey_id": "sally_123",
  "completion_date": "2026-07-18T16:45:00Z",
  "responses": {
    "q1_overall_satisfaction": 4,
    "q2_would_recommend": 5,
    "q3_improvements": "More variety in activities",
    "q4_likelihood_return": 5
  },
  "satisfaction_score": 4.5,
  "feedback_text": "Great experience overall!"
}
```

### Sally API Shape (App's Contract)

**Send Survey Invitation:**
- `POST /surveys/send`
- Body: `{ "recipient_email": "...", "survey_link_template": "...", "metadata": { "program_id": "...", "participant_id": "..." } }`
- Returns: `{ "survey_id": "...", "sent_at": "..." }`

**Fetch Survey Results:**
- `GET /surveys/{survey_id}/results`
- Returns: `{ "status": "completed" | "in_progress", "responses": {...}, "completion_date": "..." }`

**Webhook Payload (Sally → App):**
- `POST /webhooks/sally/survey-complete`
- Body: `{ "survey_id": "...", "recipient_email": "...", "responses": {...}, "completion_date": "..." }`

---

## 8. Core Screens & User Flows

### Dashboard (Coordinator Landing Page)
**Purpose:** Overview of all active and recent programs; quick access to actions

**Key Elements:**
- **Program List (Table):** Columns: Program Name, Business Unit, Status, Applicants, Selected Participants, Survey Completion %, Last Updated
  - Status badges: Planning (yellow) | Recruitment Active (blue) | Selection In Progress (orange) | Completed (green)
  - Click row → Program Detail view
- **Quick Actions Card:** Buttons for "Create New Program", "Upload Applicants", "Generate Selection", "View Results"
- **Statistics Box:** Total programs this month, total applicants, total completed surveys, pending actions count
- **Recent Activity Feed:** Last 5 events (program created, applicants uploaded, selection completed, survey sent)

**Flow:**
1. User logs in → Dashboard loads
2. User clicks on program → Program Detail (see below)
3. User clicks "Create New Program" → Program Setup screen

---

### Program Setup (Program Brief Intake)
**Purpose:** Define program metadata and selection parameters

**Key Elements:**
- **Program Metadata Form:**
  - Name (text input)
  - Business Unit (dropdown)
  - Date (date picker)
  - Location (text input)
  - Max Participants (number input)
  - Estimated Budget (currency input)
  - Selection Mode (radio: FCFS | Score | Written Justification)
  - Description/Notes (textarea)
  
- **Template Selection:**
  - Dropdown: Select Recruitment Letter Template
  - Dropdown: Select Notification Letter Template
  - Dropdown: Select Brand Variant
  - Preview button → shows rendered template with sample data
  
- **Action Buttons:**
  - Save as Draft → remains in "planning" status
  - Activate Recruitment → status → "recruitment_active"

**Validation:**
- All required fields must be filled
- Max Participants > 0 and < 5000
- Templates must exist before activation

**Flow:**
1. Coordinator fills form → clicks Save
2. Program created; status = "planning"
3. Coordinator clicks "Activate Recruitment" → Recruitment Letter queued for generation (see Applicant Upload step)

---

### Applicant Upload
**Purpose:** Import CSV of applicants

**Key Elements:**
- **File Input:** Drag-and-drop or file picker for CSV
- **Format Reminder:** Display expected schema based on selection_mode (FCFS | Score | Justification)
- **Upload Progress:** Progress bar, real-time row count, preview of first few rows
- **Preview Table:** Display first 50 rows with validation status per row
  - Row status indicators: ✓ Valid | ⚠ Warning (duplicate) | ✗ Error (invalid field)
  - Filterable by status
  - Downloadable error report (CSV)
- **Conflict Resolution (if duplicates found):** Radio buttons: "Skip duplicates" | "Overwrite existing"
- **Action Buttons:** 
  - "Confirm Import" → Commits rows to database, triggers Recruitment Letter generation
  - "Cancel" → Discards upload, returns to Program Detail

**Validation Summary (after upload):**
- Total rows attempted: N
- Valid rows: N1
- Rows with errors: N2 (list specific issues)
- Duplicate applicants detected: N3
- Final action: "Import {N1} applicants?"

**Flow:**
1. Coordinator drags CSV → system validates → shows preview
2. If errors: Coordinator downloads error report, fixes CSV, re-uploads
3. Coordinator clicks "Confirm Import" → applicants inserted, Recruitment Letters generated automatically
4. Transition to Applicant Upload complete state

---

### Applicant Review & Selection
**Purpose:** Execute selection algorithm; manually override if needed

**Key Elements:**
- **Selection Summary Card:**
  - Selection Mode: [FCFS | Score | Justification]
  - Total Applicants: N
  - Max Participants: M
  - Selection Threshold (if Score/Justification): X

- **Generate Selection Button:**
  - Clicking triggers `/selection/generate` API call
  - Modal shows progress: "Running algorithm... Computing scores..."
  - Upon completion: displays "X participants selected" and loads Participant List

- **Participant List (Pre-Selection):**
  - Table: Rank | Name | Email | Department | Score (if applicable) | Justification Preview (if applicable) | Selection Reason
  - Sortable by each column
  - If Justification mode: highlighted keywords, quality score shown
  
- **Manual Overrides (Optional):**
  - Checkbox column: "Include in final selection"
  - Reason text field: "Manager recommendation", "Executive request", etc.
  - "Apply Overrides" button → updates participant list
  
- **Finalize Selection Button:**
  - Confirms final selection, status → "selection_in_progress"
  - Generates Notification Letters for all selected participants
  - Queues Sally survey invitations to send next

**Flow:**
1. Coordinator views Applicant Review screen
2. Coordinator clicks "Generate Selection"
3. System runs selection algorithm → results displayed
4. Coordinator can adjust (add/remove) as needed
5. Coordinator clicks "Finalize Selection" → Notification Letters + Survey Invitations sent

---

### Selection Review & Survey Sending
**Purpose:** Confirm final selection and dispatch notifications

**Key Elements:**
- **Selection Summary:** 
  - "X applicants will be notified of selection"
  - List of selected applicants with email addresses
  
- **Notification Status Table:**
  - Columns: Name | Email | Notification Sent | Survey Sent | Status
  - Status badges: Pending | Sent | Bounced | Failed
  - Resend button (per applicant) for failed notifications
  
- **Send Notifications & Surveys Button:**
  - Clicking queues all Notification Letters to send + Sally survey invitations
  - Real-time status updates as letters are generated and sent
  
- **Bulk Actions:**
  - "Resend all failed notifications" → retries bounced emails
  - "Preview letter" → shows rendered PDF for a sample participant

**Flow:**
1. Coordinator reviews final selection
2. Coordinator clicks "Send Notifications" → batch job starts
3. As batch completes, status updates in real-time
4. Once complete, transition to Survey Tracking

---

### Survey Results Dashboard
**Purpose:** Monitor survey completion; match responses to participants

**Key Elements:**
- **Survey Completion Metrics:**
  - Total Sent: N
  - Completed: M (with %)
  - In Progress: P
  - Bounced/Failed: Q
  - Unmatched (no response matched to participant): R
  
- **Participant Survey Status Table:**
  - Columns: Name | Email | Survey Sent | Survey Status | Completion Date | Satisfaction Score (if completed)
  - Sortable, filterable by status
  - Click row → see detailed survey responses (JSONB snapshot)
  
- **Manual Matching (for unmatched surveys):**
  - If survey exists but participant not found:
    - UI prompts: "Match email X to participant?"
    - Dropdown to select correct participant
    - "Confirm Match" button → updates SurveyResult.participant_id
    
- **Refresh & Sync Buttons:**
  - "Sync with Sally" → triggers polling job immediately (don't wait 1 hour)
  - "Refresh Results" → re-fetches data from database

**Flow:**
1. Coordinator views Survey Results after allowing survey completion window (e.g., 1 week)
2. System polls Sally for updates
3. Coordinator reviews completion rate
4. If unmatched surveys found, coordinator manually matches
5. Once ready, transition to Gift Selection

---

### Gift Recipient Selection
**Purpose:** Choose gift recipients and capture delivery logistics

**Key Elements:**
- **Gift Eligibility Criteria (Configurable):**
  - Survey completed: Yes/No
  - Minimum satisfaction score: X (e.g., 3 out of 5)
  - Minimum justification score (Justification mode): Y
  - Random selection vs. highest satisfaction vs. manual
  
- **Eligible Participants List:**
  - Filter by eligibility criteria
  - Columns: Name | Email | Satisfaction Score | Justification Score (if applicable) | Random Rank | Selection Status
  - Sortable by score or random rank
  
- **Gift Selection Algorithm:**
  - Radio buttons: "Random" | "Highest Satisfaction" | "Manual Selection"
  - If Random: Show N random recipients (e.g., 5 out of 50)
  - If Highest Satisfaction: Auto-select top N by score
  - If Manual: Checkboxes to manually pick recipients
  
- **Selected Recipients Preview:**
  - Table: Name | Email | Gift Status
  - "Generate Gift Notification Letters" button
  
- **Gift Delivery Logistics:**
  - Dropdown: Delivery Method (Hand Delivery | Mail | Pickup | Email Only)
  - Text field: Delivery Notes
  - "Confirm & Send Notifications" button

**Flow:**
1. Coordinator views Gift Selection after survey completion window
2. Coordinator selects eligibility criteria
3. Coordinator chooses selection algorithm (Random | Highest Satisfaction | Manual)
4. System generates recipient list
5. Coordinator reviews, can adjust
6. Coordinator clicks "Generate Notifications" → Gift Notification Letters sent

---

### Results Report & Confluence Draft
**Purpose:** Generate summary report and draft Confluence page

**Key Elements:**
- **Report Content Preview:**
  - Program summary (name, date, location, budget)
  - Applicant statistics (total, selected, not selected)
  - Selection mode and algorithm overview
  - Participant list (sorted by rank, with satisfaction scores if applicable)
  - Survey completion stats
  - Gift recipient list and delivery notes
  
- **Confluence Integration Section:**
  - Checkbox: "Post draft to Confluence"
  - Dropdown: Select Confluence Space (e.g., "Wellness Programs")
  - Text field: Parent page (optional)
  - Text field: Draft page title (pre-filled with program name + date)
  
- **Generate & Post Button:**
  - Clicking triggers `/reports/generate` → creates markdown report
  - If Confluence enabled: POSTs to Confluence API as draft page
  - Shows success message with link to Confluence page
  
- **Export Options:**
  - Download as PDF
  - Download as CSV (participant list)
  - Copy report markdown to clipboard

**Flow:**
1. Coordinator views Results Report screen after program completion
2. Coordinator reviews report content
3. Coordinator enables Confluence integration
4. Coordinator clicks "Generate & Post"
5. System generates markdown, creates Confluence page, returns link
6. Coordinator can edit Confluence page directly or finalize through app

---

## 9. Results Report & Confluence Integration

### Report Generation API

**Endpoint:** `POST /api/v1/programs/{program_id}/reports/generate`

**Request:**
```json
{
  "format": "markdown" | "html" | "pdf",
  "include_sections": ["summary", "participants", "survey_results", "gifts"],
  "confluence_integration": {
    "enabled": true,
    "space": "Wellness Programs",
    "parent_page_title": "2026 Program Results",
    "draft_title": "AX센터 July Wellness - Results"
  }
}
```

**Response:**
```json
{
  "report_id": "uuid",
  "status": "generating",
  "job_id": "uuid",
  "estimated_completion_time": "2026-07-19T14:40:00Z"
}
```

**Completion Webhook** (`POST /api/v1/programs/{program_id}/reports/complete`):
```json
{
  "job_id": "uuid",
  "report_id": "uuid",
  "status": "completed",
  "file_path": "s3://bucket/reports/uuid.pdf",
  "confluence_url": "https://confluence.ax.local/pages/viewpage.action?pageId=12345",
  "content_summary": {
    "total_applicants": 120,
    "total_participants": 50,
    "survey_completion_rate": 0.96,
    "gift_recipients": 5
  },
  "completed_at": "2026-07-19T14:39:00Z"
}
```

### Draft Content Structure (Markdown Template)

```markdown
# {{program_name}} — Wellness Program Results
**Date:** {{program_date}} | **Location:** {{program_location}}

## Executive Summary
- **Total Applicants:** {{applicant_count}}
- **Selected Participants:** {{participant_count}}
- **Selection Rate:** {{selection_rate}}%
- **Survey Completion Rate:** {{survey_completion_rate}}%

## Program Details
- **Selection Mode:** {{selection_mode}}
- **Budget:** {{budget}}
- **Coordinator:** {{coordinator_name}}

## Participant List
| Rank | Name | Email | Department | Satisfaction Score |
|------|------|-------|------------|-------------------|
{{participant_rows}}

## Survey Insights
- **Average Satisfaction Score:** {{avg_satisfaction}}
- **Would Recommend:** {{recommend_percentage}}%
- **Top Feedback Themes:**
  {{feedback_themes}}

## Gift Recipients
| Name | Email | Delivery Method |
|------|-------|-----------------|
{{gift_recipient_rows}}

## Next Steps
[Coordinator to fill in]
```

### Confluence API Integration

**Confluence Endpoint:** `https://confluence.ax.local/rest/api/3/pages`

**Request (Create Draft Page):**
```http
POST /rest/api/3/pages
Content-Type: application/json

{
  "spaceId": "12345",
  "status": "draft",
  "title": "AX센터 July Wellness - Results",
  "parentId": "67890",
  "body": {
    "representation": "storage",
    "value": "<h1>Program Results</h1><table>...</table>"
  }
}
```

**Response:**
```json
{
  "id": "98765",
  "status": "draft",
  "title": "AX센터 July Wellness - Results",
  "links": {
    "webui": "/pages/viewpage.action?pageId=98765"
  }
}
```

**Authentication:** Confluence API Token (stored in app config, not in code); all requests include `Authorization: Bearer <token>` header.

---

## 10. Gift Recipient Selection & Notification

### Algorithm Options & Selected Approach

| Algorithm | Pros | Cons | Selected |
|-----------|------|------|----------|
| **Random Selection** | Fair, unpredictable, simple to explain | No merit-based component | ✓ (Simple, aligns with wellness culture) |
| **Highest Satisfaction Score** | Rewards engagement | May demotivate lower scores | - |
| **Lottery Weighted by Score** | Hybrid fairness + merit | Complex to explain | - |
| **Manual Selection** | Coordinator control, recognize individuals | Time-consuming, subjective | ✓ (As fallback option) |

**Selected Approach:** **Random Selection (Primary) + Manual Override (Optional)**

### Eligibility Rules

```
RULE SET:
1. Participant must have completed survey (survey_status = 'completed')
2. Participant must have satisfaction_score >= 3.0 (configurable, default 3/5)
3. Participant must NOT have gift_status = 'delivered' (no duplicates across programs)
4. (Optional) If Justification mode: justification_score >= X (configurable)
5. (Optional) Department diversity: max 1 gift per department (configurable)

APPLY RULES:
1. For each Participant in program:
   a. Check all eligibility conditions
   b. If all pass: add to eligible_pool
2. If eligible_pool.count < num_gift_recipients:
   - Log warning: "Only {N} eligible participants found; requesting {M} gifts"
   - Reduce gift_recipients to N or prompt coordinator to adjust criteria
3. Select random N from eligible_pool (or manual selection)
4. Update participants.gift_status = 'selected'
5. Create GiftRecipient records
6. Queue Gift Notification Letters
```

### Gift Notification Letter

**Reuse from Letter Template System:**
- Use template_type = 'gift_notification'
- Same brand binding, PDF generation as recruitment/notification letters
- Placeholders: `{{applicant_name}}`, `{{gift_amount}}`, `{{delivery_method}}`, `{{delivery_date}}`, etc.

### Gift Status Workflow

```
GiftRecipient.gift_status progression:
  selected → (coordinator confirms delivery logistics) → 
  delivered → (optional: photo/receipt upload for audit)
```

**Notification Letter Timing:**
- Generated immediately after selection
- Sent via email to recipient
- Optional: scheduled delivery (e.g., "send on gift delivery date")

---

## 11. Authentication, Authorization & Multi-Program Support

### Authentication

**Method:** JWT in httpOnly, Secure cookies

**Login Flow:**
```
1. POST /auth/login → { email, password }
2. Backend hashes password with bcrypt, compares to users.hashed_password
3. If match: JWT token created with { user_id, email, role, business_units }
4. Token set in httpOnly cookie (24-hour expiry)
5. Redirect to Dashboard
```

**Logout:**
- Clear cookie
- No token blacklist needed (httpOnly cookie clears client-side, stateless backend)

**Session Timeout:** 24 hours; refresh before expiry or re-login

### Authorization: Role-Based Access Control (RBAC)

| Role | Permissions |
|------|------------|
| **Admin** | Create/edit users; view all programs; delete programs; configure system settings (brand variants, templates, Sally credentials) |
| **Coordinator** | Create programs (within assigned business units); upload applicants; run selection; view own + all published results; send notifications |
| **Viewer** | Read-only access to all programs and results (no edit, no send) |

### Program Isolation

**Multi-Program Support per Coordinator:**
- User table: `business_units TEXT[]` stores list of accessible unit codes (e.g., ['Engineering', 'Sales', 'HR'])
- All queries include: `WHERE programs.business_unit = ANY(current_user.business_units)`
- SQL row-level security policy enforces this at database level

**Data Partitioning (Optional, not MVP):**
- Future: separate database per business unit if scaling (PostgreSQL schemas)

**Audit Logging:**
- Every action logs `user_id`, `program_id`, `business_unit`, `ip_address`
- Enables tracking of who did what when

### Audit Logging

**Logged Events:**
| Event | Triggered By | Details Captured |
|-------|-------------|------------------|
| `applicant_upload_started` | API call | program_id, file_name, row_count, user_id |
| `applicant_upload_committed` | Confirm action | program_id, imported_count, skipped_count, timestamp |
| `selection_generated` | API call | program_id, selection_mode, selected_count, algorithm_version |
| `notification_sent` | Batch job | program_id, participant_id, email, status, timestamp |
| `survey_result_matched` | Polling/webhook | participant_id, survey_id, completion_date |
| `gift_selection_generated` | API call | program_id, recipient_count, algorithm_version |
| `report_generated` | API call | program_id, format, confluence_url (if posted), timestamp |
| `template_version_used` | Letter generation | template_id, version, hash (for audit trail) |
| `user_login` | Auth | user_id, timestamp, ip_address |
| `user_action_failed` | Error | program_id, action, error_message, user_id |

**Storage:**
- `audit_logs` table (PostgreSQL JSONB for flexibility)
- Indexed by `program_id`, `timestamp` for efficient lookups
- Coordinator can export audit log for compliance (CSV)

---

## 12. Scalability & Performance

### Concurrency & Volume Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| **Concurrent Coordinators** | 20–50 (per instance) | Typical user count at AX센터; horizontally scalable |
| **Concurrent Programs** | 10 active simultaneously | Monthly cycles + staggered business units |
| **Applicants per Program** | 5,000 max per upload | Realistic wellness program size; larger imports split into batches |
| **Participants per Program** | 500 typical | Selection usually < 10% of applicants |
| **Survey Response Time** | <5s per participant query | Sally API SLA assumed 1s; caching layer for repeat queries |

### Indexing Strategy

```sql
-- Applicants: frequent filter by program + status
CREATE INDEX idx_applicants_program_id ON applicants(program_id);
CREATE INDEX idx_applicants_program_applied ON applicants(program_id, applied_at DESC);

-- Participants: frequent filter by program + survey status
CREATE INDEX idx_participants_program_id ON participants(program_id);
CREATE INDEX idx_participants_survey_status ON participants(survey_status);
CREATE INDEX idx_participants_program_survey ON participants(program_id, survey_status);

-- SurveyResults: frequent lookup by participant
CREATE INDEX idx_survey_results_participant ON survey_results(participant_id);
CREATE INDEX idx_survey_results_program ON survey_results(program_id);

-- GiftRecipients: frequent filter by program + status
CREATE INDEX idx_gift_recipients_program ON gift_recipients(program_id);
CREATE INDEX idx_gift_recipients_status ON gift_recipients(gift_status);

-- AuditLogs: frequent time-range queries
CREATE INDEX idx_audit_logs_program_timestamp ON audit_logs(program_id, timestamp DESC);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

-- Users + Programs: multi-tenant filtering
CREATE INDEX idx_programs_business_unit ON programs(business_unit);
```

### Caching Strategy

| Cache Layer | What | TTL | Invalidation |
|-------------|------|-----|--------------|
| **Redis (Optional)** | Participant list per program (for selection UI) | 5 min | On applicant import or selection changes |
| **DB Query Result** | Letter templates (rarely change) | 60 min | Manual on template update |
| **HTTP Cache Headers** | PDF letters (immutable once generated) | 1 year (or no-cache) | Versioning via content_hash |
| **S3 Cache** | Logo + brand assets | 1 week | Manual invalidation |

### Storage Estimates

| Data Type | Size per Unit | Volume | Total |
|-----------|-------|--------|-------|
| Program metadata | 5 KB | 100/year | 0.5 MB |
| Applicant row | 0.5 KB | 100 programs × 1000 applicants | 50 MB |
| Generated letter (PDF) | 150 KB | 50 participants × 100 programs | 750 MB |
| Survey results (JSONB) | 2 KB | 5000/year | 10 MB |
| Audit logs | 0.1 KB/event | 50,000 events/year | 5 MB |
| **Total First Year** | | | ~815 MB |

**Scaling Decision:** PostgreSQL + S3 sufficient through Year 2; migrate to separate database + archive old letters to Glacier at Year 3+ if needed.

### Performance Targets

| Operation | Target | Approach |
|-----------|--------|----------|
| CSV upload (1000 rows) | <5s parse + validate | Streaming parser; batch insert with `COPY` |
| Letter generation (50 letters) | <30s | Async job; Puppeteer parallel processes (4–8) |
| Selection algorithm | <10s for 1000 applicants | In-process sorting; no external calls |
| Survey sync (polling) | <2s for 100 participants | Batch API queries to Sally (max 50 per call) |
| Report generation | <15s | Template rendering + Confluence API call |
| Dashboard load | <2s | Denormalized view or materialized summary table |

---

## 13. Error Handling & Validation

### Upload Validation Errors

| Error Type | Detection | Recovery |
|------------|-----------|----------|
| **Missing Required Field** | CSV parsing | Row flagged; coordinator must fix CSV and re-upload |
| **Invalid Email Format** | Regex validation | Warning (not error); allow user to proceed or fix |
| **Duplicate Applicant** | (program_id, external_id) unique check | Highlighted in preview; coordinator chooses skip/overwrite |
| **Invalid Score (non-integer or out of range)** | Type + range check | Error flag; coordinator fixes CSV |
| **Justification too short (<10 chars)** | Length check | Warning; allow or require fix |
| **Malformed CSV (wrong encoding, quote issues)** | Parsing error | Error with line number; suggest re-save as UTF-8 |
| **File too large (>10 MB)** | Size check | Error; split upload into smaller batches |

**Preview & Confirm:** All validation errors shown in preview table before commit. Coordinator must fix or explicitly acknowledge and proceed.

### Partial Failure Handling

**Scenario:** 500-row upload, 490 valid, 10 invalid

**Behavior:**
1. Show preview with 10 errors highlighted
2. Coordinator can:
   a. Download error report (CSV with error reasons)
   b. Fix errors and re-upload just the 10 rows, or
   c. Proceed with 490 (skip invalid rows)
3. On confirm: atomically insert 490; log 10 skipped in audit trail
4. Return success: "Imported 490 applicants, skipped 10 due to errors"

**Atomicity Guarantee:** Either all-or-nothing per applicant row (if validation fails mid-insert, rollback). Exception: if duplicate detected, can overwrite previous version (coordinator chooses in preview).

### Retry Strategy

**Background Jobs (Letter generation, Sally polling, Confluence post):**
- Failed job: retry 3 times with exponential backoff (1s, 4s, 16s)
- After 3 failures: log error in audit trail; coordinator notified via UI banner
- Manual retry: "Retry" button in UI re-queues job

**Email Delivery (Notification letters):**
- Bounced email: flag in participant.notification_status = 'bounced'
- Coordinator can manually review and resend (e.g., if typo in CSV)
- No auto-retry (relies on Sally or email service's delivery retry)

**API Timeouts:**
- Sally polling timeout: if no response in 10s, skip batch, try next batch, log warning
- Confluence API timeout: retry once; if still fails, return error and allow manual post

### Validation Rules Summary

| Entity | Rule | Action if Failed |
|--------|------|------------------|
| **Program** | Max Participants > 0 | Form validation error |
| **Applicant (all modes)** | external_id + program_id unique | Flag as duplicate in preview |
| **Applicant (Score)** | 0 ≤ score ≤ 100 | Validation error |
| **Applicant (Justification)** | 10 ≤ length ≤ 500 | Warning (allow override) |
| **Participant** | Must have matched applicant | Referential integrity (DB constraint) |
| **Survey** | Participant must exist | Update fails; retry later |
| **Gift Recipient** | Must satisfy eligibility rules | Excluded from selection, logged |

---

## 14. Testing & Rollout Strategy

### Unit Test Examples

**Letter Generation:**
```
Test: template_placeholder_substitution
  Given: template with {{applicant_name}}, {{program_date}}, {{survey_link}}
  And: applicant data { name: "Kim Sung-ho", ...}, program { date: "2026-07-19", ... }
  When: generatePDF(template, applicant, program)
  Then: PDF contains "Kim Sung-ho" and "2026-07-19" and valid survey_link URL
  And: PDF file size > 100 KB (image embedded)

Test: template_version_idempotency
  Given: same template, applicant, brand variant
  When: generatePDF(...) called twice
  Then: both PDFs have identical content_hash
  And: second call returns cached letter (no re-generation)
```

**Selection Algorithm (FCFS):**
```
Test: fcfs_correct_order
  Given: 3 applicants with applied_at [2026-07-15 09:30, 09:45, 10:15]
  And: max_participants = 2
  When: runSelection(program)
  Then: selected participants are [1st, 2nd] by applied_at
  And: selection_reason = "First Come, First Served"

Test: fcfs_respects_max
  Given: 100 applicants, max_participants = 50
  When: runSelection(program)
  Then: participants.count == 50
  And: all have selection_rank in [1, 50]
```

**Score-Based Selection:**
```
Test: score_sort_descending
  Given: 3 applicants with scores [95, 87, 92]
  When: runSelection(program, mode='score')
  Then: selected rank order is [95, 92, 87]

Test: score_tiebreak_by_applied_at
  Given: 2 applicants both score=90, applied_at=[09:30, 10:00]
  When: runSelection(program)
  Then: earlier applicant gets rank 1
```

**Justification Scoring:**
```
Test: justification_keyword_detection
  Given: justification "I care about health and exercise for better balance"
  When: scoreJustification(text)
  Then: score includes +10 per keyword (health, exercise, balance)
  And: total >= 20

Test: justification_length_bonus
  Given: justification of 250 characters (50% of 500 max)
  When: scoreJustification(text)
  Then: length_bonus = 10 points
```

**Survey Matching:**
```
Test: participant_survey_email_match
  Given: participant.email = "kim.sungh@ax.co.kr"
  And: Sally returns survey with recipient = "kim.sungh@ax.co.kr"
  When: matchSurveyToParticipant()
  Then: survey_id populated, survey_status = 'completed'
  
Test: survey_no_match_timeout
  Given: participant with survey_status = 'sent' for 8 days
  And: no matching Sally survey found
  When: pollSally()
  Then: survey_status changed to 'failed', audit logged
```

**Authorization (Row-Level):**
```
Test: coordinator_sees_only_own_business_unit
  Given: user role='coordinator', business_units=['Engineering']
  And: program_1.business_unit = 'Engineering', program_2.business_unit = 'Sales'
  When: listPrograms(user)
  Then: result includes program_1, excludes program_2
```

### Integration Test Examples

```
Test: full_workflow_fcfs_to_report
  Setup: Create program, upload 10 applicants (FCFS mode), select 5, send surveys
  1. POST /programs → program created, status='planning'
  2. POST /programs/{id}/applicants/upload → CSV processed, 10 rows imported
  3. POST /programs/{id}/selection/generate → 5 participants selected by applied_at
  4. POST /programs/{id}/participants/{id}/notify → notification letters generated + sent
  5. POST /webhooks/sally/survey-complete → 4 surveys completed (80%)
  6. POST /programs/{id}/reports/generate → report includes all data
  Verify: Audit logs show all 6 events; participant statuses consistent; report accurate

Test: gift_selection_respects_eligibility
  Setup: 5 participants, 3 have completed surveys with score >= 3
  1. Apply gift eligibility filter
  2. POST /programs/{id}/gifts/select → 3 eligible; select 2 random
  Verify: Only 2 selected despite 5 participants; both have survey_status='completed'
```

### Pilot Plan

**Phase 1: Closed Pilot (Week 1)**
- 1 business unit (e.g., Engineering), 1 coordinator
- Single program cycle: 50 applicants, 10 participants
- Manual testing of all 8 core screens
- Monitor: error rates, SQL query performance, letter generation time
- Success criterion: Zero data loss, <1 minute cycle time

**Phase 2: Open Pilot (Week 2)**
- All business units, all coordinators (~8 people)
- 5 concurrent programs, ~500 applicants total
- Same workflows; monitor system under load
- Collect feedback on UI/UX
- Success criterion: <2s dashboard load time, no crashes

**Phase 3: Production GA (Week 3+)**
- Full deployment; ongoing support
- Weekly monitoring of cycle time, error rates, coordinator satisfaction
- Fallback: if critical bugs, maintain parallel manual workflow (spreadsheet) for 1 week

### Manual Fallback Procedures

**If Web App Unavailable:**
1. Coordinator continues with Google Sheets template (maintains schema for CSV import)
2. Manual letter generation: use Word template with mail-merge
3. Email selection results + letters directly (no Sally integration)
4. Manual survey import from Sally
5. Draft report in Google Docs → copy to Confluence
6. Upon app recovery: import CSVs into app to sync data

**If Sally Integration Fails:**
1. Coordinator manually exports survey results from Sally (CSV)
2. Upload CSV via "Manual Survey Import" screen
3. App matches by email; flags unmatched for coordinator review
4. Continue with reporting

**If Confluence Integration Fails:**
1. Export report as PDF or markdown
2. Coordinator manually posts to Confluence (copy-paste into page)
3. No data loss; only adds manual step

---

## Appendix: API Reference Summary

### Programs
- `POST /api/v1/programs` — Create program
- `GET /api/v1/programs/{id}` — Retrieve program details
- `PUT /api/v1/programs/{id}` — Update program
- `GET /api/v1/programs` — List programs (filtered by business_unit)

### Applicants
- `POST /api/v1/programs/{program_id}/applicants/upload` — Initiate CSV upload
- `GET /api/v1/programs/{program_id}/applicants/upload/{upload_id}/preview` — Preview rows
- `POST /api/v1/programs/{program_id}/applicants/upload/{upload_id}/confirm` — Commit upload
- `GET /api/v1/programs/{program_id}/applicants` — List applicants

### Selection
- `POST /api/v1/programs/{program_id}/selection/generate` — Run selection algorithm
- `GET /api/v1/programs/{program_id}/participants` — List selected participants
- `POST /api/v1/programs/{program_id}/participants/{participant_id}/notify` — Send notification letter

### Letters
- `POST /api/v1/letters/generate` — Batch generate letters
- `GET /api/v1/letters/{letter_id}` — Retrieve generated letter (file)

### Surveys
- `POST /api/v1/programs/{program_id}/surveys/send` — Send survey invitations
- `GET /api/v1/programs/{program_id}/survey-results` — Fetch survey results
- `POST /webhooks/sally/survey-complete` — Webhook (Sally → App)

### Gifts
- `POST /api/v1/programs/{program_id}/gifts/select` — Select gift recipients
- `GET /api/v1/programs/{program_id}/gifts` — List gift recipients

### Reports
- `POST /api/v1/programs/{program_id}/reports/generate` — Generate report + post to Confluence
- `GET /api/v1/programs/{program_id}/reports/{report_id}` — Retrieve report

### Audit
- `GET /api/v1/audit-logs` — List audit logs (filtered by program_id)
- `GET /api/v1/audit-logs/export` — Export audit logs as CSV

### Auth
- `POST /auth/login` — Authenticate user
- `POST /auth/logout` — Clear session
- `GET /auth/me` — Current user details

---

## Conclusion

This design document specifies a purpose-built automation system for AX센터's monthly wellness program workflow. The system reduces cycle time from 6–9 hours to <1.5 hours through:

1. **Automated template-based letter generation** with brand consistency
2. **Flexible participant selection** (FCFS, score, written justification quality)
3. **Integrated survey tracking** via Sally webhooks + polling
4. **Audit-ready data model** with complete action logging
5. **Simple role-based access control** for multi-coordinator safety

The MVP can be deployed in Week 1 on a single server with PostgreSQL + Node.js + React, scaling horizontally as needed. Fallback procedures ensure business continuity if the app becomes unavailable.

Next steps: Engineering team to detail API contracts, design UI mockups, and finalize Sally/Confluence API authentication (tokens/secrets).
