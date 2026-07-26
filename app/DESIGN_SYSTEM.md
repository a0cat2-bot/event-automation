# Design System — Program Automation

## Product Context
- **What this is:** Internal web app for HR/EHS coordinators to run employee-facing programs end to end — applicant intake, selection, letter generation, notifications, satisfaction surveys, gift selection, results reporting.
- **Who it's for:** Non-engineer internal coordinators, not developers. Korean-language UI throughout.
- **Space/industry:** Internal admin/ops tooling (comparable category: Notion, Linear, Retool, internal HR systems).
- **Project type:** Data-dense web app (tables, forms, dashboards) — no marketing site.

## Aesthetic Direction
- **Direction:** "Operational Clarity" — Toss's vivid, friendly blue identity merged with Claude/Anthropic's restrained warm-paper layout discipline.
- **Decoration level:** Intentional (subtle soft shadows, rounded corners) — not minimal-flat, not expressive.
- **Mood:** Trustworthy and systematic. A coordinator should be able to see program status at a glance without feeling like they're using cold enterprise software.
- **Reference sites:** linear.app (data density, systematic precision), vercel.com (typographic confidence, light theme), notion.com (warmth, personality), toss.im product design language (color identity, Pretendard typography).

## Typography
- **Single unified typeface: Pretendard** — used for headings, body, UI labels, and table data alike. No mixing with Latin-only webfonts (Inter, system-ui, Apple SD Gothic Neo). This is the single highest-leverage decision: most "vibe-coded" Korean apps default to the OS system font and look inconsistent; standardizing on Pretendard (the modern Korean design standard used by Toss, Wanted, and other well-regarded Korean product teams) immediately signals a considered product.
- **Loading:** `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css` (self-host later if the CDN dependency becomes a concern).
- **Weights:** 700 for headings/buttons, 600 for labels/table headers, 400/500 for body.
- **Data/Tables:** `font-variant-numeric: tabular-nums` on numeric cells for clean alignment.
- **Scale:** H1 28px/700, H2 20px/700, body 15px/400, small/label 12.5-13px/600, button 14.5px/700.

## Color
- **Approach:** Balanced — one vivid accent, warm neutrals, semantic status colors.
- **Primary:** `#3182F6` (Toss blue) — buttons, links, active nav, primary actions. Deliberately distinct from the generic SaaS blue (`#0052cc`) it replaces.
- **Primary hover:** `#1B64DA`
- **Primary tint:** `#EEF4FF` — selected rows, active nav background, info badges
- **Background (page):** `#FAFAF8` — warm paper, not cool gray/blue
- **Surface (cards/tables):** `#FFFFFF`
- **Border:** `#E7E5E1`
- **Ink (headings/primary text):** `#1F1D1A`
- **Muted (secondary text/labels):** `#767469`
- **Semantic:** success `#16A34A` (+ tint `#EAF7EE`), warning `#B8790A` (+ tint `#FDF3E0`), error `#F03E3E` (+ tint `#FDEBEB`)
- **Dark mode:** not in scope for this pass (internal tool, single-session desktop use).

## Spacing
- **Base unit:** 8px
- **Density:** Comfortable (current app is slightly cramped in places — table rows and form fields get more breathing room)
- **Scale:** 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / 64

## Layout
- **Approach:** Grid-disciplined — this is a table/form-heavy admin tool, not an editorial or marketing surface.
- **Border radius:** 10px standard (cards, buttons, inputs), 14px for larger containers, 999px for pills/badges — slightly more generous than the current 8px, borrowing Toss's friendlier rounding without going full playful.
- **Shadows:** Very subtle only — `0 1px 3px rgba(31,29,26,0.04)` on cards, `0 1px 2px rgba(31,29,26,0.06)` on primary buttons. Claude-style restraint, not Toss's occasionally heavier drop shadows.

## Motion
- **Approach:** Minimal-functional — transitions only where they aid comprehension (hover states, expand/collapse for the notification-history rows, loading states). No decorative animation.
- **Duration:** micro 100ms, short 150-200ms.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-24 | Initial design system created via /design-consultation | Existing UI read as generic/"vibe-coded" (default SaaS blue, system fonts, cool gray neutrals). Redesigned around Toss's blue identity + Pretendard typography + Claude's warm-paper restraint, confirmed via HTML preview against real Korean program-list content. |
