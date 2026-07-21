# Claude Code Harness Configuration Summary

**Project:** `/Users/euiwonjung/workspace/class/.claude/`

## Permissions

- **Global (`settings.json`):** No allow/deny rules configured
- **Local (`settings.local.json`):** Single permission allowed — `Bash(gh api *)` (GitHub CLI API calls via Bash)

## Hooks

- None configured. The `hooks` object in `settings.json` is empty.

## Subdirectories (all empty)

- `agents/` — no custom agents defined
- `commands/` — no custom slash commands
- `docs/` — no project documentation
- `hooks/` — no hook implementations
- `skills/` — no custom skills

## Configuration State

This project has minimal harness configuration. Only GitHub CLI API calls are pre-approved locally to reduce permission prompts. All other Bash commands, file operations, and MCP tool calls will trigger permission prompts at runtime. No custom agents, skills, commands, or automation hooks are in place.
