import { IconArrowRight } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { listApplicants, type Applicant } from '../api/applicants';
import {
  generateLetter,
  getRecruitmentNoticeSetup,
  previewRecruitmentNotice,
  saveRecruitmentRecipients,
  sendRecruitmentNotice,
  type RecruitmentNoticeOutcome,
  type RecruitmentNoticePreview,
} from '../api/letters';
import { getLetterTemplates, type LetterTemplate } from '../api/letterTemplates';
import { getProgram, type Program } from '../api/programs';
import { PageShell } from '../components/PageShell';
import { ProgramContextBar } from '../components/ProgramContextBar';
import { SallySurveyDraftCard } from '../components/SallySurveyDraftCard';
import { resolveBackendAssetUrl } from '../config/api';

const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  recruitment: '모집 안내',
  notification: '선정 결과 안내',
  gift_notification: '기프트 안내',
};

type PreviewState = {
  isGenerating: boolean;
  error: string | null;
  fileUrl: string | null;
  outputFormat: 'pdf' | 'image' | null;
};

export function LetterDraftsPage() {
  const { programId = '' } = useParams();
  const [program, setProgram] = useState<Program | null>(null);
  const [templates, setTemplates] = useState<LetterTemplate[]>([]);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [recipientText, setRecipientText] = useState('');
  const [recipientsSaved, setRecipientsSaved] = useState(false);
  const [selectedRecruitmentTemplateId, setSelectedRecruitmentTemplateId] = useState('');
  const [noticePreview, setNoticePreview] = useState<RecruitmentNoticePreview | null>(null);
  const [noticeOutcomes, setNoticeOutcomes] = useState<RecruitmentNoticeOutcome[]>([]);
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [noticeAction, setNoticeAction] = useState<'save' | 'preview' | 'send' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    Promise.all([
      getProgram(programId, controller.signal).then(({ program: next }) => {
        if (isCurrent) setProgram(next);
      }),
      getLetterTemplates(controller.signal, programId).then(({ templates: next }) => {
        if (isCurrent) setTemplates(next);
      }),
      listApplicants(programId, controller.signal).then(({ applicants: next }) => {
        if (isCurrent) setApplicants(next);
      }),
      getRecruitmentNoticeSetup(programId, controller.signal).then(({ recipients }) => {
        if (isCurrent) {
          setRecipientText(recipients.join('\n'));
          setRecipientsSaved(true);
        }
      }),
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
  }, [programId]);

  const previewApplicant = applicants[0] ?? null;

  const recruitmentTemplates = templates.filter(
    (template) => template.template_type === 'recruitment' && template.layout_mode === 'standard',
  );

  useEffect(() => {
    if (!selectedRecruitmentTemplateId && recruitmentTemplates[0]) {
      setSelectedRecruitmentTemplateId(String(recruitmentTemplates[0].id));
    }
  }, [recruitmentTemplates, selectedRecruitmentTemplateId]);

  function recipientEmails() {
    return recipientText
      .split(/[\n,;]+/)
      .map((email) => email.trim())
      .filter(Boolean);
  }

  function resetNoticeReview() {
    setNoticePreview(null);
    setNoticeOutcomes([]);
    setNoticeMessage(null);
  }

  async function handleSaveRecipients() {
    setNoticeAction('save');
    setNoticeError(null);
    resetNoticeReview();
    try {
      const result = await saveRecruitmentRecipients(programId, recipientEmails());
      setRecipientText(result.recipients.join('\n'));
      setRecipientsSaved(true);
      setNoticeMessage(`${result.recipients.length}명의 수신자를 저장했습니다.`);
    } catch (error) {
      setRecipientsSaved(false);
      setNoticeError(error instanceof Error ? error.message : '수신자를 저장하지 못했습니다.');
    } finally {
      setNoticeAction(null);
    }
  }

  async function handleNoticePreview() {
    if (!selectedRecruitmentTemplateId || !recipientsSaved) return;
    setNoticeAction('preview');
    setNoticeError(null);
    setNoticeMessage(null);
    setNoticeOutcomes([]);
    try {
      setNoticePreview(
        await previewRecruitmentNotice(programId, selectedRecruitmentTemplateId),
      );
    } catch (error) {
      setNoticePreview(null);
      setNoticeError(error instanceof Error ? error.message : '발송 미리보기를 만들지 못했습니다.');
    } finally {
      setNoticeAction(null);
    }
  }

  async function handleNoticeSend() {
    if (!noticePreview || !selectedRecruitmentTemplateId) return;
    if (!window.confirm(`${noticePreview.recipients.length}명에게 모집 안내를 발송할까요?`)) return;
    setNoticeAction('send');
    setNoticeError(null);
    setNoticeMessage(null);
    try {
      const result = await sendRecruitmentNotice(programId, selectedRecruitmentTemplateId);
      setNoticeOutcomes(result.outcomes);
      setNoticeMessage('발송을 마쳤습니다. 아래에서 수신자별 결과를 확인하세요.');
      setNoticePreview(null);
    } catch (error) {
      setNoticeError(error instanceof Error ? error.message : '모집 안내를 발송하지 못했습니다.');
    } finally {
      setNoticeAction(null);
    }
  }

  async function handlePreview(template: LetterTemplate) {
    if (!previewApplicant) return;
    setPreviews((current) => ({
      ...current,
      [template.id]: { isGenerating: true, error: null, fileUrl: null, outputFormat: null },
    }));

    try {
      const result = await generateLetter({
        template_id: String(template.id),
        program_id: programId,
        applicant_ids: [previewApplicant.id],
        brand_variant: template.brand_variant,
      });
      const generated = result.results[0];
      if (!generated || generated.status === 'failed' || !generated.file_path) {
        throw new Error(generated?.error ?? '초안을 생성하지 못했습니다.');
      }
      setPreviews((current) => ({
        ...current,
        [template.id]: {
          isGenerating: false,
          error: null,
          fileUrl: resolveBackendAssetUrl(generated.file_path as string),
          outputFormat: template.output_format,
        },
      }));
    } catch (error) {
      setPreviews((current) => ({
        ...current,
        [template.id]: {
          isGenerating: false,
          error: error instanceof Error ? error.message : '초안을 생성하지 못했습니다.',
          fileUrl: null,
          outputFormat: null,
        },
      }));
    }
  }

  const templatesByType = templates.reduce<Record<string, LetterTemplate[]>>((groups, template) => {
    const key = template.template_type;
    groups[key] = groups[key] ? [...groups[key], template] : [template];
    return groups;
  }, {});

  return (
    <PageShell
      title="레터 미리보기/발송 준비"
      designSection="레터 미리보기/발송 준비"
      description={
        program
          ? `${program.name}의 레터 템플릿을 골라 실제 프로그램 정보(일시·장소·프로그램명·등록된 상품)로 채워진 초안을 미리 보고, 그대로 편집하거나 발송 화면으로 이동할 수 있습니다.`
          : '레터 템플릿을 미리 봅니다.'
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

      {!isLoading ? <SallySurveyDraftCard programId={programId} kind="recruitment" /> : null}

      {!isLoading ? (
        <section className="content-card" aria-label="모집 안내 발송">
          <div className="section-heading">
            <div>
              <h2>모집 안내 발송</h2>
              <p>
                수신자와 레터를 저장한 뒤 미리보기를 확인해야 실제 발송 버튼이 열립니다.
              </p>
            </div>
          </div>
          <div className="standard-editor-form">
            <label>
              모집 레터
              <select
                value={selectedRecruitmentTemplateId}
                onChange={(event) => {
                  setSelectedRecruitmentTemplateId(event.target.value);
                  resetNoticeReview();
                }}
              >
                {recruitmentTemplates.length === 0 ? (
                  <option value="">사용 가능한 표준 모집 레터가 없습니다.</option>
                ) : null}
                {recruitmentTemplates.map((template) => (
                  <option key={template.id} value={String(template.id)}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              수신자 이메일
              <textarea
                rows={7}
                value={recipientText}
                onChange={(event) => {
                  setRecipientText(event.target.value);
                  setRecipientsSaved(false);
                  resetNoticeReview();
                }}
                placeholder={'employee1@example.com\nemployee2@example.com'}
              />
              <span className="field-hint">
                한 줄에 하나씩 입력하세요. 쉼표와 세미콜론도 구분자로 사용할 수 있으며, 대소문자만
                다른 중복 주소는 하나로 저장됩니다.
              </span>
            </label>
            <p className="field-hint">
              Sally 설문 링크:{' '}
              {program?.recruitment_survey_url ? (
                <a href={program.recruitment_survey_url} target="_blank" rel="noreferrer">
                  {program.recruitment_survey_url}
                </a>
              ) : (
                '아직 없습니다. 위에서 설문을 만든 뒤 Sally에서 배포하면 모집 링크가 생깁니다.'
              )}
            </p>
            <div className="standard-save-row">
              <button
                className="button button--secondary"
                type="button"
                onClick={handleSaveRecipients}
                disabled={noticeAction !== null}
              >
                {noticeAction === 'save' ? '저장 중…' : '수신자 저장'}
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={handleNoticePreview}
                disabled={
                  !recipientsSaved ||
                  !selectedRecruitmentTemplateId ||
                  !program?.recruitment_survey_url ||
                  noticeAction !== null
                }
              >
                {noticeAction === 'preview' ? '미리보는 중…' : '발송 미리보기'}
              </button>
            </div>
            {noticeMessage ? <p className="save-success">{noticeMessage}</p> : null}
            {noticeError ? (
              <p className="form-error" role="alert">
                {noticeError}
              </p>
            ) : null}
          </div>

          {noticePreview ? (
            <div className="content-card">
              <h3>발송 전 확인</h3>
              <p>
                <strong>제목:</strong> {noticePreview.subject}
              </p>
              <p>
                <strong>CTA:</strong>{' '}
                <a href={noticePreview.survey_url} target="_blank" rel="noreferrer">
                  {noticePreview.cta_text} · {noticePreview.survey_url}
                </a>
              </p>
              <p>
                <strong>수신자 {noticePreview.recipients.length}명:</strong>{' '}
                {noticePreview.recipients.join(', ')}
              </p>
              <iframe
                title="모집 안내 발송 미리보기"
                srcDoc={noticePreview.letter_html}
                style={{
                  width: '100%',
                  height: '560px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                }}
              />
              <div className="standard-save-row">
                <button
                  className="button button--primary"
                  type="button"
                  onClick={handleNoticeSend}
                  disabled={noticeAction !== null}
                >
                  {noticeAction === 'send' ? '발송 중…' : '확인한 내용으로 실제 발송'}
                </button>
              </div>
            </div>
          ) : null}

          {noticeOutcomes.length > 0 ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>수신자</th>
                    <th>결과</th>
                    <th>상세</th>
                  </tr>
                </thead>
                <tbody>
                  {noticeOutcomes.map((outcome) => (
                    <tr key={outcome.email}>
                      <td>{outcome.email}</td>
                      <td>
                        <span
                          className={`status-badge ${
                            outcome.status === 'sent'
                              ? 'status-badge--success'
                              : 'status-badge--warning'
                          }`}
                        >
                          {outcome.status === 'sent' ? '성공' : '실패'}
                        </span>
                      </td>
                      <td>{outcome.message_id ?? outcome.error ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {!isLoading && applicants.length === 0 ? (
        <div className="empty-state">
          <strong>미리보기를 생성하려면 신청자가 최소 1명 필요합니다.</strong>
          <p>
            <Link to={`/programs/${programId}/applicants/upload`}>신청자 업로드로 이동</Link>
          </p>
        </div>
      ) : null}

      {previewApplicant ? (
        <p className="page-description">
          미리보기는 <strong>{previewApplicant.name}</strong>님 기준으로 생성됩니다.
        </p>
      ) : null}

      {Object.entries(templatesByType).map(([templateType, typeTemplates]) => (
        <div className="content-card" key={templateType}>
          <h2>{TEMPLATE_TYPE_LABELS[templateType] ?? templateType}</h2>
          <div className="template-card-list">
            {typeTemplates.map((template) => {
              const preview = previews[template.id];
              return (
                <article className="content-card" key={template.id}>
                  <div className="section-heading">
                    <div>
                      <div className="editor-actions">
                        <strong>{template.name}</strong>
                        <span className="status-badge">
                          {template.is_customized ? '이 프로그램에 맞게 수정됨' : '표준 사용 중'}
                        </span>
                      </div>
                      <p>
                        {template.brand_variant} ·{' '}
                        {template.layout_mode === 'standard' ? '표준 레이아웃' : '자유 배치'}
                      </p>
                    </div>
                    <div className="editor-actions">
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => handlePreview(template)}
                        disabled={!previewApplicant || preview?.isGenerating}
                      >
                        {preview?.isGenerating ? '생성 중…' : '초안 미리보기'}
                      </button>
                      <Link
                        className="button button--secondary"
                        to={`/programs/${programId}/letters/${template.id}/edit`}
                      >
                        편집하기
                      </Link>
                      {templateType !== 'recruitment' ? (
                        <Link
                          className="button button--secondary"
                          to={`/programs/${programId}/notifications`}
                        >
                          발송하러 가기
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  {preview?.error ? (
                    <p className="form-error" role="alert">
                      {preview.error}
                    </p>
                  ) : null}

                  {preview?.fileUrl ? (
                    <>
                      <p>
                        <a
                          className="inline-link-with-icon"
                          href={preview.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          새 탭에서 열기
                          <IconArrowRight size={14} stroke={2} aria-hidden="true" />
                        </a>
                      </p>
                      {preview.outputFormat === 'image' ? (
                        <img
                          src={preview.fileUrl}
                          alt={`${template.name} 미리보기`}
                          style={{ maxWidth: '360px', width: '100%', borderRadius: 'var(--radius-sm)' }}
                        />
                      ) : (
                        <iframe
                          title={`${template.name} 미리보기`}
                          src={preview.fileUrl}
                          style={{
                            width: '100%',
                            height: '480px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        />
                      )}
                    </>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </PageShell>
  );
}
