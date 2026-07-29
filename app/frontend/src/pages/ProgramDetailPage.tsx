import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { deleteProgram, getProgram, type Program } from '../api/programs';
import { PageShell } from '../components/PageShell';
import { programDateDisplay } from '../utils/program';

const SELECTION_MODE_LABELS: Record<Program['selection_mode'], string> = {
  first_come_first_served: '선착순',
  score: '점수 기반',
  written_justification: '서술형 심사',
};

const STATUS_LABELS: Record<Program['status'], string> = {
  planning: '기획 중',
  recruitment_active: '모집 중',
  selection_in_progress: '선정 중',
  completed: '종료',
};

function intakeField(intakeData: Program['intake_data'], key: string): string | null {
  const value = intakeData?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function ProgramDetailPage() {
  const { programId = '' } = useParams();
  const navigate = useNavigate();
  const base = `/programs/${programId}`;
  const [program, setProgram] = useState<Program | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!program) return;
    const confirmed = window.confirm(
      `"${program.name}" 프로그램을 삭제할까요? 목록에서 사라지며 되돌리려면 관리자에게 문의해야 합니다.`,
    );
    if (!confirmed) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteProgram(programId);
      navigate('/');
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '프로그램을 삭제하지 못했습니다.');
      setIsDeleting(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    getProgram(programId, controller.signal)
      .then(({ program: nextProgram }) => {
        if (!isCurrent) return;
        setProgram(nextProgram);
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
  }, [programId]);

  const programDate = program ? programDateDisplay(program.intake_data) : null;
  const programTime = program ? intakeField(program.intake_data, 'program_time') : null;
  const programLocation = program ? intakeField(program.intake_data, 'program_location') : null;
  const description = program ? intakeField(program.intake_data, 'description') : null;

  return (
    <PageShell
      title={program?.name ?? '프로그램 상세'}
      description={
        program
          ? `${program.business_unit} · ${SELECTION_MODE_LABELS[program.selection_mode]} · ${STATUS_LABELS[program.status]}`
          : '프로그램 정보를 불러오는 중입니다.'
      }
      showStubNote={false}
    >
      {isLoading ? <p className="state-message">불러오는 중입니다…</p> : null}
      {loadError ? (
        <p className="state-message state-message--error" role="alert">
          {loadError}
        </p>
      ) : null}

      {program ? (
        <>
          <div className="standard-save-row" style={{ marginBottom: '1.5rem' }}>
            <Link className="button button--secondary" to={`${base}/edit`}>
              프로그램 정보 수정
            </Link>
            <Link
              className="button button--secondary"
              to={`/programs/new?cloneFrom=${programId}`}
            >
              프로그램 복제
            </Link>
            <button
              className="button button--danger"
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              style={{ width: 'auto' }}
            >
              {isDeleting ? '삭제 중…' : '프로그램 삭제'}
            </button>
          </div>
          {deleteError ? (
            <p className="form-error" role="alert">
              {deleteError}
            </p>
          ) : null}

          <div className="placeholder-grid">
            <article>
              <h2>최대 참여 인원</h2>
              <p>{program.max_participants}명</p>
            </article>
            <article>
              <h2>신청자 / 참여자</h2>
              <p>
                {program.applicant_count}명 / {program.participant_count}명
              </p>
            </article>
            <article>
              <h2>일시</h2>
              <p>
                {[programDate, programTime].filter(Boolean).join(' ') || '미입력'}
              </p>
            </article>
            <article>
              <h2>장소</h2>
              <p>{programLocation ?? '미입력'}</p>
            </article>
          </div>

          {description ? (
            <div className="content-card">
              <h2>프로그램 설명</h2>
              <p>{description}</p>
            </div>
          ) : null}
        </>
      ) : null}

      <nav className="workflow-links" aria-label="프로그램 진행 단계">
        <Link to={`${base}/letters`}>레터 미리보기/발송 준비</Link>
        <Link to={`${base}/applicants/upload`}>신청자 업로드</Link>
        <Link to={`${base}/selection`}>참여자 선정</Link>
        <Link to={`${base}/notifications`}>안내메일 발송</Link>
        <Link to={`${base}/surveys`}>만족도 설문 결과</Link>
        <Link to={`${base}/gifts`}>상품 수령자 선정</Link>
        <Link to={`${base}/reports`}>결과 보고서</Link>
      </nav>
    </PageShell>
  );
}
