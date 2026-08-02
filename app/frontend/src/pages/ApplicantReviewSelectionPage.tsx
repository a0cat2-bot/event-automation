import { IconArrowRight } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { listApplicants, type Applicant } from '../api/applicants';
import { getProgram, type Program } from '../api/programs';
import { listParticipants, type Participant } from '../api/participants';
import {
  runSelection,
  type JustificationCandidate,
  type SelectedParticipant,
} from '../api/selection';
import { PageShell } from '../components/PageShell';
import { ProgramContextBar } from '../components/ProgramContextBar';
import { ASSESSED_BY_CLASS, ASSESSED_BY_LABEL } from '../utils/assessedBy';
import { formatDateTime } from '../utils/format';

export function ApplicantReviewSelectionPage() {
  const { programId = '' } = useParams();
  const [program, setProgram] = useState<Program | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qualityScoreThreshold, setQualityScoreThreshold] = useState('0');
  const [manualReviewMultiplier, setManualReviewMultiplier] = useState('3');

  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SelectedParticipant[] | null>(null);
  const [candidates, setCandidates] = useState<JustificationCandidate[] | null>(null);
  const [excludedApplicantIds, setExcludedApplicantIds] = useState<Set<string>>(new Set());
  const [includedCandidateIds, setIncludedCandidateIds] = useState<Set<string>>(new Set());

  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmedCount, setConfirmedCount] = useState<number | null>(null);
  const [approvalName, setApprovalName] = useState('');

  const loadParticipants = useCallback(
    (signal?: AbortSignal) =>
      listParticipants(programId, signal).then(({ participants: next }) => {
        setParticipants(next);
      }),
    [programId],
  );

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    Promise.all([
      getProgram(programId, controller.signal).then(({ program: nextProgram }) => {
        if (isCurrent) setProgram(nextProgram);
      }),
      listApplicants(programId, controller.signal).then(({ applicants: next }) => {
        if (isCurrent) setApplicants(next);
      }),
      loadParticipants(controller.signal),
    ])
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
  }, [programId, loadParticipants]);

  const applicantsById = useMemo(
    () => new Map(applicants.map((applicant) => [applicant.id, applicant])),
    [applicants],
  );
  const participantsByApplicantId = useMemo(
    () => new Map(participants.map((participant) => [participant.applicant_id, participant])),
    [participants],
  );
  const candidatesByApplicantId = useMemo(
    () => new Map((candidates ?? []).map((candidate) => [candidate.applicant_id, candidate])),
    [candidates],
  );

  function applicantById(applicantId: string) {
    return applicantsById.get(applicantId);
  }

  // The backend keeps (rather than deletes) a participant row with recorded survey results or
  // gift selections when excluded, so history isn't lost — the section description explains this
  // once; per row we only need to flag WHO it applies to, not repeat the full sentence each time.
  function hasPreservedHistory(applicantId: string): boolean {
    const participant = participantsByApplicantId.get(applicantId);
    if (!participant) return false;
    return participant.survey_status === 'completed' || participant.gift_status !== 'not_selected';
  }

  function candidateReason(applicantId: string) {
    const score = candidatesByApplicantId.get(applicantId)?.quality_score;
    return score !== undefined
      ? `서류 심사로 선정 (품질 점수 ${score.toFixed(1)})`
      : '서류 심사로 선정';
  }

  const isWrittenJustification = program?.selection_mode === 'written_justification';
  const isApprovalMissing = Boolean(program?.requires_approval && !approvalName.trim());

  // Shared by the dry-run preview and the final confirm — the two calls only ever differ in
  // which Set snapshot feeds them and whether dry_run is set.
  function buildOverrideSelections(excludedIds: Set<string>, includedIds: Set<string>) {
    return isWrittenJustification
      ? [...includedIds].map((applicantId) => ({
          applicant_id: applicantId,
          selected: true,
          reason: candidateReason(applicantId),
        }))
      : [...excludedIds].map((applicantId) => ({
          applicant_id: applicantId,
          selected: false,
          reason: '코디네이터가 수동으로 제외함',
        }));
  }

  async function fetchPreview(nextExcludedIds: Set<string>, nextIncludedIds: Set<string>) {
    if (!program) return;
    setIsPreviewing(true);
    setPreviewError(null);

    try {
      const overrideSelections = buildOverrideSelections(nextExcludedIds, nextIncludedIds);

      const result = await runSelection(programId, {
        selection_mode: program.selection_mode,
        quality_score_threshold: Number(qualityScoreThreshold),
        manual_review_count_multiplier: Number(manualReviewMultiplier),
        override_selections: overrideSelections,
        dry_run: true,
      });
      setPreview(result.selected_participants);
      if (isWrittenJustification) setCandidates(result.candidates ?? []);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : '예정자를 불러오지 못했습니다.');
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handlePreview() {
    setConfirmedCount(null);
    setExcludedApplicantIds(new Set());
    setIncludedCandidateIds(new Set());
    await fetchPreview(new Set(), new Set());
  }

  async function handleExclude(applicantId: string) {
    const next = new Set(excludedApplicantIds);
    next.add(applicantId);
    setExcludedApplicantIds(next);
    await fetchPreview(next, includedCandidateIds);
  }

  async function handleRestore(applicantId: string) {
    const next = new Set(excludedApplicantIds);
    next.delete(applicantId);
    setExcludedApplicantIds(next);
    await fetchPreview(next, includedCandidateIds);
  }

  function handleToggleCandidate(applicantId: string, include: boolean) {
    // The candidate pool is fetched once and kept stable on screen; toggling a checkbox is a
    // purely local pick from that pool; re-running the dry-run here would make the backend drop
    // already-picked candidates from `candidates` (since it excludes forced-includes from the
    // eligible pool), shrinking the list out from under the reviewer.
    const next = new Set(includedCandidateIds);
    if (include) next.add(applicantId);
    else next.delete(applicantId);
    setIncludedCandidateIds(next);
  }

  async function handleConfirm() {
    if (!program || !preview) return;
    setIsConfirming(true);
    setConfirmError(null);

    try {
      const overrideSelections = buildOverrideSelections(
        excludedApplicantIds,
        includedCandidateIds,
      );

      const result = await runSelection(programId, {
        selection_mode: program.selection_mode,
        quality_score_threshold: Number(qualityScoreThreshold),
        manual_review_count_multiplier: Number(manualReviewMultiplier),
        override_selections: overrideSelections,
        dry_run: false,
        ...(program.requires_approval ? { approved_by: approvalName.trim() } : {}),
      });
      setConfirmedCount(result.total_selected);
      setPreview(null);
      setCandidates(null);
      setExcludedApplicantIds(new Set());
      setIncludedCandidateIds(new Set());
      setApprovalName('');
      await loadParticipants();
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : '선정을 확정하지 못했습니다.');
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <PageShell
      title="참여자 선정"
      designSection="참여자 선정"
      description={
        isWrittenJustification
          ? '서류 심사 후보 목록에서 선정할 사람을 직접 체크하세요. 자기소개/지원사유 원문과 품질 점수를 함께 확인할 수 있습니다. 확정 전까지는 아무것도 저장되지 않습니다.'
          : '먼저 예정자 목록을 미리보고, 제외할 사람이 있으면 제외하세요. 정원만큼 다음 순위 신청자가 자동으로 채워집니다. 확정 전까지는 아무것도 저장되지 않습니다.'
      }
      showStubNote={false}
    >
      <ProgramContextBar programId={programId} />
      {isLoading ? <p className="state-message">불러오는 중입니다…</p> : null}
      {loadError ? (
        <p className="state-message state-message--error" role="alert">
          {loadError}
        </p>
      ) : null}

      {program ? (
        <div className="content-card">
          <p>
            선정 방식: <strong>{program.selection_mode}</strong> · 최대 참여 인원:{' '}
            <strong>{program.max_participants}명</strong> · 신청자{' '}
            <strong>{program.applicant_count}명</strong>
          </p>

          {program.selection_mode === 'score' ? (
            <label>
              점수 기준값 (참고용)
              <input
                type="number"
                value={qualityScoreThreshold}
                onChange={(event) => setQualityScoreThreshold(event.target.value)}
              />
            </label>
          ) : null}
          {isWrittenJustification ? (
            <label>
              서류 심사 배수 (max_participants × N명 후보 검토)
              <input
                type="number"
                min={1}
                value={manualReviewMultiplier}
                onChange={(event) => setManualReviewMultiplier(event.target.value)}
              />
            </label>
          ) : null}

          {previewError ? (
            <p className="form-error" role="alert">
              {previewError}
            </p>
          ) : null}

          <div className="standard-save-row" style={{ marginTop: '1rem' }}>
            <button
              className="button button--primary"
              type="button"
              onClick={handlePreview}
              disabled={isPreviewing || program.applicant_count === 0}
            >
              {isPreviewing && !preview
                ? '예정자 계산 중…'
                : isWrittenJustification
                  ? '심사 후보 불러오기'
                  : '선정 예정자 미리보기'}
            </button>
          </div>

          {confirmedCount !== null ? (
            <p className="save-success">
              <strong>{confirmedCount}명</strong>으로 확정되었습니다.
            </p>
          ) : null}
        </div>
      ) : null}

      {isWrittenJustification && candidates ? (
        <div className="content-card">
          <div className="section-heading">
            <div>
              <h2>
                서류 심사 후보 ({candidates.length}명 중 {includedCandidateIds.size}명 선정)
              </h2>
              <p>
                품질 점수가 높은 순으로 정렬되어 있습니다. 자기소개/지원사유 원문을 확인하고 선정할
                사람을 체크하세요.
              </p>
            </div>
          </div>

          {candidates.length === 0 ? (
            <div className="empty-state">
              <strong>심사할 후보가 없습니다.</strong>
              <p>신청자가 없거나 이미 모두 제외/선정되었습니다.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>선정</th>
                    <th>이름</th>
                    <th>이메일</th>
                    <th>부서</th>
                    <th>신청일시</th>
                    <th>품질 점수</th>
                    <th>평가 근거</th>
                    <th>자기소개 / 지원사유</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => {
                    const applicant = applicantById(candidate.applicant_id);
                    const isIncluded = includedCandidateIds.has(candidate.applicant_id);
                    return (
                      <tr key={candidate.applicant_id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={isIncluded}
                            disabled={isPreviewing}
                            onChange={(event) =>
                              handleToggleCandidate(candidate.applicant_id, event.target.checked)
                            }
                          />
                        </td>
                        <td>{candidate.name ?? applicant?.name}</td>
                        <td>{candidate.email ?? applicant?.email}</td>
                        <td>{applicant?.department}</td>
                        <td>{formatDateTime(candidate.applied_at)}</td>
                        <td>
                          <div className="score-cell">
                            <span>{candidate.quality_score.toFixed(1)}</span>
                            <span
                              className={`status-badge ${ASSESSED_BY_CLASS[candidate.assessed_by]}`}
                            >
                              {ASSESSED_BY_LABEL[candidate.assessed_by]}
                            </span>
                          </div>
                        </td>
                        <td style={{ minWidth: '200px' }}>
                          {candidate.rationale || candidate.matched_keywords.join(', ') || '—'}
                        </td>
                        <td style={{ whiteSpace: 'pre-wrap', minWidth: '280px' }}>
                          {candidate.justification || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {confirmError ? (
            <p className="form-error" role="alert">
              {confirmError}
            </p>
          ) : null}

          {candidates ? (
            <>
              {program?.requires_approval ? (
                <label className="approval-name-field">
                  승인자 이름
                  <input
                    required
                    value={approvalName}
                    onChange={(event) => {
                      setApprovalName(event.target.value);
                      setConfirmError(null);
                    }}
                    placeholder="승인자로 기록할 이름을 입력하세요"
                  />
                  <small className="field-hint">
                    별도 로그인이나 권한 확인 없이 이름만 기록되는 참고용 승인입니다.
                  </small>
                </label>
              ) : null}
              <div className="standard-save-row" style={{ marginTop: '1rem' }}>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={handleConfirm}
                  disabled={isConfirming || includedCandidateIds.size === 0 || isApprovalMissing}
                >
                  {isConfirming ? '확정 중…' : `${includedCandidateIds.size}명으로 최종 확정`}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {!isWrittenJustification && preview ? (
        <div className="content-card">
          <div className="section-heading">
            <div>
              <h2>선정 예정자 ({preview.length}명 확정 예정)</h2>
              <p>
                받으면 안 되는 사람은 제외하세요. 정원만큼 다음 순위 신청자가 자동으로 채워집니다.
                아직 저장되지 않았습니다. 「이력 보존」 표시가 있는 사람은 설문 응답이나 상품 수령
                기록이 있어, 제외해도 그 기록은 남습니다.
              </p>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>순위</th>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>부서</th>
                  <th>신청일시</th>
                  <th>선정 사유</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {preview.map((candidate) => {
                  const applicant = applicantById(candidate.applicant_id);
                  return (
                    <tr key={candidate.applicant_id}>
                      <td>{candidate.selection_rank}</td>
                      <td>{applicant?.name}</td>
                      <td>{applicant?.email}</td>
                      <td>{applicant?.department}</td>
                      <td>{applicant ? formatDateTime(applicant.applied_at) : null}</td>
                      <td>{candidate.selection_reason}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <button
                            className="button button--quiet"
                            type="button"
                            disabled={isPreviewing}
                            onClick={() => handleExclude(candidate.applicant_id)}
                          >
                            제외
                          </button>
                          {hasPreservedHistory(candidate.applicant_id) ? (
                            <span className="progress-step progress-step--partial">이력 보존</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {excludedApplicantIds.size > 0 ? (
            <div style={{ marginTop: '1.25rem' }}>
              <h2 style={{ fontSize: '1rem' }}>제외한 신청자 ({excludedApplicantIds.size}명)</h2>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>이메일</th>
                      <th>부서</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...excludedApplicantIds].map((applicantId) => {
                      const applicant = applicantById(applicantId);
                      return (
                        <tr key={applicantId}>
                          <td>{applicant?.name}</td>
                          <td>{applicant?.email}</td>
                          <td>{applicant?.department}</td>
                          <td>
                            <button
                              className="button button--quiet"
                              type="button"
                              disabled={isPreviewing}
                              onClick={() => handleRestore(applicantId)}
                            >
                              복귀
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {confirmError ? (
            <p className="form-error" role="alert">
              {confirmError}
            </p>
          ) : null}

          {program?.requires_approval ? (
            <label className="approval-name-field">
              승인자 이름
              <input
                required
                value={approvalName}
                onChange={(event) => {
                  setApprovalName(event.target.value);
                  setConfirmError(null);
                }}
                placeholder="승인자로 기록할 이름을 입력하세요"
              />
              <small className="field-hint">
                별도 로그인이나 권한 확인 없이 이름만 기록되는 참고용 승인입니다.
              </small>
            </label>
          ) : null}

          <div className="standard-save-row" style={{ marginTop: '1rem' }}>
            <button
              className="button button--primary"
              type="button"
              onClick={handleConfirm}
              disabled={isConfirming || isPreviewing || isApprovalMissing}
            >
              {isConfirming ? '확정 중…' : `${preview.length}명으로 최종 확정`}
            </button>
          </div>
        </div>
      ) : null}

      {participants.length > 0 ? (
        <div className="content-card">
          <h2>현재 확정된 참여자 ({participants.length}명)</h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>순위</th>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>부서</th>
                  <th>선정 사유</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((participant) => (
                  <tr key={participant.id}>
                    <td>{participant.selection_rank}</td>
                    <td>{participant.name}</td>
                    <td>{participant.email}</td>
                    <td>{participant.department}</td>
                    <td>{participant.selection_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <Link className="inline-link-with-icon" to={`/programs/${programId}/notifications`}>
              다음: 안내메일 발송
              <IconArrowRight size={14} stroke={2} aria-hidden="true" />
            </Link>
          </p>
        </div>
      ) : null}
    </PageShell>
  );
}
