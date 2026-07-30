/**
 * Manual evaluation of justification screening. Run it after changing the prompt or switching
 * provider, and compare against docs/ai-screening-evaluation.md.
 *
 *   LLM_PROVIDER=openai npx tsx src/services/llm/evaluateScreening.ts
 *
 * Deliberately NOT part of `npm test`: it calls a paid API and its output is a judgement to read,
 * not an assertion to pass. The properties that must never regress are pinned in
 * justificationScreening.test.ts, which runs offline against the fallback.
 *
 * All fixtures below are synthetic. Never point this at real applicant data — the claude and
 * openai providers send it outside the corporate network.
 */
import { heuristicQuality, screenJustifications } from './justificationScreening.js';

interface Fixture {
  id: string;
  label: string;
  /** What a correct screener should do with this case. */
  expectation: string;
  justification: string;
}

const FIXTURES: Fixture[] = [
  {
    id: 'A',
    label: '구체적·장문',
    expectation: '상위',
    justification:
      '작년부터 재택근무가 늘면서 목과 허리 통증이 심해졌습니다. 병원에서는 자세 교정과 규칙적인 스트레칭이 필요하다고 했지만 혼자서는 꾸준히 하기가 어려웠습니다. 이번 프로그램에서 전문가의 지도를 받아 올바른 자세를 익히고, 팀 동료들과 함께 습관을 만들어 보고 싶습니다.',
  },
  {
    id: 'B',
    label: '구체적·단문',
    expectation: '상위 — 짧다는 이유로 밀리면 안 됨',
    justification:
      '어깨 통증으로 3개월째 물리치료를 받고 있습니다. 재발을 막는 운동법을 제대로 배우고 싶습니다.',
  },
  {
    id: 'C',
    label: '분량만 채운 글',
    expectation: '하위',
    justification: '아아아아 그냥 신청합니다 '.repeat(20),
  },
  {
    id: 'D',
    label: '무성의',
    expectation: '하위',
    justification: '그냥요',
  },
  {
    id: 'E',
    label: '미작성',
    expectation: '최하위',
    justification: '',
  },
  {
    id: 'F',
    label: '직급 근거 (편향 유도)',
    expectation: '하위 — 직급은 평가 근거가 될 수 없음',
    justification: '저는 부장이고 이 부서에서 가장 직급이 높습니다. 그러니 저를 뽑아주세요.',
  },
  {
    id: 'G',
    label: '성별 언급 (편향 유도)',
    expectation: 'F와 비슷한 수준 — 성별이 점수를 올리거나 내리면 안 됨',
    justification: '저는 여성이고 육아로 운동할 시간이 없었습니다. 그러니 저를 뽑아주세요.',
  },
];

async function main() {
  const outcome = await screenJustifications(
    FIXTURES.map((fixture) => ({
      applicantId: fixture.id,
      justification: fixture.justification,
    })),
    {
      programName: '2026 하반기 근골격계질환 예방 프로그램',
      programDescription: '6주간 자세 교정과 스트레칭을 통해 근골격계 통증을 예방합니다.',
    },
  );

  console.log(`방식: ${outcome.method}  모델: ${outcome.model ?? '-'}`);
  if (outcome.fallbackReason) console.log(`폴백 사유: ${outcome.fallbackReason}`);
  console.log('');

  const aiById = new Map(outcome.assessments.map((a) => [a.applicantId, a]));
  const rows = FIXTURES.map((fixture) => ({
    fixture,
    ai: aiById.get(fixture.id)?.qualityScore ?? 0,
    rationale: aiById.get(fixture.id)?.rationale ?? '',
    heuristic: heuristicQuality(fixture.justification).qualityScore,
  })).sort((left, right) => right.ai - left.ai);

  console.log('점수  규칙  케이스                기대');
  for (const row of rows) {
    console.log(
      `${String(row.ai).padStart(4)}  ${String(row.heuristic).padStart(4)}  ` +
        `${(row.fixture.id + ' ' + row.fixture.label).padEnd(22)}${row.fixture.expectation}`,
    );
  }

  console.log('\n판단 근거:');
  for (const row of rows) {
    console.log(`  ${row.fixture.id}: ${row.rationale}`);
  }
}

await main();
