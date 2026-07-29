import { useEffect, useMemo, useState } from 'react';

import {
  auditLogExportUrl,
  listAuditLogs,
  type AuditLogEntry,
} from '../api/auditLogs';
import { listPrograms, type Program } from '../api/programs';
import { PageShell } from '../components/PageShell';
import { formatDateTime } from '../utils/format';

function detailsText(details: unknown): string {
  if (details == null) return '—';
  return JSON.stringify(details) ?? '—';
}

export function AuditLogPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    listPrograms(controller.signal)
      .then(({ programs: nextPrograms }) => {
        if (isCurrent) setPrograms(nextPrograms);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (isCurrent) {
          setLoadError(error instanceof Error ? error.message : '프로그램을 불러오지 못했습니다.');
        }
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;
    setIsLoading(true);

    listAuditLogs(selectedProgramId || undefined, controller.signal)
      .then(({ entries: nextEntries }) => {
        if (!isCurrent) return;
        setEntries(nextEntries);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setLoadError(error instanceof Error ? error.message : '작업 히스토리를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [selectedProgramId]);

  const programNames = useMemo(
    () => new Map(programs.map((program) => [program.id, program.name])),
    [programs],
  );

  return (
    <PageShell
      title="작업 히스토리"
      description="프로그램 작업 이력을 최근 순으로 최대 200건까지 확인합니다."
      designSection="작업 히스토리"
      showStubNote={false}
    >
      <section className="content-card audit-log-card" aria-labelledby="audit-log-list-title">
        <div className="section-heading">
          <div>
            <h2 id="audit-log-list-title">작업 이력</h2>
            <p>프로그램을 선택해 관련 기록만 볼 수 있습니다.</p>
          </div>
          <a
            className="button button--secondary"
            href={auditLogExportUrl(selectedProgramId || undefined)}
          >
            CSV 내보내기
          </a>
        </div>

        <label className="audit-program-filter">
          프로그램
          <select
            value={selectedProgramId}
            onChange={(event) => setSelectedProgramId(event.target.value)}
          >
            <option value="">전체 프로그램</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </select>
        </label>

        {isLoading ? <p className="state-message">작업 히스토리를 불러오는 중입니다…</p> : null}
        {loadError ? (
          <p className="state-message state-message--error" role="alert">
            {loadError}
          </p>
        ) : null}
        {!isLoading && !loadError && entries.length === 0 ? (
          <div className="empty-state">
            <strong>표시할 작업 히스토리가 없습니다.</strong>
            <p>작업이 기록되면 이곳에 표시됩니다.</p>
          </div>
        ) : null}
        {!isLoading && !loadError && entries.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>작업자</th>
                  <th>작업</th>
                  <th>대상</th>
                  <th>프로그램</th>
                  <th>세부내용</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(entry.timestamp)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{entry.actor_name ?? '—'}</td>
                    <td>{entry.action ?? '—'}</td>
                    <td>
                      {[entry.entity_type, entry.entity_id].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td>
                      {entry.program_id
                        ? (programNames.get(entry.program_id) ?? entry.program_id)
                        : '—'}
                    </td>
                    <td>
                      <code className="audit-details">{detailsText(entry.details)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </PageShell>
  );
}
