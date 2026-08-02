/**
 * Names the source of a score so a coordinator knows how much it is worth.
 *
 * `agent` is styled as a warning rather than as information: a score supplied through MCP did not
 * pass the fixed prompt, the bias instructions, or the redaction the in-app path enforces, so it
 * deserves a closer read — not because it is wrong, but because nothing here vouches for it.
 */
export const ASSESSED_BY_LABEL: Record<'ai' | 'heuristic' | 'agent', string> = {
  ai: 'AI 평가',
  agent: 'Agent 평가',
  heuristic: '기본 방식',
};

export const ASSESSED_BY_CLASS: Record<'ai' | 'heuristic' | 'agent', string> = {
  ai: 'status-badge--info',
  agent: 'status-badge--warning',
  heuristic: 'status-badge--success',
};
