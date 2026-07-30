import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as XLSX from 'xlsx';

import { knoxIdToEmail, parseSallyIdentity, parseSallyImport } from './sallyImport.js';

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

test('knoxIdToEmail never invents a domain', () => {
  // A Knox ID that is already an address is taken as-is.
  assert.equal(knoxIdToEmail('gildong.hong@samsung.com'), 'gildong.hong@samsung.com');
  assert.equal(knoxIdToEmail('  gildong.hong@samsung.com  '), 'gildong.hong@samsung.com');

  // With no KNOX_EMAIL_DOMAIN configured, a bare ID yields nothing rather than a guessed address.
  // stageSallyImport turns the empty result into a row-level error the coordinator can act on.
  assert.equal(knoxIdToEmail('gildong.hong'), '');
  assert.equal(knoxIdToEmail(''), '');
  assert.equal(knoxIdToEmail('   '), '');
});
