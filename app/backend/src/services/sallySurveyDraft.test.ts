import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as XLSX from 'xlsx';

import { parseSallyImport } from './sallyImport.js';
import { generateSallySurveyDraft } from './sallySurveyDraft.js';

const fixedProgram = {
  name: '리더십 워크숍',
  max_participants: 24,
  intake_data: {
    description: '팀장의 코칭 역량을 키우는 워크숍입니다.',
    program_date: '2026년 7월 15일(수)',
    program_time: '11:00~12:00',
    program_location: '온라인(Teams)',
    application_deadline: '2026년 7월 10일(금)',
  },
};

const completionMessageProgram = {
  ...fixedProgram,
  name: 'My Healthy Lab : 운동 클래스',
  business_unit: 'EHS그룹(AX)',
  intake_data: {
    ...fixedProgram.intake_data,
    program_date: '2026년 9월 25일(금)',
    detail_notice_date: '2026년 9월 21일(월)',
    dress_code: '운동하기 편한 복장',
    manager_time_support: true,
  },
};

test('recruitment completion message includes every configured field', () => {
  const draft = generateSallySurveyDraft(completionMessageProgram, 'recruitment', '김아영');

  assert.equal(
    draft.completion_message,
    '2026년 9월 25일(금) 【My Healthy Lab : 운동 클래스】관련 세부사항은\n2026년 9월 21일(월)에 개인별로 안내드릴 예정입니다.\n참가 당일은 운동하기 편한 복장 착용 부탁드리며,\n참여하시는 분들의 부서장님들께는 별도로 시간배려도 요청드릴 예정입니다.\n기타 문의사항은 EHS그룹(AX) 김아영 프로에게 문의 부탁드립니다.',
  );
});

test('recruitment completion message omits each absent field cleanly', () => {
  const cases = [
    {
      key: 'detail_notice_date',
      expected:
        '참가 당일은 운동하기 편한 복장 착용 부탁드리며,\n참여하시는 분들의 부서장님들께는 별도로 시간배려도 요청드릴 예정입니다.\n기타 문의사항은 EHS그룹(AX) 김아영 프로에게 문의 부탁드립니다.',
    },
    {
      key: 'dress_code',
      expected:
        '2026년 9월 25일(금) 【My Healthy Lab : 운동 클래스】관련 세부사항은\n2026년 9월 21일(월)에 개인별로 안내드릴 예정입니다.\n참여하시는 분들의 부서장님들께는 별도로 시간배려도 요청드릴 예정입니다.\n기타 문의사항은 EHS그룹(AX) 김아영 프로에게 문의 부탁드립니다.',
    },
    {
      key: 'manager_time_support',
      expected:
        '2026년 9월 25일(금) 【My Healthy Lab : 운동 클래스】관련 세부사항은\n2026년 9월 21일(월)에 개인별로 안내드릴 예정입니다.\n참가 당일은 운동하기 편한 복장 착용 부탁드립니다.\n기타 문의사항은 EHS그룹(AX) 김아영 프로에게 문의 부탁드립니다.',
    },
  ] as const;

  for (const { key, expected } of cases) {
    const intakeData = { ...completionMessageProgram.intake_data };
    delete intakeData[key];
    const draft = generateSallySurveyDraft(
      { ...completionMessageProgram, intake_data: intakeData },
      'recruitment',
      '김아영',
    );
    assert.equal(draft.completion_message, expected);
    assert.doesNotMatch(draft.completion_message ?? '', /undefined|\n\n/);
  }

  const withoutCoordinator = generateSallySurveyDraft(completionMessageProgram, 'recruitment');
  assert.doesNotMatch(withoutCoordinator.completion_message ?? '', /기타 문의사항|김아영/);
});

test('recruitment completion message is absent when no completion fields are configured', () => {
  const draft = generateSallySurveyDraft(fixedProgram, 'recruitment');

  assert.equal(draft.completion_message, undefined);
  assert.equal(Object.hasOwn(draft, 'completion_message'), false);
});

test('manager time support false omits its sentence and leaves clean dress-code wording', () => {
  const draft = generateSallySurveyDraft(
    {
      ...completionMessageProgram,
      intake_data: {
        dress_code: '운동하기 편한 복장',
        manager_time_support: false,
      },
    },
    'recruitment',
  );

  assert.equal(draft.completion_message, '참가 당일은 운동하기 편한 복장 착용 부탁드립니다.');
  assert.doesNotMatch(draft.completion_message, /부서장|부탁드리며/);
});

test('satisfaction draft never includes a completion message', () => {
  const draft = generateSallySurveyDraft(completionMessageProgram, 'satisfaction', '김아영');

  assert.equal(Object.hasOwn(draft, 'completion_message'), false);
});

