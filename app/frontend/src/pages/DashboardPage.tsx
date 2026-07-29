import { IconSearch } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { listPrograms, type Program } from '../api/programs';
import { PageShell } from '../components/PageShell';
import { programDateDisplay, programStartDateValue } from '../utils/program';

const STATUS_LABELS: Record<Program['status'], string> = {
  planning: '기획 중',
  recruitment_active: '모집 중',
  selection_in_progress: '선정 중',
  completed: '종료',
};

const STATUS_BADGE_CLASS: Record<Program['status'], string> = {
  planning: 'status-badge',
  recruitment_active: 'status-badge status-badge--info',
  selection_in_progress: 'status-badge status-badge--warning',
  completed: 'status-badge status-badge--success',
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

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Program['status'] | 'all'>('all');

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
          const date = programStartDateValue(program.intake_data) ?? programDate(program);
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

  const filteredPrograms = programs.filter((program) => {
    const matchesStatus = statusFilter === 'all' || program.status === statusFilter;
    const matchesSearch = program.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <PageShell
      title="프로그램"
      designSection="대시보드"
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
        <div className="program-filter-row">
          <div className="search-input">
            <IconSearch size={16} stroke={2} aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="프로그램명 검색"
              aria-label="프로그램명 검색"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as Program['status'] | 'all')
            }
            aria-label="상태 필터"
          >
            <option value="all">전체 상태</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {programs.length > 0 && filteredPrograms.length === 0 ? (
        <p className="state-message">조건에 맞는 프로그램이 없습니다.</p>
      ) : null}

      {filteredPrograms.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>프로그램명</th>
                <th style={{ width: '10%' }}>사업부</th>
                <th>상태</th>
                <th>일시</th>
                <th>신청자/참여자</th>
                <th style={{ width: '30%' }}>진행 단계</th>
              </tr>
            </thead>
            <tbody>
              {filteredPrograms.map((program) => {
                const dateDisplay = programDateDisplay(program.intake_data);
                const structuredDateDisplay =
                  dateDisplay &&
                  /^\d{4}-\d{2}-\d{2}(?: ~ \d{4}-\d{2}-\d{2})?$/.test(dateDisplay)
                    ? dateDisplay
                    : null;
                const legacyDate = structuredDateDisplay ? null : programDate(program);
                return (
                  <tr key={program.id}>
                    <td>
                      <Link to={`/programs/${program.id}`}>{program.name}</Link>
                    </td>
                    <td>{program.business_unit}</td>
                    <td>
                      <span className={STATUS_BADGE_CLASS[program.status]}>
                        {STATUS_LABELS[program.status]}
                      </span>
                    </td>
                    <td>
                      {structuredDateDisplay ??
                        (legacyDate ? formatIsoDate(legacyDate) : '미입력')}
                    </td>
                    <td>
                      {program.applicant_count}명 / {program.participant_count}명
                    </td>
                    <td>
                      <ProgramProgress program={program} />
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
