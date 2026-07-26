import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  createLetterTemplate,
  getLetterCategories,
  getLetterTemplates,
  type LetterCategory,
  type LetterTemplate,
} from '../api/letterTemplates';
import { PageShell } from '../components/PageShell';

const TEMPLATE_TYPES = [
  { value: 'recruitment', label: '모집 안내' },
  { value: 'notification', label: '선정 결과 안내' },
  { value: 'gift_notification', label: '기프트 안내' },
] as const;

function templateTypeLabel(value: string) {
  return TEMPLATE_TYPES.find((option) => option.value === value)?.label ?? value;
}

export function LetterTemplateListPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<LetterTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categories, setCategories] = useState<LetterCategory[]>([]);
  const [isCategoryLoading, setIsCategoryLoading] = useState(true);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [templateType, setTemplateType] = useState('recruitment');
  const [brandVariant, setBrandVariant] = useState('default');
  const [layoutMode, setLayoutMode] = useState<'freeform' | 'standard'>('freeform');
  const [categoryId, setCategoryId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    getLetterTemplates(controller.signal)
      .then(({ templates: nextTemplates }) => {
        if (!isCurrent) return;
        setTemplates(nextTemplates);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setLoadError(error instanceof Error ? error.message : '템플릿을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    getLetterCategories(controller.signal)
      .then(({ categories: nextCategories }) => {
        if (!isCurrent) return;
        setCategories(nextCategories);
        setCategoryError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setCategoryError(error instanceof Error ? error.message : '카테고리를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (isCurrent) setIsCategoryLoading(false);
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    setCreateError(null);

    try {
      const baseInput = {
        name: name.trim(),
        template_type: templateType,
        brand_variant: brandVariant.trim(),
      };
      const { template } = await createLetterTemplate(
        layoutMode === 'standard'
          ? { ...baseInput, layout_mode: 'standard', category_id: categoryId }
          : { ...baseInput, layout_mode: 'freeform' },
      );
      navigate(`/letter-templates/${template.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '템플릿을 만들지 못했습니다.');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <PageShell
      title="레터 템플릿"
      description="배경 이미지 위에 신청자별 텍스트가 들어갈 위치와 서식을 설정합니다."
      designSection="레터 템플릿"
      showStubNote={false}
    >
      <div className="template-list-layout">
        <section className="content-card" aria-labelledby="template-list-title">
          <div className="section-heading">
            <div>
              <h2 id="template-list-title">저장된 템플릿</h2>
              <p>템플릿을 선택해 배경과 텍스트 필드를 편집하세요.</p>
            </div>
            {!isLoading && !loadError ? (
              <span className="count-badge">{templates.length}개</span>
            ) : null}
          </div>

          {isLoading ? <p className="state-message">템플릿을 불러오는 중입니다…</p> : null}
          {loadError ? (
            <p className="state-message state-message--error" role="alert">
              {loadError}
            </p>
          ) : null}
          {!isLoading && !loadError && templates.length === 0 ? (
            <div className="empty-state">
              <strong>아직 템플릿이 없습니다.</strong>
              <p>오른쪽 양식에서 첫 템플릿을 만들어 시작하세요.</p>
            </div>
          ) : null}
          {!isLoading && !loadError && templates.length > 0 ? (
            <div className="template-card-list">
              {templates.map((template) => (
                <Link
                  className="template-card"
                  key={template.id}
                  to={`/letter-templates/${template.id}`}
                >
                  <div>
                    <strong>{template.name}</strong>
                    <p>
                      {templateTypeLabel(template.template_type)} · {template.brand_variant}
                    </p>
                  </div>
                  <span aria-hidden="true">편집 →</span>
                </Link>
              ))}
            </div>
          ) : null}
        </section>

        <section className="content-card create-template-card" aria-labelledby="create-title">
          <div className="section-heading">
            <div>
              <h2 id="create-title">새 템플릿</h2>
              <p>기본 정보를 만든 뒤 에디터로 이동합니다.</p>
            </div>
          </div>
          <form className="stack-form" onSubmit={handleCreate}>
            <label>
              템플릿 이름
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="예: 2026 여름 프로그램 모집"
              />
            </label>
            <label>
              템플릿 유형
              <select
                value={templateType}
                onChange={(event) => setTemplateType(event.target.value)}
              >
                {TEMPLATE_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              브랜드 변형
              <input
                required
                value={brandVariant}
                onChange={(event) => setBrandVariant(event.target.value)}
                placeholder="예: default"
              />
            </label>
            <fieldset className="layout-mode-fieldset">
              <legend>레이아웃 모드</legend>
              <div className="layout-mode-toggle">
                <label>
                  <input
                    type="radio"
                    name="layout-mode"
                    value="freeform"
                    checked={layoutMode === 'freeform'}
                    onChange={() => setLayoutMode('freeform')}
                  />
                  자유 배치
                </label>
                <label>
                  <input
                    type="radio"
                    name="layout-mode"
                    value="standard"
                    checked={layoutMode === 'standard'}
                    onChange={() => setLayoutMode('standard')}
                  />
                  표준 레이아웃
                </label>
              </div>
            </fieldset>
            {layoutMode === 'standard' ? (
              <label>
                카테고리
                <select
                  required
                  value={categoryId}
                  disabled={isCategoryLoading || Boolean(categoryError)}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">
                    {isCategoryLoading ? '불러오는 중…' : '카테고리를 선택하세요'}
                  </option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.display_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {layoutMode === 'standard' && categoryError ? (
              <p className="form-error" role="alert">
                {categoryError}
              </p>
            ) : null}
            {createError ? (
              <p className="form-error" role="alert">
                {createError}
              </p>
            ) : null}
            <button
              className="button button--primary"
              disabled={
                isCreating ||
                !name.trim() ||
                !brandVariant.trim() ||
                (layoutMode === 'standard' && !categoryId)
              }
              type="submit"
            >
              {isCreating ? '만드는 중…' : '새 템플릿 만들기'}
            </button>
          </form>
        </section>
      </div>
    </PageShell>
  );
}
