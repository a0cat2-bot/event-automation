import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getLetterCategories,
  getOrgSettings,
  LETTER_FIELD_KEYS,
  type LetterCategory,
  type LetterFieldKey,
  type LetterTemplate,
  type OrgSettings,
  type StandardContent,
  updateLetterTemplateStandardContent,
} from '../api/letterTemplates';
import { PageShell } from '../components/PageShell';
import { resolveBackendAssetUrl } from '../config/api';

type StandardMergeFieldKey = Exclude<LetterFieldKey, 'static'>;

const MERGE_FIELD_LABELS: Record<StandardMergeFieldKey, string> = {
  applicant_name: '신청자 이름',
  applicant_email: '신청자 이메일',
  department: '소속 부서',
  program_name: '프로그램명',
  program_date: '날짜',
  program_location: '장소',
  program_time: '시간',
  survey_link: '설문 링크',
  gift_amount: '기프트 금액',
  coordinator_name: '담당자 이름',
  coordinator_contact: '담당자 연락처',
};

const STANDARD_MERGE_FIELD_KEYS = LETTER_FIELD_KEYS.filter(
  (key): key is StandardMergeFieldKey => key !== 'static',
);

const EMPTY_STANDARD_CONTENT: StandardContent = {
  title_override: null,
  datetime_text: null,
  location_text: null,
  body_text: '',
  gift_info_text: null,
  precautions: [],
  cta_text: null,
  cta_link: null,
};

