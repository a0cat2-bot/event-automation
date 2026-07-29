import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { listApplicants, type Applicant } from '../api/applicants';
import { generateLetter } from '../api/letters';
import { getLetterTemplates, type LetterTemplate } from '../api/letterTemplates';
import { getProgram, type Program } from '../api/programs';
import { PageShell } from '../components/PageShell';
import { ProgramContextBar } from '../components/ProgramContextBar';
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
                        <a href={preview.fileUrl} target="_blank" rel="noreferrer">
                          새 탭에서 열기 →
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
