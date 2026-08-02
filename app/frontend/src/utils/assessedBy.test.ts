import { describe, expect, it } from 'vitest';

import { ASSESSED_BY_CLASS, ASSESSED_BY_LABEL } from './assessedBy';

describe('assessment source presentation', () => {
  it('labels agent and AI assessments distinctly', () => {
    expect(ASSESSED_BY_LABEL.agent).toBe('Agent 평가');
    expect(ASSESSED_BY_LABEL.ai).toBe('AI 평가');
  });

  it('maps agent to warning styling and AI to ordinary information styling', () => {
    expect(ASSESSED_BY_CLASS.agent).toBe('status-badge--warning');
    expect(ASSESSED_BY_CLASS.ai).toBe('status-badge--info');
    expect(ASSESSED_BY_CLASS.ai).not.toBe(ASSESSED_BY_CLASS.agent);
  });
});
