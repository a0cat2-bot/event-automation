import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSallySurveyDescriptionHtml } from './sallySurveyDescriptionImage.js';

const fullProgram = {
  name: '리더십 코칭 워크숍',
  max_participants: 24,
  intake_data: {
    description: '팀장의 코칭 역량을 함께 키우는 실습형 워크숍입니다.',
    program_date: '2026년 7월 15일(수)',
    program_time: '11:00~12:00',
    program_location: '온라인(Teams)',
    application_deadline: '2026년 7월 10일(금)',
  },
};

function buildHtml(
  intakeData: Record<string, unknown>,
  characterDataUrl: string | null = 'data:image/png;base64,character',
): string {
  return buildSallySurveyDescriptionHtml({
    program: { ...fullProgram, intake_data: intakeData },
    orgDisplayName: '피플팀',
    characterDataUrl,
  });
}

function assertClean(html: string): void {
  assert.doesNotMatch(html, /undefined/);
  assert.doesNotMatch(html, /<span class="detail-label">\s*<\/span>/);
}

test('all programme fields and the character image are rendered from their real values', () => {
  const html = buildHtml(fullProgram.intake_data);

  assert.match(html, /피플팀/);
  assert.match(html, /리더십 코칭 워크숍/);
  assert.match(html, /팀장의 코칭 역량을 함께 키우는 실습형 워크숍입니다\./);
  assert.match(html, /2026년 7월 15일\(수\) 11:00~12:00/);
  assert.match(html, /신청 마감/);
  assert.match(html, /2026년 7월 10일\(금\)/);
  assert.match(html, /온라인\(Teams\)/);
  assert.match(html, /src="data:image\/png;base64,character"/);
  assert.match(html, /width: 1200px; height: 675px/);
  assertClean(html);
});

test('missing date and time omit the entire 일시 row', () => {
  const html = buildHtml({
    description: fullProgram.intake_data.description,
    program_location: fullProgram.intake_data.program_location,
  });

  assert.doesNotMatch(html, />일시</);
  assert.match(html, />장소</);
  assertClean(html);
});

test('missing location omits the entire 장소 row', () => {
  const html = buildHtml({
    description: fullProgram.intake_data.description,
    program_date: fullProgram.intake_data.program_date,
    program_time: fullProgram.intake_data.program_time,
  });

  assert.match(html, />일시</);
  assert.doesNotMatch(html, />장소</);
  assertClean(html);
});

test('missing description omits the description element', () => {
  const html = buildHtml({
    program_date: fullProgram.intake_data.program_date,
    program_time: fullProgram.intake_data.program_time,
    program_location: fullProgram.intake_data.program_location,
  });

  assert.doesNotMatch(html, /class="description"/);
  assert.match(html, /리더십 코칭 워크숍/);
  assertClean(html);
});

test('no character image leaves the character space empty without a placeholder', () => {
  const html = buildHtml(fullProgram.intake_data, null);

  assert.match(html, /<div class="character-slot" aria-hidden="true"><\/div>/);
  assert.doesNotMatch(html, /<img/);
  assertClean(html);
});

test('long content preserves the programme name and applies the compact title and description clamp', () => {
  const programName = '글로벌 리더를 위한 지속가능경영과 조직문화 혁신 실천 역량 강화 집중 워크숍';
  const description =
    '조직문화 혁신과 지속가능경영을 주제로 한 심화 과정으로, 사내 전문가와 외부 연사가 함께 진행합니다';
  const html = buildSallySurveyDescriptionHtml({
    program: {
      ...fullProgram,
      name: programName,
      intake_data: { ...fullProgram.intake_data, description },
    },
    orgDisplayName: '피플팀',
    characterDataUrl: null,
  });

  assert.match(html, new RegExp(programName));
  assert.match(html, /class="canvas long-name long-description"/);
  assert.match(html, />일시</);
  assert.match(html, />장소</);
  assert.match(html, /신청 마감/);
  assert.match(html, /\.content \{[^}]*overflow: hidden;/);
  assert.match(html, /\.long-name h1 \{[^}]*font-size: 54px;/);
  assert.match(html, /\.long-description \.description \{[^}]*-webkit-line-clamp: 2;/);
  assertClean(html);
});

test('short content keeps the default title and unclamped description', () => {
  const html = buildSallySurveyDescriptionHtml({
    program: {
      ...fullProgram,
      name: '2026 하반기 웰니스 챌린지',
      intake_data: {
        description: '6주간 걷기·운동 챌린지, 완주자 대상 만족도 설문 후 추첨 상품 지급',
        program_date: '2026년 9월 21일(월)',
        program_time: '09:00~18:00',
        program_location: '잠실캠퍼스 헬스장',
      },
    },
    orgDisplayName: '피플팀',
    characterDataUrl: null,
  });

  assert.match(html, /class="canvas"/);
  assert.doesNotMatch(html, /class="canvas [^"]*(?:long-name|long-description)/);
  assert.match(html, /h1 \{[^}]*font-size: 72px;/);
  assertClean(html);
});
