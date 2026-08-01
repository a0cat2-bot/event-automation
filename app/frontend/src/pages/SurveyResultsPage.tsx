import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { listParticipants, recordSurveyResult, type Participant } from '../api/participants';
import { syncSallySurvey } from '../api/sally';
import { PageShell } from '../components/PageShell';
import { ProgramContextBar } from '../components/ProgramContextBar';
import { SallySurveyDraftCard } from '../components/SallySurveyDraftCard';

const SURVEY_STATUS_LABELS: Record<Participant['survey_status'], string> = {
  not_sent: '미발송',
  sent: '발송됨',
  in_progress: '응답 중',
  completed: '완료',
};

export function SurveyResultsPage() {
  const { programId = '' } = useParams();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [surveyTitle, setSurveyTitle] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const [scoreDrafts, setScoreDrafts] = useState<Record<string, string>>({});
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});
  const [savingParticipantId, setSavingParticipantId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const reloadParticipants = useCallback(
    (signal?: AbortSignal) =>
      listParticipants(programId, signal).then(({ participants: next }) => {
        setParticipants(next);
      }),
    [programId],
  );

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    reloadParticipants(controller.signal)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setLoadError(error instanceof Error ? error.message : '정보를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [programId, reloadParticipants]);

  async function handleSync() {
    if (!surveyTitle.trim()) return;
    setIsSyncing(true);
    setSyncError(null);
    setSyncMessage(null);

    try {
      const result = await syncSallySurvey(programId, surveyTitle.trim());
      setSyncMessage(
        `${result.row_count}건을 가져왔습니다. (업로드 ID: ${result.upload_id}, 이 결과는 신규 신청자로 반영되며 별도 확정 절차가 필요합니다.)`,
      );
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Sally 동기화에 실패했습니다.');
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleSaveResult(participantId: string) {
    const scoreValue = Number(scoreDrafts[participantId] ?? '');
    if (!Number.isInteger(scoreValue) || scoreValue < 1 || scoreValue > 5) {
      setRowErrors((current) => ({ ...current, [participantId]: '만족도 점수는 1~5 사이의 정수여야 합니다.' }));
      return;
    }

    setSavingParticipantId(participantId);
    setRowErrors((current) => ({ ...current, [participantId]: '' }));

    try {
      await recordSurveyResult(programId, participantId, {
        satisfaction_score: scoreValue,
        feedback_text: feedbackDrafts[participantId]?.trim() || undefined,
      });
      await reloadParticipants();
    } catch (error) {
      setRowErrors((current) => ({
        ...current,
        [participantId]: error instanceof Error ? error.message : '저장하지 못했습니다.',
      }));
    } finally {
      setSavingParticipantId(null);
    }
  }

  return (
    <PageShell
      title="만족도 설문 결과"
      designSection="만족도 설문 결과"
      description="선정된 참여자의 만족도 설문 결과를 확인하고 입력합니다."
      showStubNote={false}
    >
      <ProgramContextBar programId={programId} />
      <SallySurveyDraftCard programId={programId} kind="satisfaction" />
      <div className="content-card">
        <h2>Sally 설문 동기화</h2>
        <p className="page-description">
          참고: 현재 Sally 연동은 서술형 심사용 신청자를 가져오는 기능이며, 선정 이후 만족도 점수를
          자동으로 기록하지는 않습니다. 실제 만족도 결과는 아래 표에서 직접 입력해주세요.
        </p>
        <label>
          Sally 설문 제목
          <input
            value={surveyTitle}
            onChange={(event) => setSurveyTitle(event.target.value)}
            placeholder="예: 2026 하반기 프로그램 신청"
          />
        </label>
        <div className="standard-save-row" style={{ marginTop: '1rem' }}>
          <button
            className="button button--secondary"
            type="button"
            onClick={handleSync}
            disabled={!surveyTitle.trim() || isSyncing}
          >
            {isSyncing ? '동기화 중…' : 'Sally에서 가져오기'}
          </button>
        </div>
        {syncMessage ? <p className="save-success">{syncMessage}</p> : null}
        {syncError ? (
          <p className="form-error" role="alert">
            {syncError}
          </p>
        ) : null}
      </div>

      {isLoading ? <p className="state-message">불러오는 중입니다…</p> : null}
      {loadError ? (
        <p className="state-message state-message--error" role="alert">
          {loadError}
        </p>
      ) : null}

      {participants.length > 0 ? (
        <div className="content-card">
          <h2>참여자별 만족도 결과 입력</h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>설문 상태</th>
                  <th>만족도 (1~5)</th>
                  <th>피드백</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {participants.map((participant) => (
                  <tr key={participant.id}>
                    <td>{participant.name}</td>
                    <td>{SURVEY_STATUS_LABELS[participant.survey_status]}</td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        max={5}
                        style={{ width: '4rem' }}
                        value={scoreDrafts[participant.id] ?? ''}
                        onChange={(event) =>
                          setScoreDrafts((current) => ({
                            ...current,
                            [participant.id]: event.target.value,
                          }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={feedbackDrafts[participant.id] ?? ''}
                        onChange={(event) =>
                          setFeedbackDrafts((current) => ({
                            ...current,
                            [participant.id]: event.target.value,
                          }))
                        }
                        placeholder="선택 입력"
                      />
                    </td>
                    <td>
                      <button
                        className="button button--secondary"
                        type="button"
                        disabled={savingParticipantId === participant.id}
                        onClick={() => handleSaveResult(participant.id)}
                      >
                        {savingParticipantId === participant.id ? '저장 중…' : '저장'}
                      </button>
                      {rowErrors[participant.id] ? (
                        <p className="form-error" role="alert">
                          {rowErrors[participant.id]}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