function nullableTrimmed(value: string | null) {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

function previewWithMergeFields(value: string) {
  return value.replace(/\{\{([a-z_]+)\}\}/g, (match, fieldKey: string) => {
    const label = MERGE_FIELD_LABELS[fieldKey as StandardMergeFieldKey];
    return label ? `[${label}]` : match;
  });
}

export function StandardTemplateEditor({ template }: { template: LetterTemplate }) {
  const [category, setCategory] = useState<LetterCategory | null>(null);
  const [orgSettings, setOrgSettings] = useState<OrgSettings | null>(null);
  const [content, setContent] = useState<StandardContent>(
    template.standard_content ?? EMPTY_STANDARD_CONTENT,
  );
  const [previewProgramName, setPreviewProgramName] = useState('프로그램명 예시');
  const [isLoadingCategory, setIsLoadingCategory] = useState(true);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [orgSettingsError, setOrgSettingsError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    getLetterCategories(controller.signal)
      .then(({ categories }) => {
        if (!isCurrent) return;
        const matchingCategory = categories.find((item) => item.id === template.category_id);
        if (!matchingCategory) {
          setCategoryError('이 템플릿의 카테고리를 찾지 못했습니다.');
          return;
        }
        setCategory(matchingCategory);
        setCategoryError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setCategoryError(
          error instanceof Error ? error.message : '카테고리를 불러오지 못했습니다.',
        );
      })
      .finally(() => {
        if (isCurrent) setIsLoadingCategory(false);
      });

    getOrgSettings(controller.signal)
      .then(({ org_settings: nextSettings }) => {
        if (!isCurrent) return;
        setOrgSettings(nextSettings);
        setOrgSettingsError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setOrgSettingsError(
          error instanceof Error ? error.message : '조직 설정을 불러오지 못했습니다.',
        );
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [template.category_id]);

  const mergeFieldHint = useMemo(
    () => STANDARD_MERGE_FIELD_KEYS.map((key) => `{{${key}}}`).join(', '),
    [],
  );

  function updateContent<Key extends keyof StandardContent>(key: Key, value: StandardContent[Key]) {
    setContent((current) => ({ ...current, [key]: value }));
    setSaveMessage(null);
    setSaveError(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!category || !content.body_text.trim()) return;

    const nextContent: StandardContent = {
      title_override: nullableTrimmed(content.title_override),
      datetime_text: category.has_datetime ? nullableTrimmed(content.datetime_text) : null,
      location_text: category.has_location ? nullableTrimmed(content.location_text) : null,
      body_text: content.body_text.trim(),
      gift_info_text: category.has_gift_info ? nullableTrimmed(content.gift_info_text) : null,
      precautions: category.has_precautions
        ? content.precautions.map((item) => item.trim()).filter(Boolean)
        : [],
      cta_text: category.has_cta_link ? nullableTrimmed(content.cta_text) : null,
      cta_link: category.has_cta_link ? nullableTrimmed(content.cta_link) : null,
    };

    setIsSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      const { template: nextTemplate } = await updateLetterTemplateStandardContent(
        String(template.id),
        nextContent,
      );
      setContent(nextTemplate.standard_content ?? nextContent);
      setSaveMessage('저장되었습니다.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '표준 템플릿을 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  const titleText = content.title_override?.trim() || category?.default_title_text || '';
  const previewBody = previewWithMergeFields(content.body_text);

  return (
    <PageShell
      title={template.name}
      description={`${template.template_type} · ${template.brand_variant} · 표준 레이아웃`}
      designSection="표준 레터 템플릿 편집"
      showStubNote={false}
    >
      <div className="editor-topbar">
        <Link className="back-link" to="/letter-templates">
          ← 템플릿 목록
        </Link>
      </div>

      {isLoadingCategory ? (
        <p className="state-message">카테고리 정보를 불러오는 중입니다…</p>
      ) : null}
      {categoryError ? (
        <p className="state-message state-message--error" role="alert">
          {categoryError}
        </p>
      ) : null}

      {category ? (
        <div className="standard-editor-layout">
          <form className="content-card standard-editor-form" onSubmit={handleSave}>
            <div className="section-heading">
              <div>
                <h2>{category.display_name} 내용</h2>
                <p>표준 레이아웃에 들어갈 문구를 입력하세요.</p>
              </div>
            </div>

            <label>
              제목 재정의 (선택)
              <input
                value={content.title_override ?? ''}
                onChange={(event) => updateContent('title_override', event.target.value)}
                placeholder={category.default_title_text}
              />
            </label>

            <label>
              프로그램명 (미리보기용)
              <input
                value={previewProgramName}
                onChange={(event) => setPreviewProgramName(event.target.value)}
                placeholder="프로그램명 예시"
              />
              <small className="field-hint">
                미리보기 전용이며 저장되지 않습니다. 실제 발송 시 선택한 프로그램명이 자동으로
                표시됩니다.
              </small>
            </label>

            {category.has_datetime ? (
              <label>
                일시
                <input
                  value={content.datetime_text ?? ''}
                  onChange={(event) => updateContent('datetime_text', event.target.value)}
                  placeholder="예: 2026년 8월 20일(목) 14:00"
                />
              </label>
            ) : null}

            {category.has_location ? (
              <label>
                장소
                <input
                  value={content.location_text ?? ''}
                  onChange={(event) => updateContent('location_text', event.target.value)}
                  placeholder="예: 본관 2층 세미나실"
                />
              </label>
            ) : null}

            <label>
              본문
              <textarea
                required
                rows={8}
                value={content.body_text}
                onChange={(event) => updateContent('body_text', event.target.value)}
                placeholder="발송할 안내 내용을 입력하세요."
              />
              <small className="field-hint">사용 가능한 병합 필드: {mergeFieldHint}</small>
            </label>

            {category.has_gift_info ? (
              <label>
                기프트 안내
                <textarea
                  rows={3}
                  value={content.gift_info_text ?? ''}
                  onChange={(event) => updateContent('gift_info_text', event.target.value)}
                  placeholder="기프트 지급 내용을 입력하세요."
                />
              </label>
            ) : null}

            {category.has_precautions ? (
              <fieldset className="precautions-fieldset">
                <legend>유의사항</legend>
                <div className="precaution-list">
                  {content.precautions.map((precaution, index) => (
                    <div className="precaution-row" key={index}>
                      <input
                        aria-label={`유의사항 ${index + 1}`}
                        value={precaution}
                        onChange={(event) => {
                          const nextPrecautions = [...content.precautions];
                          nextPrecautions[index] = event.target.value;
                          updateContent('precautions', nextPrecautions);
                        }}
                        placeholder="유의사항을 입력하세요."
                      />
                      <button
                        className="button button--quiet"
                        type="button"
                        onClick={() =>
                          updateContent(
                            'precautions',
                            content.precautions.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="button button--secondary add-precaution-button"
                  type="button"
                  onClick={() => updateContent('precautions', [...content.precautions, ''])}
                >
                  + 유의사항 추가
                </button>
              </fieldset>
            ) : null}

            {category.has_cta_link ? (
              <div className="standard-cta-fields">
                <label>
                  CTA 문구
                  <input
                    value={content.cta_text ?? ''}
                    onChange={(event) => updateContent('cta_text', event.target.value)}
                    placeholder="예: 설문 참여하기"
                  />
                </label>
                <label>
                  CTA 링크
                  <input
                    type="url"
                    value={content.cta_link ?? ''}
                    onChange={(event) => updateContent('cta_link', event.target.value)}
                    placeholder="https://example.com"
                  />
                </label>
              </div>
            ) : null}

            {saveError ? (
              <p className="form-error" role="alert">
                {saveError}
              </p>
            ) : null}
            <div className="standard-save-row">
              <button
                className="button button--primary"
                type="submit"
                disabled={isSaving || !content.body_text.trim()}
              >
                {isSaving ? '저장 중…' : '저장'}
              </button>
              <span aria-live="polite">
                {saveMessage ? <strong className="save-success">{saveMessage}</strong> : null}
              </span>
            </div>
          </form>

          <section className="standard-preview-panel" aria-labelledby="standard-preview-title">
            <div className="section-heading">
              <div>
                <h2 id="standard-preview-title">실시간 미리보기</h2>
                <p>실제 발송 레터의 간단한 레이아웃 미리보기입니다.</p>
              </div>
            </div>

            <article className="standard-letter-preview">
              <div className="standard-preview-org">
                <span>{orgSettings?.org_display_name ?? ''}</span>
                <span className="standard-preview-org-divider" aria-hidden="true">
                  ·
                </span>
                <span>{previewProgramName}</span>
              </div>
              <div className="standard-character-slot">
                {orgSettings?.character_image_url ? (
                  <img
                    src={resolveBackendAssetUrl(orgSettings.character_image_url)}
                    alt="조직 캐릭터"
                  />
                ) : (
                  <span aria-hidden="true" />
                )}
              </div>
              <h2>{titleText}</h2>

              {category.has_datetime || category.has_location ? (
                <dl className="standard-preview-details">
                  {category.has_datetime ? (
                    <div>
                      <dt>
                        <span className="standard-preview-detail-icon" aria-hidden="true">
                          📅
                        </span>
                        일시
                      </dt>
                      <dd>{content.datetime_text || '일시를 입력하세요.'}</dd>
                    </div>
                  ) : null}
                  {category.has_location ? (
                    <div>
                      <dt>
                        <span className="standard-preview-detail-icon" aria-hidden="true">
                          📍
                        </span>
                        장소
                      </dt>
                      <dd>{content.location_text || '장소를 입력하세요.'}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}

              <p className="standard-preview-body">
                {previewBody || '본문을 입력하면 여기에 미리보기가 표시됩니다.'}
              </p>

              {category.has_gift_info ? (
                <section className="standard-preview-block">
                  <strong>상품 안내</strong>
                  <p>{content.gift_info_text || '기프트 안내를 입력하세요.'}</p>
                </section>
              ) : null}

              {category.has_precautions ? (
                <section className="standard-preview-block">
                  <strong>유의사항</strong>
                  {content.precautions.some((item) => item.trim()) ? (
                    <ul>
                      {content.precautions
                        .filter((item) => item.trim())
                        .map((item, index) => (
                          <li key={index}>{previewWithMergeFields(item)}</li>
                        ))}
                    </ul>
                  ) : (
                    <p>유의사항을 추가하세요.</p>
                  )}
                </section>
              ) : null}

              {category.has_cta_link ? (
                <div className="standard-preview-cta">{content.cta_text || 'CTA 문구'}</div>
              ) : null}
            </article>

            {!orgSettings?.character_image_url ? (
              <p className="preview-note">
                실제 발송 시 조직 설정의 캐릭터 이미지가 표시됩니다. 현재 등록된 이미지가 없습니다.
              </p>
            ) : null}
            {orgSettingsError ? (
              <p className="form-error" role="alert">
                {orgSettingsError}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </PageShell>
  );
}
