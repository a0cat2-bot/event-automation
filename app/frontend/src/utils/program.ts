import type { Program } from '../api/programs';

export const SELECTION_MODE_LABELS: Record<Program['selection_mode'], string> = {
  first_come_first_served: '선착순',
  score: '점수 기반',
  written_justification: '서술형 심사',
};

export const PROGRAM_STATUS_LABELS: Record<Program['status'], string> = {
  planning: '기획 중',
  recruitment_active: '모집 중',
  selection_in_progress: '선정 중',
  completed: '종료',
};

export function intakeField(intakeData: Program['intake_data'], key: string): string | null {
  const value = intakeData?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function programDateDisplay(intakeData: Program['intake_data']): string | null {
  const startDate = intakeField(intakeData, 'program_start_date');
  if (startDate) {
    const endDate = intakeField(intakeData, 'program_end_date');
    return endDate && endDate !== startDate ? `${startDate} ~ ${endDate}` : startDate;
  }
  return intakeField(intakeData, 'program_date');
}

export function programStartDateValue(intakeData: Program['intake_data']): Date | null {
  const value = intakeField(intakeData, 'program_start_date');
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}
