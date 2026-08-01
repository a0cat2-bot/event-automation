import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as XLSX from 'xlsx';

import { parseSallyExport, parseSallyIdentity, parseSallyImport } from './sallyImport.js';

function writeWorkbook(rows: unknown[][], filePath: string) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Results');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  writeFileSync(filePath, buffer);
}

test('parseSallyIdentity preserves parseable identity parts and reports malformed answers', () => {
  assert.deepEqual(parseSallyIdentity('gildong.hong / 홍길동'), {
    knoxId: 'gildong.hong',
    name: '홍길동',
    issues: [],
  });
  const missingSeparator = parseSallyIdentity('gildong.hong');
  assert.equal(missingSeparator.knoxId, 'gildong.hong');
  assert.equal(missingSeparator.name, null);
  assert.equal(missingSeparator.issues[0]?.code, 'invalid_sally_identity_format');
  const missingId = parseSallyIdentity('/ 홍길동');
  assert.equal(missingId.knoxId, null);
  assert.equal(missingId.name, '홍길동');
  assert.equal(missingId.issues[0]?.code, 'missing_sally_knox_id');
});

test('parseSallyImport maps exact headers and serializes only Q4 through Q13 answers', () => {
  const filePath = join(tmpdir(), `sally-import-${randomUUID()}.xlsx`);
  writeWorkbook(
    [
      ['Submit time', 'Email', 1, 3, 4, '11-1', '13-6', 14],
      [
        '',
        '',
        '프로님 Knox ID / 성명 을 적어주세요.',
        'Unused Q3',
        '현재 통증',
        '목 통증 빈도',
        '발 통증 강도',
        'Unused Q14',
      ],
      ['', '', 'SHORT', 'SHORT', 'NPS', 'MATRIX', 'MATRIX', 'SHORT'],
      [
        '2026-07-20T09:30:00+09:00',
        'gildong@example.com',
        'gildong.hong / 홍길동',
        'ignored',
        7,
        '자주',
        '',
        'ignored',
      ],
    ],
    filePath,
  );

  try {
    const records = parseSallyImport(filePath);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], {
      knox_id: 'gildong.hong',
      name: '홍길동',
      applied_at: '2026-07-20T09:30:00+09:00',
      department: null,
      justification: JSON.stringify({
        '현재 통증': 7,
        '목 통증 빈도': '자주',
        '발 통증 강도': null,
      }),
      score: null,
      issues: [],
    });
  } finally {
    rmSync(filePath, { force: true });
  }
});

test('parseSallyImport rejects exports without exact required headers', () => {
  const filePath = join(tmpdir(), `sally-import-${randomUUID()}.xlsx`);
  writeWorkbook(
    [
      ['Submit time', 'Email'],
      ['', ''],
      ['', ''],
    ],
    filePath,
  );

  try {
    assert.throws(() => parseSallyImport(filePath), /missing column "1"/);
  } finally {
    rmSync(filePath, { force: true });
  }
});


test('the same export parses identically from a path and from bytes', () => {
  // The browser automation writes to disk; a coordinator uploading their own download has only a
  // buffer. If the two ever diverged, an import would depend on how the file arrived.
  const filePath = join(tmpdir(), `sally-import-${randomUUID()}.xlsx`);
  const rows = [
    ['Submit time', 'Email', 1, 4, '11-1'],
    ['', '', '프로님 Knox ID / 성명 을 적어주세요.', '현재 통증', '목 통증 빈도'],
    ['', '', 'SHORT', 'NPS', 'MATRIX'],
    ['2026-07-20T09:30:00+09:00', '', 'gildong.hong / 홍길동', 7, '자주'],
  ];
  writeWorkbook(rows, filePath);

  try {
    const fromPath = parseSallyImport(filePath);
    const fromBytes = parseSallyExport(readFileSync(filePath));
    assert.deepEqual(fromBytes, fromPath);
    assert.equal(fromBytes[0]?.name, '홍길동');
  } finally {
    rmSync(filePath, { force: true });
  }
});
