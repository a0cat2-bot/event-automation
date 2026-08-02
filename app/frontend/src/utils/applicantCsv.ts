import type { SelectionMode } from '../api/programs';

/**
 * Builds the upload template for a program's selection mode.
 *
 * The columns are not the same for every program — a score-based intake needs `score` and a
 * written-justification intake needs `justification` — so a single generic template would be
 * wrong for two modes out of three. This generates the one that matches the program in hand.
 *
 * The leading BOM is what makes Excel read the file as UTF-8. Without it Korean opens as mojibake,
 * and the natural fix — re-saving from Excel as EUC-KR — produces a file the upload cannot decode.
 */
export function buildCsvTemplate(selectionMode: SelectionMode): string {
  const columns = ['name', 'email', 'department'];
  if (selectionMode === 'score') columns.push('score');
  if (selectionMode === 'written_justification') columns.push('justification');
  columns.push('applied_at');

  const example: Record<string, string> = {
    name: '홍길동',
    email: 'gildong.hong@samsung.com',
    department: 'AX센터 EHS그룹',
    score: '85',
    justification: '평소 안전관리에 관심이 많아 지원했습니다.',
    applied_at: '2026-09-01T09:00:00',
  };

  // Defensive: none of the example values above contains a comma or a quote, so this never fires
  // today. It stays because a future example that does would otherwise corrupt the file silently.
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const rows = [
    columns.join(','),
    columns.map((column) => escape(example[column] ?? '')).join(','),
  ];
  return `\ufeff${rows.join('\n')}\n`;
}
