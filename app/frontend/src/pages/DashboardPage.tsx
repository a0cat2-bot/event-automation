import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { listPrograms, type Program } from '../api/programs';
import { PageShell } from '../components/PageShell';

const STATUS_LABELS: Record<Program['status'], string> = {
  planning: '기획 중',
  recruitment_active: '모집 중',
  selection_in_progress: '선정 중',
  completed: '종료',
};

type StepStatus = 'done' | 'partial' | 'pending';

function intakeField(intakeData: Program['intake_data'], key: string): string | null {
  const value = intakeData?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function stepStatus(current: number, total: number): StepStatus {
  if (total <= 0) return current > 0 ? 'done' : 'pending';
  if (current >= total) return 'done';
  if (current > 0) return 'partial';
  return 'pending';
}

function progressStageLabel(program: Program): string {
  if (program.has_report) return '완료';
  if (program.gift_recipient_count > 0) return '상품 선정 중';
  if (program.survey_completed_count > 0) return '설문 진행 중';
  if (program.notified_count > 0) return '안내 발송 중';
  if (program.participant_count > 0) return '선정 완료';
  if (program.applicant_count > 0) return '모집 중';
  return '모집 준비';
}

function programDate(program: Program): Date | null {
  const value = intakeField(program.intake_data, 'program_date');
  if (!value) return null;

  const match = value.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
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

function ProgressStep({
  label,
  status,
  fraction,
}: {
  label: string;
  status: StepStatus;
  fraction?: string;
}) {
  return (
    <span className={`progress-step progress-step--${status}`}>
      {label}
      {fraction ? ` ${fraction}` : ''}
    </span>
  );
}

function ProgramProgress({ program }: { program: Program }) {
  return (
    <div className="progress-steps">
      <ProgressStep label="신청자" status={program.applicant_count > 0 ? 'done' : 'pending'} />
      <ProgressStep label="선정" status={program.participant_count > 0 ? 'done' : 'pending'} />
      <ProgressStep
        label="안내발송"
        status={stepStatus(program.notified_count, program.participant_count)}
        fraction={`${program.notified_count}/${program.participant_count}`}
      />
      <ProgressStep
        label="설문"
        status={stepStatus(program.survey_completed_count, program.participant_count)}
        fraction={`${program.survey_completed_count}/${program.participant_count}`}
      />
      <ProgressStep
        label="상품선정"
        status={program.gift_recipient_count > 0 ? 'done' : 'pending'}
      />
      <ProgressStep label="보고서" status={program.has_report ? 'done' : 'pending'} />
    </div>
  );
}

export function DashboardPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    listPrograms(controller.signal)
      .then(({ programs: nextPrograms }) => {
        if (!isCurrent) return;
        setPrograms(nextPrograms);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setLoadError(error instanceof Error ? error.message : '프로그램을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, []);

  const agendaGroups = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysLater = new Date(today);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    return [
      {
        label: '안내 발송 대기',
        programs: programs.filter(
          (program) =>
            program.participant_count > 0 && program.notified_count < program.participant_count,
        ),
      },
      {
        label: '설문 미완료',
        programs: programs.filter(
          (program) =>
            program.notified_count > 0 &&
            program.survey_completed_count < program.participant_count,
        ),
      },
      {
        label: '행사일 임박',
        programs: programs.filter((program) => {
          const date = programDate(program);
          return (
            date !== null &&
            date >= today &&
            date <= sevenDaysLater &&
            program.participant_count === 0
          );
        }),
      },
      {
        label: '보고서 미작성',
        programs: programs.filter(
          (program) => program.gift_recipient_count > 0 && !program.has_report,
        ),
      },
    ].filter((group) => group.programs.length > 0);
  }, [programs]);

  return (
    <PageShell
      title="대시보드"
      description="진행 중인 프로그램과 다음 작업을 확인하세요."
      showStubNote={false}
    >
      {!isLoading && !loadError ? (
        <section className="content-card dashboard-agenda" aria-labelledby="dashboard-agenda-title">
          <h2 id="dashboard-agenda-title">오늘 처리할 일</h2>
          {agendaGroups.length > 0 ? (
            <ul>
              {agendaGroups.map((group) => (
                <li key={group.label}>
                  <strong>
                    {group.label} ({group.programs.length})
                  </strong>
                  {' — '}
                  {group.programs.map((program, index) => (
                    <span key={program.id}>
                      {index > 0 ? ', ' : null}
                      <Link to={`/programs/${program.id}`}>{program.name}</Link>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p>처리할 일이 없습니다</p>
          )}
        </section>
      ) : null}

      <div className="section-heading">
        <div>
          <h2>프로그램 목록</h2>
          <p>생성한 프로그램과 진행 현황입니다.</p>
        </div>
        <Link className="button button--primary" to="/programs/new">
          + 새 프로그램
        </Link>
      </div>

      {isLoading ? <p className="state-message">프로그램을 불러오는 중입니다…</p> : null}
      {loadError ? (
        <p className="state-message state-message--error" role="alert">
          {loadError}
        </p>
      ) : null}

      {!isLoading && !loadError && programs.length === 0 ? (
        <div className="empty-state">
          <strong>아직 생성된 프로그램이 없습니다.</strong>
          <p>새 프로그램을 만들어 신청자 모집부터 결과 보고까지 진행해보세요.</p>
        </div>
      ) : null}

      {programs.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>프로그램명</th>
                <th>사업부</th>
                <th>상태</th>
                <th>일시</th>
                <th>신청자/참여자</th>
                <th>진행 단계</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {programs.map((program) => {
                const programDate = intakeField(program.intake_data, 'program_date');
                const programTime = intakeField(program.intake_data, 'program_time');
                const storedStatusLabel = STATUS_LABELS[program.status];
                const actualProgressLabel = progressStageLabel(program);
                return (
                  <tr key={program.id}>
                    <td>
                      <Link to={`/programs/${program.id}`}>{program.name}</Link>
                    </td>
                    <td>{program.business_unit}</td>
                    <td>
                      {storedStatusLabel}
                      {actualProgressLabel !== storedStatusLabel ? (
                        <span className="field-hint"> · 실제 진행: {actualProgressLabel}</span>
                      ) : null}
                    </td>
                    <td>{[programDate, programTime].filter(Boolean).join(' ') || '미입력'}</td>
                    <td>
                      {program.applicant_count}명 / {program.participant_count}명
                    </td>
                    <td>
                      <ProgramProgress program={program} />
                    </td>
                    <td>
                      <Link to={`/programs/${program.id}`}>상세 →</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </PageShell>
  );
}