test('fixed-time recruitment draft has the import identity and literal attendance choices', () => {
  const draft = generateSallySurveyDraft(fixedProgram, 'recruitment');

  assert.equal(draft.title, '리더십 워크숍 참여자 모집');
  assert.equal(
    draft.description,
    '팀장의 코칭 역량을 키우는 워크숍입니다.\n일시: 2026년 7월 15일(수) 11:00~12:00\n장소: 온라인(Teams)\n신청 마감: 2026년 7월 10일(금)\n모집 인원: 24명',
  );
  assert.deepEqual(draft.questions, [
    {
      type: 'short_answer',
      text: '프로님의 Knox ID / 성명 을 적어주세요. (예: gildong.hong / 홍길동)',
    },
    {
      type: 'single_choice',
      text: '2026년 7월 15일(수) 11:00~12:00 온라인(Teams) 프로그램에 참석하시겠습니까?',
      choices: ['Yes', 'No'],
    },
  ]);
});

test('missing time asks for a preferred time without empty punctuation', () => {
  const draft = generateSallySurveyDraft(
    {
      name: '안전 교육',
      max_participants: 10,
      intake_data: { program_date: '2026년 8월', program_location: '수원 사업장' },
    },
    'recruitment',
  );

  assert.deepEqual(draft.questions[1], {
    type: 'short_answer',
    text: '2026년 8월 수원 사업장 참여 가능한 시간대를 적어주세요.',
  });
  assert.doesNotMatch(JSON.stringify(draft), /undefined|\(\)|\[\]/);
});

test('comma- and slash-separated program times become one choice per slot', () => {
  for (const programTime of ['10:00~12:00, 14:00~16:00', '10:00~12:00 / 14:00~16:00']) {
    const draft = generateSallySurveyDraft(
      {
        ...fixedProgram,
        intake_data: { ...fixedProgram.intake_data, program_time: programTime },
      },
      'recruitment',
    );
    assert.deepEqual(draft.questions[1]?.choices, ['10:00~12:00', '14:00~16:00']);
    assert.match(draft.questions[1]?.text ?? '', /시간대를 선택/);
  }
});

test('missing location and description are omitted cleanly', () => {
  const draft = generateSallySurveyDraft(
    {
      name: '심리 안전',
      max_participants: 8,
      intake_data: { program_date: '2026년 9월 1일', program_time: '09:00~10:00' },
    },
    'recruitment',
  );

  assert.equal(draft.description, '일시: 2026년 9월 1일 09:00~10:00\n모집 인원: 8명');
  assert.doesNotMatch(JSON.stringify(draft), /undefined|장소:|신청 마감:|\(\)|\[\]/);
});

test('satisfaction draft uses an integer 1-5 scale and a free-text suggestion', () => {
  const draft = generateSallySurveyDraft(fixedProgram, 'satisfaction');

  assert.equal(draft.title, '리더십 워크숍 만족도 조사');
  assert.equal(
    draft.description,
    '팀장의 코칭 역량을 키우는 워크숍입니다.\n일시: 2026년 7월 15일(수) 11:00~12:00\n장소: 온라인(Teams)',
  );
  assert.doesNotMatch(JSON.stringify(draft), /신청 마감|2026년 7월 10일\(금\)/);
  assert.deepEqual(draft.questions, [
    {
      type: 'rating_scale',
      text: '리더십 워크숍 프로그램에 전반적으로 얼마나 만족하셨나요?',
      choices: [1, 2, 3, 4, 5],
    },
    {
      type: 'short_answer',
      text: '리더십 워크숍 프로그램에 대한 제언을 자유롭게 적어주세요.',
    },
  ]);
});

test('a generated recruitment survey round-trips through the Sally import parser', () => {
  const draft = generateSallySurveyDraft(fixedProgram, 'recruitment');
  const filePath = join(tmpdir(), `sally-survey-round-trip-${randomUUID()}.xlsx`);
  const rows = [
    ['Submit time', 1, 2],
    ['', draft.questions[0]?.text, draft.questions[1]?.text],
    ['', 'SHORT_ANSWER', 'SINGLE_CHOICE'],
    ['2026-07-20T09:30:00+09:00', 'gildong.hong / 홍길동', 'Yes'],
    ['2026-07-20T09:35:00+09:00', 'younghee.kim / 김영희', 'No'],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Results');
  writeFileSync(
    filePath,
    XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  );

  try {
    const records = parseSallyImport(filePath);
    assert.equal(records[0]?.knox_id, 'gildong.hong');
    assert.deepEqual(records[0]?.issues, []);
    assert.equal(records[1]?.knox_id, 'younghee.kim');
    assert.equal(records[1]?.issues[0]?.code, 'declined_attendance');
  } finally {
    rmSync(filePath, { force: true });
  }
});
