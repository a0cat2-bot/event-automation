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

test('every answer column is captured, whatever a survey numbers its questions', () => {
  // Question numbers were once hardcoded to 4-13, which matched one health questionnaire and left
  // every other survey with empty answers — a real signup export numbered its only real question 2
  // and imported nothing.
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
      justification: JSON.stringify({
        'Unused Q3': 'ignored',
        '현재 통증': 7,
        '목 통증 빈도': '자주',
        '발 통증 강도': null,
        'Unused Q14': 'ignored',
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

test('metadata columns are not mistaken for answers', () => {
  // A real export carries Open time, Note, Device info and four UTM columns alongside the answers.
  const filePath = join(tmpdir(), `sally-import-${randomUUID()}.xlsx`);
  writeWorkbook(
    [
      ['Open time', 'Submit time', 'Email', 'Note', 'Device info', 'UTM Source', 1, 2],
      ['', '', '', '', '', '', '프로님의 Knox ID / 성명', '참석하시겠습니까?'],
      ['', '', '', '', '', '', 'SHORT_ANSWER', 'SINGLE_CHOICE'],
      ['2026-07-30 12:00:00', '2026-07-30 12:31:24', '', 'note', 'iPhone', 'kakao', 'a.b / 이철수', 'Yes'],
    ],
    filePath,
  );

  try {
    const [record] = parseSallyImport(filePath);
    assert.deepEqual(JSON.parse(record?.justification ?? '{}'), { '참석하시겠습니까?': 'Yes' });
    assert.equal(record?.name, '이철수');
  } finally {
    rmSync(filePath, { force: true });
  }
});

test('someone who declines is flagged rather than imported', () => {
  const filePath = join(tmpdir(), `sally-import-${randomUUID()}.xlsx`);
  writeWorkbook(
    [
      ['Submit time', 1, 2],
      ['', '프로님의 Knox ID / 성명', '프로그램을 오프라인 참석하시겠습니까?'],
      ['', 'SHORT_ANSWER', 'SINGLE_CHOICE'],
      ['2026-07-30 12:00:00', 'a.b / 이철수', 'Yes'],
      ['2026-07-30 12:05:00', 'c.d / 김영희', 'No'],
    ],
    filePath,
  );

  try {
    const records = parseSallyImport(filePath);
    assert.deepEqual(records[0]?.issues, [], 'the attendee has nothing flagged');
    assert.equal(records[1]?.issues[0]?.code, 'declined_attendance');
    assert.equal(records[1]?.issues[0]?.type, 'error', 'the confirm step excludes error rows');
    assert.equal(records.length, 2, 'the decline is still visible to the coordinator');
  } finally {
    rmSync(filePath, { force: true });
  }
});

test('a No to a question about the past is not read as declining', () => {
  // "이전에 참여한 적 있습니까?" answered No must not drop a genuine applicant, which is why the
  // rule needs a forward-looking form and not merely the word 참여.
  const filePath = join(tmpdir(), `sally-import-${randomUUID()}.xlsx`);
  writeWorkbook(
    [
      ['Submit time', 1, 2],
      ['', '프로님의 Knox ID / 성명', '이전에 유사 프로그램에 참여한 적 있습니까?'],
      ['', 'SHORT_ANSWER', 'SINGLE_CHOICE'],
      ['2026-07-30 12:00:00', 'a.b / 이철수', 'No'],
    ],
    filePath,
  );

  try {
    assert.deepEqual(parseSallyImport(filePath)[0]?.issues, []);
  } finally {
    rmSync(filePath, { force: true });
  }
});
