import {
  ChangeEvent,
  FormEvent,
  Fragment,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useParams } from 'react-router-dom';

import {
  confirmApplicantUpload,
  createApplicant,
  listApplicants,
  previewApplicantUpload,
  updateApplicant,
  uploadApplicantCsv,
  type Applicant,
  type ApplicantInput,
  type ConfirmResponse,
  type PreviewResponse,
} from '../api/applicants';
import { getProgram, type Program, type SelectionMode } from '../api/programs';
import { PageShell } from '../components/PageShell';
import { ProgramContextBar } from '../components/ProgramContextBar';
import { formatDateTime } from '../utils/format';

const STATUS_LABELS: Record<PreviewResponse['rows'][number]['status'], string> = {
  valid: '정상',
  error: '오류',
  warning: '경고',
  duplicate: '중복',
};

type ApplicantFormState = {
  external_id: string;
  name: string;
  email: string;
  department: string;
  applied_at: string;
  score: string;
  justification: string;
};

function localDateTimeValue(value: Date): string {
  const localTime = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

function emptyApplicantForm(): ApplicantFormState {
  return {
    external_id: '',
    name: '',
    email: '',
    department: '',
    applied_at: localDateTimeValue(new Date()),
    score: '',
    justification: '',
  };
}

function applicantForm(applicant: Applicant): ApplicantFormState {
  return {
    external_id: applicant.external_id ?? '',
    name: applicant.name ?? '',
    email: applicant.email ?? '',
    department: applicant.department ?? '',
    applied_at: localDateTimeValue(new Date(applicant.applied_at)),
    score: applicant.score == null ? '' : String(applicant.score),
    justification: applicant.justification ?? '',
  };
}

function applicantInput(
  values: ApplicantFormState,
  selectionMode: SelectionMode,
): ApplicantInput {
  return {
    external_id: values.external_id.trim(),
    name: values.name.trim(),
    email: values.email.trim(),
    department: values.department.trim(),
    applied_at: new Date(values.applied_at).toISOString(),
    ...(selectionMode === 'score' ? { score: Number(values.score) } : {}),
    ...(selectionMode === 'written_justification'
      ? { justification: values.justification.trim() }
      : {}),
  };
}

function ApplicantFields({
  values,
  selectionMode,
  onChange,
}: {
  values: ApplicantFormState;
  selectionMode: SelectionMode;
  onChange: (field: keyof ApplicantFormState, value: string) => void;
}) {
  return (
    <>
      <label>
        사번
        <input
          required
          maxLength={50}
          value={values.external_id}
          onChange={(event) => onChange('external_id', event.target.value)}
        />
      </label>
      <label>
        이름
        <input
          required
          maxLength={255}
          value={values.name}
          onChange={(event) => onChange('name', event.target.value)}
        />
      </label>
      <label>
        이메일
        <input
          required
          type="email"
          maxLength={255}
          value={values.email}
          onChange={(event) => onChange('email', event.target.value)}
        />
      </label>
      <label>
        부서
        <input
          required
          maxLength={100}
          value={values.department}
          onChange={(event) => onChange('department', event.target.value)}
        />
      </label>
      <label>
        신청 시각
        <input
          required
          type="datetime-local"
          value={values.applied_at}
          onChange={(event) => onChange('applied_at', event.target.value)}
        />
      </label>
      {selectionMode === 'score' ? (
        <label>
          점수
          <input
            required
            type="number"
            step={1}
            value={values.score}
            onChange={(event) => onChange('score', event.target.value)}
          />
        </label>
      ) : null}
      {selectionMode === 'written_justification' ? (
        <label>
          신청 사유
          <textarea
            required
            value={values.justification}
            onChange={(event) => onChange('justification', event.target.value)}
          />
        </label>
      ) : null}
    </>
  );
}

export function ApplicantUploadPage() {
  const { programId = '' } = useParams();
  const [program, setProgram] = useState<Program | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [isApplicantLoading, setIsApplicantLoading] = useState(true);
  const [applicantLoadError, setApplicantLoadError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [conflictResolution, setConflictResolution] = useState<
    'skip_duplicates' | 'overwrite'
  >('skip_duplicates');
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmResponse | null>(null);

  const [createValues, setCreateValues] = useState<ApplicantFormState>(emptyApplicantForm);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const [editingApplicantId, setEditingApplicantId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<ApplicantFormState>(emptyApplicantForm);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const reloadApplicants = useCallback(
    async (signal?: AbortSignal) => {
      const { applicants: nextApplicants } = await listApplicants(programId, signal);
      setApplicants(nextApplicants);
    },
    [programId],
  );

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    Promise.all([getProgram(programId, controller.signal), listApplicants(programId, controller.signal)])
      .then(([{ program: nextProgram }, { applicants: nextApplicants }]) => {
        if (!isCurrent) return;
        setProgram(nextProgram);
        setApplicants(nextApplicants);
        setApplicantLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setApplicantLoadError(
          error instanceof Error ? error.message : '신청자 정보를 불러오지 못했습니다.',
        );
      })
      .finally(() => {
        if (isCurrent) setIsApplicantLoading(false);
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [programId]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setUploadError(null);
  }

  async function handleUpload() {
    if (!file) return;
    setIsUploading(true);
    setUploadError(null);
    setPreview(null);
    setConfirmResult(null);

    try {
      const { upload_id: uploadId } = await uploadApplicantCsv(programId, file);
      const nextPreview = await previewApplicantUpload(programId, uploadId);
      setPreview(nextPreview);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'CSV 업로드에 실패했습니다.');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleConfirm(action: 'import' | 'discard') {
    if (!preview) return;
    setIsConfirming(true);
    setConfirmError(null);

    try {
      const result = await confirmApplicantUpload(programId, preview.upload_id, {
        action,
        conflict_resolution: conflictResolution,
      });
      setConfirmResult(action === 'import' ? result : null);
      setPreview(null);
      setFile(null);
      if (action === 'import') await reloadApplicants();
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : '처리하지 못했습니다.');
    } finally {
      setIsConfirming(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!program) return;
    setIsCreating(true);
    setCreateError(null);
    setCreateMessage(null);

    try {
      await createApplicant(
        programId,
        applicantInput(createValues, program.selection_mode),
      );
      setCreateValues(emptyApplicantForm());
      setCreateMessage('신청자를 추가했습니다.');
      await reloadApplicants();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '신청자를 추가하지 못했습니다.');
    } finally {
      setIsCreating(false);
    }
  }

  function startEditing(applicant: Applicant) {
    setEditingApplicantId(applicant.id);
    setEditValues(applicantForm(applicant));
    setUpdateError(null);
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!program || !editingApplicantId) return;
    setIsUpdating(true);
    setUpdateError(null);

    try {
      await updateApplicant(
        programId,
        editingApplicantId,
        applicantInput(editValues, program.selection_mode),
      );
      setEditingApplicantId(null);
      await reloadApplicants();
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : '신청자 정보를 수정하지 못했습니다.');
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <PageShell
      title="신청자 업로드"
      designSection="신청자 업로드"
      description="CSV 파일로 여러 신청자를 가져오거나 신청자를 직접 추가하고 수정합니다."
      showStubNote={false}
    >
      <ProgramContextBar programId={programId} />
      <div className="content-card">
        <h2>CSV 파일 선택</h2>
        <p className="field-hint">
          필수 열: external_id, name, email, department. 선정 방식에 따라 score 또는
          justification 열이 추가로 필요합니다.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={handleFileChange} />
        <div className="standard-save-row" style={{ marginTop: '1rem' }}>
          <button
            className="button button--primary"
            type="button"
            onClick={handleUpload}
            disabled={!file || isUploading}
          >
            {isUploading ? '업로드 중…' : '업로드'}
          </button>
        </div>
        {uploadError ? (
          <p className="form-error" role="alert">
            {uploadError}
          </p>
        ) : null}
      </div>

      {confirmResult ? (
        <div className="content-card">
          <h2>가져오기 결과</h2>
          <p>
            가져옴 {confirmResult.imported_count}건 · 건너뜀 {confirmResult.skipped_count}건 · 실패{' '}
            {confirmResult.failed_count}건
          </p>
        </div>
      ) : null}

      {preview ? (
        <div className="content-card">
          <div className="section-heading">
            <div>
              <h2>미리보기 ({preview.row_count}행)</h2>
              <p>
                오류 {preview.validation_summary.errors}건 · 경고{' '}
                {preview.validation_summary.warnings}건 · 중복{' '}
                {preview.validation_summary.duplicates_count}건
              </p>
            </div>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>사번</th>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>부서</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row_number}>
                    <td>{row.row_number}</td>
                    <td>{row.external_id}</td>
                    <td>{row.name}</td>
                    <td>{row.email}</td>
                    <td>{row.department}</td>
                    <td>{STATUS_LABELS[row.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label>
            중복 처리 방식
            <select
              value={conflictResolution}
              onChange={(event) =>
                setConflictResolution(event.target.value as 'skip_duplicates' | 'overwrite')
              }
            >
              <option value="skip_duplicates">중복 건너뛰기</option>
              <option value="overwrite">기존 값 덮어쓰기</option>
            </select>
          </label>

          {confirmError ? (
            <p className="form-error" role="alert">
              {confirmError}
            </p>
          ) : null}

          <div className="standard-save-row" style={{ marginTop: '1rem' }}>
            <button
              className="button button--primary"
              type="button"
              onClick={() => handleConfirm('import')}
              disabled={isConfirming}
            >
              {isConfirming ? '처리 중…' : '가져오기'}
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => handleConfirm('discard')}
              disabled={isConfirming}
            >
              취소(버리기)
            </button>
          </div>
        </div>
      ) : null}

      <section className="content-card" aria-labelledby="applicant-list-title">
        <div className="section-heading">
          <div>
            <h2 id="applicant-list-title">신청자 목록</h2>
            <p>등록된 신청자를 확인하고 잘못된 정보를 바로 수정합니다.</p>
          </div>
          {!isApplicantLoading && !applicantLoadError ? (
            <span className="count-badge">{applicants.length}명</span>
          ) : null}
        </div>

        {isApplicantLoading ? <p className="state-message">신청자를 불러오는 중입니다…</p> : null}
        {applicantLoadError ? (
          <p className="state-message state-message--error" role="alert">
            {applicantLoadError}
          </p>
        ) : null}
        {!isApplicantLoading && !applicantLoadError && applicants.length === 0 ? (
          <div className="empty-state">
            <strong>등록된 신청자가 없습니다.</strong>
            <p>아래 양식에서 첫 신청자를 직접 추가할 수 있습니다.</p>
          </div>
        ) : null}
        {!isApplicantLoading && !applicantLoadError && applicants.length > 0 && program ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>사번</th>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>부서</th>
                  <th>신청 시각</th>
                  {program.selection_mode === 'score' ? <th>점수</th> : null}
                  {program.selection_mode === 'written_justification' ? <th>신청 사유</th> : null}
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {applicants.map((applicant) => (
                  <Fragment key={applicant.id}>
                    <tr>
                      <td>{applicant.external_id ?? '—'}</td>
                      <td>{applicant.name ?? '—'}</td>
                      <td>{applicant.email ?? '—'}</td>
                      <td>{applicant.department ?? '—'}</td>
                      <td>{formatDateTime(applicant.applied_at)}</td>
                      {program.selection_mode === 'score' ? (
                        <td>{applicant.score ?? '—'}</td>
                      ) : null}
                      {program.selection_mode === 'written_justification' ? (
                        <td>{applicant.justification ?? '—'}</td>
                      ) : null}
                      <td>
                        <button
                          className="button button--secondary"
                          type="button"
                          onClick={() => startEditing(applicant)}
                        >
                          수정
                        </button>
                      </td>
                    </tr>
                    {editingApplicantId === applicant.id ? (
                      <tr>
                        <td
                          colSpan={
                            program.selection_mode === 'first_come_first_served' ? 6 : 7
                          }
                        >
                          <form className="stack-form" onSubmit={handleUpdate}>
                            <ApplicantFields
                              values={editValues}
                              selectionMode={program.selection_mode}
                              onChange={(field, value) =>
                                setEditValues((current) => ({ ...current, [field]: value }))
                              }
                            />
                            {updateError ? (
                              <p className="form-error" role="alert">
                                {updateError}
                              </p>
                            ) : null}
                            <div className="standard-save-row">
                              <button
                                className="button button--primary"
                                type="submit"
                                disabled={isUpdating}
                              >
                                {isUpdating ? '저장 중…' : '저장'}
                              </button>
                              <button
                                className="button button--secondary"
                                type="button"
                                disabled={isUpdating}
                                onClick={() => setEditingApplicantId(null)}
                              >
                                취소
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {program ? (
        <section className="content-card" aria-labelledby="create-applicant-title">
          <div className="section-heading">
            <div>
              <h2 id="create-applicant-title">신청자 직접 추가</h2>
              <p>CSV를 다시 만들지 않고 늦게 접수된 신청자를 한 명 추가합니다.</p>
            </div>
          </div>
          <form className="stack-form" onSubmit={handleCreate}>
            <ApplicantFields
              values={createValues}
              selectionMode={program.selection_mode}
              onChange={(field, value) => {
                setCreateValues((current) => ({ ...current, [field]: value }));
                setCreateMessage(null);
                setCreateError(null);
              }}
            />
            {createError ? (
              <p className="form-error" role="alert">
                {createError}
              </p>
            ) : null}
            {createMessage ? (
              <strong className="save-success" aria-live="polite">
                {createMessage}
              </strong>
            ) : null}
            <button className="button button--primary" type="submit" disabled={isCreating}>
              {isCreating ? '추가 중…' : '신청자 추가'}
            </button>
          </form>
        </section>
      ) : null}
    </PageShell>
  );
}
