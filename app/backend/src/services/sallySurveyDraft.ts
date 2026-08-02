export type SallySurveyKind = 'recruitment' | 'satisfaction';

export interface SallySurveyQuestion {
  type: 'short_answer' | 'single_choice' | 'rating_scale';
  text: string;
  choices?: Array<string | number>;
}

export interface SallySurveyDraft {
  title: string;
  team_name?: string;
  description?: string;
  completion_message?: string;
  questions: SallySurveyQuestion[];
}

export interface SallySurveyProgram {
  name: string;
  business_unit?: string;
  max_participants: number;
  intake_data: unknown;
}

export interface SallyProgramDetails {
  description?: string;
  date?: string;
  time?: string;
  location?: string;
  application_deadline?: string;
}

const identityQuestion =
  '프로님의 Knox ID / 성명 을 적어주세요. (예: gildong.hong / 홍길동)';

function intakeText(intakeData: unknown, key: string): string | undefined {
  if (!intakeData || typeof intakeData !== 'object' || Array.isArray(intakeData)) return undefined;
  const value = (intakeData as Record<string, unknown>)[key];
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

export function getSallyProgramDetails(program: SallySurveyProgram): SallyProgramDetails {
  return {
    description: intakeText(program.intake_data, 'description'),
    date: intakeText(program.intake_data, 'program_date'),
    time: intakeText(program.intake_data, 'program_time'),
    location: intakeText(program.intake_data, 'program_location'),
    application_deadline: intakeText(program.intake_data, 'application_deadline'),
  };
}

function programDetails(program: SallySurveyProgram, kind: SallySurveyKind): string | undefined {
  const { description, date, time, location, application_deadline } =
    getSallyProgramDetails(program);
  const dateTime = [date, time].filter(Boolean).join(' ');
  const details = [
    description,
    dateTime ? `일시: ${dateTime}` : undefined,
    location ? `장소: ${location}` : undefined,
    kind === 'recruitment' && application_deadline
      ? `신청 마감: ${application_deadline}`
      : undefined,
    kind === 'recruitment' ? `모집 인원: ${program.max_participants}명` : undefined,
  ].filter((value): value is string => Boolean(value));
  return details.length > 0 ? details.join('\n') : undefined;
}

function recruitmentAttendanceQuestion(program: SallySurveyProgram): SallySurveyQuestion {
  const { date, time, location } = getSallyProgramDetails(program);
  const context = [date, location].filter(Boolean).join(' ');

  if (!time) {
    return {
      type: 'short_answer',
      text: `${context ? `${context} ` : ''}참여 가능한 시간대를 적어주세요.`,
    };
  }

  const slots = time
    .split(/\s*(?:,|\/)\s*/)
    .map((slot) => slot.trim())
    .filter(Boolean);
  if (slots.length > 1) {
    return {
      type: 'single_choice',
      text: `${context ? `${context} ` : ''}참여를 원하는 시간대를 선택해주세요.`,
      choices: slots,
    };
  }

  const schedule = [date, time, location].filter(Boolean).join(' ');
  return {
    type: 'single_choice',
    text: `${schedule ? `${schedule} ` : ''}프로그램에 참석하시겠습니까?`,
    choices: ['Yes', 'No'],
  };
}

function recruitmentCompletionMessage(
  program: SallySurveyProgram,
  coordinatorName?: string | null,
): string | undefined {
  const { date } = getSallyProgramDetails(program);
  const detailNoticeDate = intakeText(program.intake_data, 'detail_notice_date');
  const dressCode = intakeText(program.intake_data, 'dress_code');
  const managerTimeSupport =
    Boolean(program.intake_data) &&
    typeof program.intake_data === 'object' &&
    !Array.isArray(program.intake_data) &&
    (program.intake_data as Record<string, unknown>).manager_time_support === true;
  const coordinator = coordinatorName?.trim();
  const businessUnit = program.business_unit?.trim();
  const lines = [
    ...(detailNoticeDate
      ? [
          `${date ? `${date} ` : ''}【${program.name}】관련 세부사항은`,
          `${detailNoticeDate}에 개인별로 안내드릴 예정입니다.`,
        ]
      : []),
    dressCode
      ? `참가 당일은 ${dressCode} 착용 ${managerTimeSupport ? '부탁드리며,' : '부탁드립니다.'}`
      : undefined,
    managerTimeSupport
      ? '참여하시는 분들의 부서장님들께는 별도로 시간배려도 요청드릴 예정입니다.'
      : undefined,
    coordinator
      ? `기타 문의사항은 ${businessUnit ? `${businessUnit} ` : ''}${coordinator} 프로에게 문의 부탁드립니다.`
      : undefined,
  ].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join('\n') : undefined;
}

export function generateSallySurveyDraft(
  program: SallySurveyProgram,
  kind: SallySurveyKind,
  coordinatorName?: string | null,
): SallySurveyDraft {
  const title = `${program.name} ${kind === 'recruitment' ? '참여자 모집' : '만족도 조사'}`;
  const teamName = program.business_unit?.trim();
  const description = programDetails(program, kind);

  if (kind === 'recruitment') {
    const completionMessage = recruitmentCompletionMessage(program, coordinatorName);
    return {
      title,
      ...(teamName ? { team_name: teamName } : {}),
      ...(description ? { description } : {}),
      ...(completionMessage ? { completion_message: completionMessage } : {}),
      questions: [
        { type: 'short_answer', text: identityQuestion },
        recruitmentAttendanceQuestion(program),
      ],
    };
  }

  return {
    title,
    ...(teamName ? { team_name: teamName } : {}),
    ...(description ? { description } : {}),
    questions: [
      {
        type: 'rating_scale',
        text: `${program.name} 프로그램에 전반적으로 얼마나 만족하셨나요?`,
        choices: [1, 2, 3, 4, 5],
      },
      {
        type: 'short_answer',
        text: `${program.name} 프로그램에 대한 제언을 자유롭게 적어주세요.`,
      },
    ],
  };
}
