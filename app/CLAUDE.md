## Design System
Always read DESIGN_SYSTEM.md before making any visual or UI decisions in this app.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA/design-review mode, flag any code that doesn't match DESIGN_SYSTEM.md.

## Pre/Post Review for UI and Navigation Changes
Before implementing any change that touches UI or navigation (new page, new nav entry,
new top-level menu item, restructured page layout), briefly self-check and state the result:
- **Design fit**: does it match DESIGN_SYSTEM.md (tokens, spacing, component patterns already
  in styles.css)? Reuse existing classes/patterns before inventing new ones.
- **IA fit**: does this belong at its proposed nesting level? Before adding a new top-level
  nav item, ask whether it's frequent enough to earn that spot, or whether it belongs grouped
  under an existing menu (e.g. the "관리" dropdown for infrequent admin screens: 사업부 관리,
  조직 설정, 작업 히스토리). Prefer grouping over nav sprawl.

After implementing, before considering the task done: run typecheck/lint/build, then verify
live in the browser (screenshot or read_page) rather than assuming the change renders as
intended. For substantial features, this is a good point to reconsider the design/IA
questions above with the finished result in front of you, not just the plan.

Escalate to the `/design-review` or `/plan-design-review` skill for larger visual/IA audits
rather than doing this lightweight check — those skills are for a dedicated pass across many
screens, not a per-change gate.
