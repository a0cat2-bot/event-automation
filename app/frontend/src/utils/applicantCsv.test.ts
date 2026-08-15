import { describe, expect, it } from 'vitest';

import { buildCsvTemplate } from './applicantCsv';

describe('buildCsvTemplate', () => {
  it('starts with a UTF-8 BOM code unit', () => {
    expect(buildCsvTemplate('score').charCodeAt(0)).toBe(0xfeff);
  });

  it('includes score but not justification in score mode', () => {
    const header = buildCsvTemplate('score').split('\n')[0].slice(1);

    expect(header).toBe('name,email,score,applied_at');
    expect(header).not.toContain('justification');
  });

  it('includes justification but not score in written justification mode', () => {
    const header = buildCsvTemplate('written_justification').split('\n')[0].slice(1);

    expect(header).toBe('name,email,justification,applied_at');
    expect(header).not.toContain('score');
  });

  it('never asks for a department, which the system does not manage', () => {
    expect(buildCsvTemplate('score')).not.toContain('department');
    expect(buildCsvTemplate('written_justification')).not.toContain('부서');
  });

  it('includes neither mode-specific column in first-come-first-served mode', () => {
    const header = buildCsvTemplate('first_come_first_served').split('\n')[0].slice(1);

    expect(header).toBe('name,email,applied_at');
  });

});
