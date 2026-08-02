import { describe, expect, it } from 'vitest';

import { intakeField, programDateDisplay, programStartDateValue } from './program';

describe('programStartDateValue', () => {
  it('returns a Date for a valid ISO date', () => {
    expect(programStartDateValue({ program_start_date: '2026-09-21' })).toEqual(
      new Date(2026, 8, 21),
    );
  });

  it('rejects a non-ISO date', () => {
    expect(programStartDateValue({ program_start_date: '2026년 9월 21일(월)' })).toBeNull();
  });

  it('rejects a date that Date would roll into the next month', () => {
    expect(programStartDateValue({ program_start_date: '2026-02-30' })).toBeNull();
  });

  it('accepts a real leap day', () => {
    expect(programStartDateValue({ program_start_date: '2024-02-29' })).toEqual(
      new Date(2024, 1, 29),
    );
  });

  it('rejects February 29 outside a leap year', () => {
    expect(programStartDateValue({ program_start_date: '2026-02-29' })).toBeNull();
  });
});

describe('programDateDisplay', () => {
  it('renders different start and end dates as a range', () => {
    expect(
      programDateDisplay({
        program_start_date: '2026-09-21',
        program_end_date: '2026-09-23',
      }),
    ).toBe('2026-09-21 ~ 2026-09-23');
  });

  it('renders identical start and end dates once', () => {
    expect(
      programDateDisplay({
        program_start_date: '2026-09-21',
        program_end_date: '2026-09-21',
      }),
    ).toBe('2026-09-21');
  });

  it('falls back to program_date when start and end are absent', () => {
    expect(programDateDisplay({ program_date: '2026-09-21' })).toBe('2026-09-21');
  });

  it('returns null when no program date is present', () => {
    expect(programDateDisplay({})).toBeNull();
    expect(programDateDisplay(null)).toBeNull();
  });
});

describe('intakeField', () => {
  it('treats a whitespace-only string as absent', () => {
    expect(intakeField({ program_date: '   \t\n' }, 'program_date')).toBeNull();
  });
});
