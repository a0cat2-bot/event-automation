import assert from 'node:assert/strict';
import test from 'node:test';

import { redactPersonalData, withApplicantHandles } from './redaction.js';

/**
 * These tests are the evidence behind the claim that the app sends no contact details or employee
 * numbers to AI Pro. Data Privacy approval is not available to this service, so that claim has to
 * be enforced by code rather than by convention — which means it has to be pinned here.
 */

test('email addresses never leave', () => {
  assert.equal(
    redactPersonalData('연락은 hong.gildong@samsung.com 으로 주세요'),
    '연락은 [이메일] 으로 주세요',
  );
});

test('phone numbers never leave, however they are punctuated', () => {
  for (const phone of ['010-1234-5678', '01012345678', '010 1234 5678', '+82-10-1234-5678']) {
    const redacted = redactPersonalData(`제 번호는 ${phone} 입니다`);
    assert.ok(!/\d{4}/.test(redacted), `${phone} left digits behind: ${redacted}`);
  }
});

test('a resident registration number is caught before the digit rules split it', () => {
  assert.equal(redactPersonalData('900101-1234567'), '[주민등록번호]');
});

test('employee numbers never leave, labelled or bare', () => {
  // The organisation treats 사번 as personal data, and the app deliberately does not store it.
  assert.equal(redactPersonalData('사번은 12345678 입니다'), '[사번] 입니다');
  assert.equal(redactPersonalData('12345678 로 문의했습니다'), '[숫자] 로 문의했습니다');
});

test('ordinary numbers a reviewer needs are kept', () => {
  // Over-redaction is cheap but not free; years and quantities carry real meaning in a motivation
  // essay, and they are short enough not to identify anyone.
  assert.equal(
    redactPersonalData('2019년부터 3년간 12건의 개선활동을 했습니다'),
    '2019년부터 3년간 12건의 개선활동을 했습니다',
  );
});

test('names are left alone', () => {
  // Names are the one identifier the organisation accepts handling, and the screening prompt is
  // what keeps them out of the evaluation rather than removal.
  assert.equal(redactPersonalData('저는 김철수입니다'), '저는 김철수입니다');
  assert.equal(redactPersonalData('이상해요 정말 이상합니다'), '이상해요 정말 이상합니다');
});

test('text with nothing to redact is returned unchanged', () => {
  const clean = '평소 안전관리에 관심이 많아 지원했습니다. 현장 경험을 넓히고 싶습니다.';
  assert.equal(redactPersonalData(clean), clean);
});

test('several kinds of personal data in one sentence all go', () => {
  assert.equal(
    redactPersonalData('안녕하세요 김철수입니다. 사번 87654321, 010-2222-3333, kim@samsung.com 입니다.'),
    '안녕하세요 김철수입니다. [사번], [전화번호], [이메일] 입니다.',
  );
});

const applicant = {
  id: 'a1',
  program_id: 'p1',
  email: 'kim@samsung.com',
  name: '김철수',
  department: 'AX센터 EHS그룹',
  score: 80,
  justification: '평소 안전관리에 관심이 많습니다.',
};

test('identity fields are absent, not blanked, once handles are applied', () => {
  const [row] = withApplicantHandles([applicant]);
  assert.ok(row);

  assert.equal('email' in row, false);
  assert.equal('name' in row, false);
  assert.equal('department' in row, false);
  assert.equal(JSON.stringify(row).includes('김철수'), false);
  assert.equal(JSON.stringify(row).includes('samsung.com'), false);
});

test('what an agent needs to act on and explain itself survives', () => {
  const [row] = withApplicantHandles([applicant]);
  assert.ok(row);

  assert.equal(row.id, 'a1');
  assert.equal(row.score, 80);
  assert.equal(row.justification, '평소 안전관리에 관심이 많습니다.');
  assert.equal(row.handle, '신청자 1');
});

test('handles follow the order a coordinator sees, so they can be matched back', () => {
  const rows = withApplicantHandles([applicant, { ...applicant, id: 'a2' }, { ...applicant, id: 'a3' }]);

  assert.deepEqual(
    rows.map(({ id, handle }) => [id, handle]),
    [
      ['a1', '신청자 1'],
      ['a2', '신청자 2'],
      ['a3', '신청자 3'],
    ],
  );
});
