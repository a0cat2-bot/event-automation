import { useEffect, useState, type FormEvent } from 'react';

import { getProgram, type Program } from '../api/programs';
import {
  connectSallySession,
  createSallySurvey,
  distributeSallySurvey,
  disconnectSallySession,
  getSallySessionStatus,
  getSallySurveyDescriptionImage,
  getSallySurveyDraft,
  type SallySessionStatus,
  type SallySurveyDraft,
  type SallySurveyKind,
} from '../api/sally';

const QUESTION_TYPE_LABELS: Record<SallySurveyDraft['questions'][number]['type'], string> = {
  short_answer: '단답형',
  single_choice: '객관식',
  rating_scale: '1~5 척도',
};

function copyText(draft: SallySurveyDraft): string {
  const questions = draft.questions.map((question, index) => {
    const choices = question.choices?.length ? `\n보기: ${question.choices.join(' / ')}` : '';
    return `${index + 1}. [${QUESTION_TYPE_LABELS[question.type]}] ${question.text}${choices}`;
  });
  const completionMessage = draft.completion_message
    ? `제출 완료 메시지\n${draft.completion_message}`
    : undefined;
  return [draft.title, draft.description, completionMessage, ...questions]
    .filter(Boolean)
    .join('\n\n');
}

export function SallySurveyDraftCard({
  programId,
  kind,
}: {
  programId: string;
  kind: SallySurveyKind;
}) {
  const [draft, setDraft] = useState<SallySurveyDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [descriptionImageUrl, setDescriptionImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SallySessionStatus | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [program, setProgram] = useState<Program | null>(null);
  const [isDistributing, setIsDistributing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let nextImageUrl: string | null = null;
    setDraft(null);
    setLoadError(null);
    setDescriptionImageUrl(null);
    setImageError(null);
    setSessionStatus(null);
    setSessionError(null);
    getSallySurveyDraft(programId, kind, controller.signal)
      .then(({ draft: nextDraft }) => setDraft(nextDraft))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(error instanceof Error ? error.message : '설문 초안을 불러오지 못했습니다.');
      });
    if (kind === 'recruitment') {
      setProgram(null);
      getProgram(programId, controller.signal)
        .then(({ program: nextProgram }) => setProgram(nextProgram))
        .catch(() => undefined);
    }
    getSallySessionStatus(controller.signal)
      .then(setSessionStatus)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSessionError(
          error instanceof Error ? error.message : 'Sally 연결 상태를 불러오지 못했습니다.',
        );
      });
    getSallySurveyDescriptionImage(programId, controller.signal)
      .then((image) => {
        nextImageUrl = URL.createObjectURL(image);
        setDescriptionImageUrl(nextImageUrl);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setImageError(
          error instanceof Error ? error.message : '설명 이미지를 불러오지 못했습니다.',
        );
      });
    return () => {
      controller.abort();
      if (nextImageUrl) URL.revokeObjectURL(nextImageUrl);
    };
  }, [kind, programId]);

  async function handleCopy() {
    if (!draft) return;
    setActionError(null);
    try {
      await navigator.clipboard.writeText(copyText(draft));
      setActionMessage('설문 초안을 클립보드에 복사했습니다.');
    } catch {
      setActionError('클립보드에 복사하지 못했습니다. 브라우저 권한을 확인해주세요.');
    }
  }

  async function handleCreate() {
    setIsCreating(true);
    setActionMessage(null);
    setActionError(null);
    try {
      const result = await createSallySurvey(programId, kind);
      setDraft(result.draft);
      if (result.created) {
        setActionMessage(
          result.editor_url
            ? `Sally에 초안을 만들었습니다. 내용을 확인하고 배포하면 모집 링크가 생깁니다: ${result.editor_url}`
            : 'Sally에 초안을 만들었습니다. 내용을 확인하고 배포해주세요.',
        );
        if (kind === 'recruitment') {
          getProgram(programId)
            .then(({ program: nextProgram }) => setProgram(nextProgram))
            .catch(() => undefined);
        }
      } else {
        setActionError(
          `Sally 자동 생성을 사용할 수 없습니다. 아래 초안을 복사해 직접 생성해주세요. ${result.reason ?? ''}`.trim(),
        );
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Sally에 설문을 생성하지 못했습니다.',
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const sallyId = String(formData.get('sally_id') ?? '').trim();
    let password = String(formData.get('password') ?? '');
    formData.delete('password');
    form.reset();

    setIsConnecting(true);
    setSessionError(null);
    try {
      const status = await connectSallySession(sallyId, password);
      setSessionStatus(status);
      setActionMessage('Sally 계정을 연결했습니다. 비밀번호는 저장하지 않았습니다.');
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Sally 계정을 연결하지 못했습니다.');
    } finally {
      password = '';
      setIsConnecting(false);
    }
  }


  async function handleDistribute() {
    // Sally locks a distributed survey against editing, so the coordinator has to know that before
    // it happens rather than discover it afterwards.
    if (
      !window.confirm(
        '배포하면 설문을 더 이상 수정할 수 없습니다.\n모집 링크를 만들고 레터에 연결할까요?',
      )
    ) {
      return;
    }
    setIsDistributing(true);
    setActionMessage(null);
    setActionError(null);
    try {
      const result = await distributeSallySurvey(programId);
      if (result.distributed && result.survey_url) {
        setActionMessage(`배포했습니다. 모집 링크: ${result.survey_url}`);
        const { program: nextProgram } = await getProgram(programId);
        setProgram(nextProgram);
      } else {
        setActionError(
          `Sally 자동 배포를 사용할 수 없습니다. Sally에서 직접 배포해주세요. ${result.reason ?? ''}`.trim(),
        );
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '설문을 배포하지 못했습니다.');
    } finally {
      setIsDistributing(false);
    }
  }

  async function handleDisconnect() {
    setIsDisconnecting(true);
    setSessionError(null);
    try {
      await disconnectSallySession();
      setSessionStatus({ connected: false, stored_at: null, last_used_at: null });
      setActionMessage('Sally 계정 연결을 해제했습니다.');
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Sally 연결을 해제하지 못했습니다.');
    } finally {
      setIsDisconnecting(false);
    }
  }

  const heading = kind === 'recruitment' ? '참여자 모집 설문 초안' : '만족도 조사 설문 초안';

  return (
    <section className="content-card" aria-label={heading}>
      <div className="section-heading">
        <div>
          <h2>{heading}</h2>
          <p className="field-hint">
            프로그램 정보로 생성한 초안과 설명 이미지입니다. Sally 자동 생성이 안 되면 그대로
            사용하세요.
          </p>
        </div>
      </div>

      <div className="template-card" aria-label="Sally 계정 연결">
        <span
          className={
            sessionStatus?.connected
              ? 'status-badge status-badge--success'
              : 'status-badge status-badge--warning'
          }
        >
          {sessionStatus?.connected ? 'Sally 연결됨' : 'Sally 연결 안 됨'}
        </span>
        {sessionStatus?.connected ? (
          <>
            <p className="field-hint">현재 로그인한 코디네이터의 암호화된 세션을 사용합니다.</p>
            <button
              className="button button--quiet"
              type="button"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? '연결 해제 중…' : '연결 해제'}
            </button>
          </>
        ) : (
          <form className="sally-session-form" onSubmit={handleConnect}>
            <p className="field-hint field-hint--warning">
              연결하면 현재 본인 브라우저에서 이용 중인 Sally에서 로그아웃됩니다.
            </p>
            <label>
              Sally 아이디
              <input name="sally_id" autoComplete="username" required disabled={isConnecting} />
            </label>
            <label>
              Sally 비밀번호
              <input
                name="password"
                type="password"
                autoComplete="off"
                required
                disabled={isConnecting}
              />
            </label>
            <button className="button button--secondary" type="submit" disabled={isConnecting}>
              {isConnecting ? '연결 중…' : 'Sally 연결'}
            </button>
            <small className="field-hint">비밀번호는 로그인에만 사용하고 저장하지 않습니다.</small>
          </form>
        )}
      </div>
      {sessionError ? (
        <p className="form-error" role="alert">
          {sessionError}
        </p>
      ) : null}

      {!draft && !loadError ? <p className="field-hint">설문 초안을 불러오는 중입니다…</p> : null}
      {loadError ? (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      ) : null}
      {draft ? (
        <>
          {descriptionImageUrl ? (
            <div className="sally-description-image">
              <img src={descriptionImageUrl} alt={`${draft.title} 설명 이미지`} />
              <a
                className="button button--secondary"
                href={descriptionImageUrl}
                download={`DESCRIPTION_${programId}.png`}
              >
                설명 이미지 다운로드
              </a>
            </div>
          ) : null}
          {imageError ? (
            <p className="form-error" role="alert">
              {imageError}
            </p>
          ) : null}
          <h3>{draft.title}</h3>
          {draft.description ? (
            <p className="field-hint" style={{ whiteSpace: 'pre-line' }}>
              {draft.description}
            </p>
          ) : null}
          {draft.completion_message ? (
            <div>
              <strong>제출 완료 메시지</strong>
              <p className="field-hint" style={{ whiteSpace: 'pre-line' }}>
                {draft.completion_message}
              </p>
            </div>
          ) : null}
          <ol>
            {draft.questions.map((question, index) => (
              <li key={`${index}-${question.text}`}>
                <strong>{question.text}</strong>
                <p className="field-hint">
                  {QUESTION_TYPE_LABELS[question.type]}
                  {question.choices?.length ? ` · ${question.choices.join(' / ')}` : ''}
                </p>
              </li>
            ))}
          </ol>
          <div className="standard-save-row">
            <button className="button button--secondary" type="button" onClick={handleCopy}>
              초안 복사
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={handleCreate}
              disabled={isCreating || !sessionStatus?.connected}
            >
              {isCreating ? 'Sally에 생성 중…' : 'Sally에 생성'}
            </button>
            {kind === 'recruitment' && program?.recruitment_survey_editor_url ? (
              <button
                className="button button--primary"
                type="button"
                onClick={handleDistribute}
                disabled={
                  isDistributing ||
                  !sessionStatus?.connected ||
                  Boolean(program.recruitment_survey_url)
                }
              >
                {program.recruitment_survey_url
                  ? '배포됨'
                  : isDistributing
                    ? '배포 중…'
                    : '배포하고 모집 링크 만들기'}
              </button>
            ) : null}
          </div>
          {actionMessage ? <p className="save-success">{actionMessage}</p> : null}
          {actionError ? (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
