import { Fragment, useEffect, useState } from 'react';

import {
  formatDuration,
  getCycleMetrics,
  type CycleMetricsResponse,
} from '../api/cycleMetrics';
import { PageShell } from '../components/PageShell';

export function CycleMetricsPage() {
  const [data, setData] = useState<CycleMetricsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedProgramId, setExpandedProgramId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    getCycleMetrics(controller.signal)
      .then((next) => {
        if (!isCurrent) return;
        setData(next);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setLoadError(error instanceof Error ? error.message : '소요 시간을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, []);

  const summary = data?.summary;

  return (
    <PageShell
      title="운영 소요 시간"
      description="작업 히스토리에 기록된 시각으로부터 프로그램 한 사이클에 걸린 시간을 계산합니다."
      designSection="운영 소요 시간"
      showStubNote={false}
    >
      {isLoading ? <p className="state-message">소요 시간을 계산하는 중입니다…</p> : null}
      {loadError ? (
        <p className="state-message state-message--error" role="alert">
          {loadError}
        </p>
      ) : null}

      {!isLoading && !loadError && data ? (
        <>
          <div className="placeholder-grid">
            <article>
              <h2>완료된 사이클</h2>
              <p>
                {summary?.completed_cycles}건 / 전체 {summary?.total_programs}건
              </p>
            </article>
            <article>
              <h2>평균 전체 기간</h2>
              <p>{formatDuration(summary?.average_total_minutes ?? null)}</p>
            </article>
            <article>
              <h2>평균 실작업 시간</h2>
              <p>{formatDuration(summary?.average_hands_on_minutes ?? null)}</p>
            </article>
          </div>

          <p className="field-hint" style={{ marginTop: '1rem' }}>
            <strong>전체 기간</strong>은 프로그램 생성부터 결과 보고서까지의 달력상 시간이라
            신청 접수를 기다린 시간이 포함됩니다. <strong>실작업 시간</strong>은 단계 사이 간격 중
            60분을 넘는 부분을 대기로 보고 제외한 값으로, 실제 손이 간 시간의 하한선입니다.
          </p>

          {summary?.completed_cycles === 0 ? (
            <div className="empty-state" style={{ marginTop: '1.5rem' }}>
              <strong>아직 완료된 사이클이 없습니다.</strong>
              <p>
                프로그램 생성부터 결과 보고서까지 한 번 진행하면 여기에 소요 시간이 집계됩니다.
              </p>
            </div>
          ) : null}

          <div className="section-heading" style={{ marginTop: '2rem' }}>
            <div>
              <h2>프로그램별</h2>
              <p>행을 눌러 단계별 진행 시각을 확인합니다.</p>
            </div>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>프로그램</th>
                  <th>상태</th>
                  <th>전체 기간</th>
                  <th>실작업</th>
                  <th>신청자/참여자</th>
                  <th>레터</th>
                </tr>
              </thead>
              <tbody>
                {data.programs.map((program) => (
                  <Fragment key={program.programId}>
                    <tr
                      onClick={() =>
                        setExpandedProgramId((current) =>
                          current === program.programId ? null : program.programId,
                        )
                      }
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{program.programName}</td>
                      <td>
                        <span
                          className={
                            program.complete
                              ? 'status-badge status-badge--success'
                              : 'status-badge'
                          }
                        >
                          {program.complete ? '완료' : '진행 중'}
                        </span>
                      </td>
                      <td>{formatDuration(program.totalMinutes)}</td>
                      <td>{formatDuration(program.handsOnMinutes)}</td>
                      <td>
                        {program.applicantCount}명 / {program.participantCount}명
                      </td>
                      <td>{program.lettersGenerated}건</td>
                    </tr>
                    {expandedProgramId === program.programId ? (
                      <tr className="notification-detail-row">
                        <td colSpan={6}>
                          <div className="notification-detail-panel">
                            <table>
                              <thead>
                                <tr>
                                  <th>단계</th>
                                  <th>횟수</th>
                                  <th>시작 후</th>
                                  <th>최초 시각</th>
                                </tr>
                              </thead>
                              <tbody>
                                {program.steps.map((step) => (
                                  <tr key={step.step}>
                                    <td>{step.label}</td>
                                    <td>{step.occurrences === 0 ? '—' : `${step.occurrences}회`}</td>
                                    <td>{formatDuration(step.minutesFromStart)}</td>
                                    <td>
                                      {step.firstAt
                                        ? new Date(step.firstAt).toLocaleString('ko-KR')
                                        : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </PageShell>
  );
}
