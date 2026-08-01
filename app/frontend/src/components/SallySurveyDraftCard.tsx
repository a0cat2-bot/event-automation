import { useEffect, useState } from 'react';

import {
  createSallySurvey,
  getSallySurveyDescriptionImage,
  getSallySurveyDraft,
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
  return [draft.title, draft.description, ...questions].filter(Boolean).join('\n\n');
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

  useEffect(() => {
    const controller = new AbortController();
    let nextImageUrl: string | null = null;
    setDraft(null);
    setLoadError(null);
    setDescriptionImageUrl(null);
    setImageError(null);
    getSallySurveyDraft(programId, kind, controller.signal)
      .then(({ draft: nextDraft }) => setDraft(nextDraft))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(error instanceof Error ? error.message : '설문 초안을 불러오지 못했습니다.');
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
          result.survey_url
            ? `Sally에 설문을 생성하고 링크를 저장했습니다: ${result.survey_url}`
            : 'Sally에 설문을 생성했습니다.',
        );
      } else {
        setActionError(
          `Sally 자동 생성을 사용할 수 없습니다. 아래 초안을 복사해 직접 생성해주세요. ${result.reason ?? ''}`.trim(),
        );
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Sally에 설문을 생성하지 못했습니다.');
    } finally {
      setIsCreating(false);
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
              disabled={isCreating}
            >
              {isCreating ? 'Sally에 생성 중…' : 'Sally에 생성'}
            </button>
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
