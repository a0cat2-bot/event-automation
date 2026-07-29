import { ChangeEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text } from 'react-konva';
import { Link, useParams } from 'react-router-dom';

import {
  getLetterCategories,
  getLetterTemplate,
  getProgramLetterContent,
  LETTER_FIELD_KEYS,
  type LetterCategory,
  type LetterFieldKey,
  type LetterTemplate,
  type ProgramLetterCustomization,
  type TextField,
  resetProgramLetterContent,
  updateLetterTemplateCategory,
  updateLetterTemplateFields,
  updateProgramLetterFields,
  uploadLetterTemplateBackground,
  uploadProgramLetterBackground,
} from '../api/letterTemplates';
import { PageShell } from '../components/PageShell';
import { resolveBackendAssetUrl } from '../config/api';
import { StandardTemplateEditor } from './StandardTemplateEditor';

const FIELD_LABELS: Record<LetterFieldKey, string> = {
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
  static: '고정 텍스트',
};

function previewText(field: TextField) {
  return field.key === 'static'
    ? field.static_text || '[고정 텍스트]'
    : `[${FIELD_LABELS[field.key]}]`;
}

function CanvasSurface({
  template,
  fields,
  selectedFieldId,
  onSelectField,
  onMoveField,
}: {
  template: LetterTemplate;
  fields: TextField[];
  selectedFieldId: string | null;
  onSelectField: (fieldId: string | null) => void;
  onMoveField: (fieldId: string, x: number, y: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
  const [imageError, setImageError] = useState(false);
  const canvasWidth = template.canvas_width ?? 0;
  const canvasHeight = template.canvas_height ?? 0;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => setAvailableWidth(container.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!template.background_image_url) return;

    let isCurrent = true;
    const image = new window.Image();
    image.onload = () => {
      if (!isCurrent) return;
      setBackgroundImage(image);
      setImageError(false);
    };
    image.onerror = () => {
      if (!isCurrent) return;
      setBackgroundImage(null);
      setImageError(true);
    };
    image.src = resolveBackendAssetUrl(template.background_image_url);

    return () => {
      isCurrent = false;
    };
  }, [template.background_image_url]);

  const scale =
    canvasWidth > 0 && availableWidth > 0 ? Math.min(1, availableWidth / canvasWidth) : 1;
  const displayWidth = Math.max(1, Math.round(canvasWidth * scale));
  const displayHeight = Math.max(1, Math.round(canvasHeight * scale));

  return (
    <div className="canvas-viewport" ref={containerRef}>
      {imageError ? (
        <p className="state-message state-message--error" role="alert">
          배경 이미지를 불러오지 못했습니다. 백엔드 서버와 이미지 경로를 확인해 주세요.
        </p>
      ) : null}
      {!backgroundImage && !imageError ? (
        <div className="canvas-loading">배경 이미지를 불러오는 중입니다…</div>
      ) : null}
      {backgroundImage && availableWidth > 0 ? (
        <div className="canvas-stage-frame" style={{ width: displayWidth, height: displayHeight }}>
          <Stage
            width={displayWidth}
            height={displayHeight}
            scaleX={scale}
            scaleY={scale}
            onMouseDown={(event: KonvaEventObject<MouseEvent>) => {
              if (event.target === event.target.getStage()) onSelectField(null);
            }}
            onTouchStart={(event: KonvaEventObject<TouchEvent>) => {
              if (event.target === event.target.getStage()) onSelectField(null);
            }}
          >
            <Layer>
              <KonvaImage
                image={backgroundImage}
                width={canvasWidth}
                height={canvasHeight}
                listening={false}
              />
              {fields.map((field) => {
                const isSelected = field.id === selectedFieldId;
                return (
                  <Group
                    key={field.id}
                    x={field.x}
                    y={field.y}
                    draggable
                    onClick={() => onSelectField(field.id)}
                    onTap={() => onSelectField(field.id)}
                    onDragStart={() => onSelectField(field.id)}
                    onDragEnd={(event: KonvaEventObject<DragEvent>) =>
                      onMoveField(
                        field.id,
                        Math.round(event.target.x()),
                        Math.round(event.target.y()),
                      )
                    }
                    onMouseEnter={(event: KonvaEventObject<MouseEvent>) => {
                      const stage = event.target.getStage();
                      if (stage) stage.container().style.cursor = 'move';
                    }}
                    onMouseLeave={(event: KonvaEventObject<MouseEvent>) => {
                      const stage = event.target.getStage();
                      if (stage) stage.container().style.cursor = 'default';
                    }}
                  >
                    {isSelected ? (
                      <Rect
                        width={field.width}
                        height={field.height}
                        fill="rgba(0, 82, 204, 0.08)"
                        stroke="#0052cc"
                        strokeWidth={2 / scale}
                        dash={[8 / scale, 5 / scale]}
                        listening={false}
                      />
                    ) : null}
                    <Text
                      text={previewText(field)}
                      width={field.width}
                      height={field.height}
                      fontFamily={field.font_family}
                      fontSize={field.font_size}
                      fontStyle={
                        field.font_weight === '700' || field.font_weight === 'bold'
                          ? 'bold'
                          : 'normal'
                      }
                      fill={field.color}
                      align={field.text_align}
                      verticalAlign="middle"
                      wrap="word"
                    />
                  </Group>
                );
              })}
            </Layer>
          </Stage>
        </div>
      ) : null}
    </div>
  );
}

export function LetterTemplateEditorPage() {
  const params = useParams<{ id?: string; programId?: string; templateId?: string }>();
  const templateId = params.templateId ?? params.id;
  const programId = params.programId;
  const [template, setTemplate] = useState<LetterTemplate | null>(null);
  const [customization, setCustomization] = useState<ProgramLetterCustomization | null>(null);
  const [isCustomized, setIsCustomized] = useState(false);
  const [fields, setFields] = useState<TextField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isAddingField, setIsAddingField] = useState(false);
  const [newFieldKey, setNewFieldKey] = useState<LetterFieldKey>('static');
  const [newStaticText, setNewStaticText] = useState('프로그램 모집 안내');
  const [categories, setCategories] = useState<LetterCategory[]>([]);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    if (!templateId) {
      setLoadError('템플릿 ID가 없습니다.');
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    let isCurrent = true;
    setIsLoading(true);
    getLetterTemplate(templateId, controller.signal)
      .then(async ({ template: nextTemplate }) => {
        const programContent = programId
          ? await getProgramLetterContent(programId, templateId, controller.signal)
          : null;
        if (!isCurrent) return;
        const nextCustomization = programContent?.customization ?? null;
        const effectiveTemplate = nextCustomization
          ? {
              ...nextTemplate,
              standard_content: nextCustomization.standard_content ?? nextTemplate.standard_content,
              text_fields: nextCustomization.text_fields ?? nextTemplate.text_fields,
              background_image_url:
                nextCustomization.background_image_url ?? nextTemplate.background_image_url,
              canvas_width: nextCustomization.canvas_width ?? nextTemplate.canvas_width,
              canvas_height: nextCustomization.canvas_height ?? nextTemplate.canvas_height,
            }
          : nextTemplate;
        setTemplate(effectiveTemplate);
        setCustomization(nextCustomization);
        setIsCustomized(programContent?.is_customized ?? false);
        setFields(effectiveTemplate.text_fields ?? []);
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

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [programId, templateId]);

  useEffect(() => {
    if (programId) {
      setCategories([]);
      return;
    }
    const controller = new AbortController();
    getLetterCategories(controller.signal)
      .then(({ categories: next }) => setCategories(next))
      .catch(() => {
        // Non-critical — the category selector just stays empty if this fails.
      });
    return () => controller.abort();
  }, [programId]);

  async function handleCategoryChange(nextCategoryId: string) {
    if (!template) return;
    setIsSavingCategory(true);
    setCategoryError(null);
    try {
      const { template: updated } = await updateLetterTemplateCategory(
        String(template.id),
        nextCategoryId || null,
      );
      setTemplate(updated);
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : '분류를 저장하지 못했습니다.');
    } finally {
      setIsSavingCategory(false);
    }
  }

  const selectedField = useMemo(
    () => fields.find((field) => field.id === selectedFieldId) ?? null,
    [fields, selectedFieldId],
  );

  function replaceField(fieldId: string, changes: Partial<TextField>) {
    setFields((currentFields) =>
      currentFields.map((field) => (field.id === fieldId ? { ...field, ...changes } : field)),
    );
    setSaveMessage(null);
    setSaveError(null);
  }

  async function handleBackgroundUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !templateId) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setUploadError('PNG, JPEG 또는 WebP 이미지만 업로드할 수 있습니다.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    try {
      if (programId) {
        const { customization: nextCustomization } = await uploadProgramLetterBackground(
          programId,
          templateId,
          file,
        );
        setCustomization(nextCustomization);
        setIsCustomized(true);
        setTemplate((current) =>
          current
            ? {
                ...current,
                background_image_url:
                  nextCustomization.background_image_url ?? current.background_image_url,
                canvas_width: nextCustomization.canvas_width ?? current.canvas_width,
                canvas_height: nextCustomization.canvas_height ?? current.canvas_height,
                text_fields: nextCustomization.text_fields ?? current.text_fields,
              }
            : current,
        );
        setFields(nextCustomization.text_fields ?? fields);
      } else {
        const { template: nextTemplate } = await uploadLetterTemplateBackground(templateId, file);
        setTemplate(nextTemplate);
        setFields(nextTemplate.text_fields ?? fields);
      }
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : '배경 이미지를 업로드하지 못했습니다.',
      );
    } finally {
      setIsUploading(false);
    }
  }

  function handleAddField() {
    if (!template?.canvas_width || !template.canvas_height) return;

    const width = Math.min(400, Math.max(120, template.canvas_width - 80));
    const height = 60;
    const field: TextField = {
      id: `field-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      key: newFieldKey,
      static_text: newFieldKey === 'static' ? newStaticText.trim() : null,
      x: Math.round((template.canvas_width - width) / 2),
      y: Math.round((template.canvas_height - height) / 2),
      width,
      height,
      font_family: 'Noto Sans KR, Arial, sans-serif',
      font_size: 32,
      font_weight: '700',
      color: '#0052cc',
      text_align: 'center',
    };

    setFields((currentFields) => [...currentFields, field]);
    setSelectedFieldId(field.id);
    setIsAddingField(false);
    setSaveMessage(null);
    setSaveError(null);
  }

  function handleDeleteField() {
    if (!selectedFieldId) return;
    setFields((currentFields) => currentFields.filter((field) => field.id !== selectedFieldId));
    setSelectedFieldId(null);
    setSaveMessage(null);
    setSaveError(null);
  }

  async function handleSave() {
    if (!templateId) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      if (programId) {
        const { customization: nextCustomization } = await updateProgramLetterFields(
          programId,
          templateId,
          fields,
        );
        setCustomization(nextCustomization);
        setIsCustomized(true);
        setTemplate((current) =>
          current
            ? {
                ...current,
                text_fields: nextCustomization.text_fields ?? fields,
                background_image_url:
                  nextCustomization.background_image_url ?? current.background_image_url,
                canvas_width: nextCustomization.canvas_width ?? current.canvas_width,
                canvas_height: nextCustomization.canvas_height ?? current.canvas_height,
              }
            : current,
        );
        setFields(nextCustomization.text_fields ?? fields);
      } else {
        const { template: nextTemplate } = await updateLetterTemplateFields(templateId, fields);
        setTemplate(nextTemplate);
        setFields(nextTemplate.text_fields ?? []);
      }
      setSaveMessage('저장되었습니다.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '텍스트 필드를 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset() {
    if (!programId || !templateId) return;
    setIsResetting(true);
    setSaveError(null);
    setUploadError(null);
    try {
      const { template: defaultTemplate } = await resetProgramLetterContent(programId, templateId);
      setTemplate(defaultTemplate);
      setFields(defaultTemplate.text_fields ?? []);
      setCustomization(null);
      setIsCustomized(false);
      setSelectedFieldId(null);
      setSaveMessage('표준 템플릿으로 되돌렸습니다.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '표준으로 되돌리지 못했습니다.');
    } finally {
      setIsResetting(false);
    }
  }

  if (isLoading) {
    return (
      <PageShell
        title="레터 템플릿 편집"
        description="템플릿을 불러오는 중입니다…"
        designSection="레터 템플릿"
        showStubNote={false}
      >
        <p className="state-message">잠시만 기다려 주세요.</p>
      </PageShell>
    );
  }

  if (loadError || !template) {
    return (
      <PageShell
        title="레터 템플릿 편집"
        description="템플릿을 열 수 없습니다."
        designSection="레터 템플릿"
        showStubNote={false}
      >
        <p className="state-message state-message--error" role="alert">
          {loadError ?? '템플릿이 없습니다.'}
        </p>
        <Link
          className="button button--secondary"
          to={programId ? `/programs/${programId}/letters` : '/letter-templates'}
        >
          {programId ? '레터 미리보기로' : '템플릿 목록으로'}
        </Link>
      </PageShell>
    );
  }

  if (template.layout_mode === 'standard') {
    return (
      <StandardTemplateEditor
        template={template}
        programId={programId}
        customization={customization}
        isCustomized={isCustomized}
      />
    );
  }

  const hasCanvas = Boolean(
    template.background_image_url && template.canvas_width && template.canvas_height,
  );

  return (
    <PageShell
      title={template.name}
      description={`${template.template_type} · ${template.brand_variant}`}
      designSection="레터 템플릿 편집"
      showStubNote={false}
    >
      <div className="editor-topbar">
        <Link
          className="back-link"
          to={programId ? `/programs/${programId}/letters` : '/letter-templates'}
        >
          {programId ? '← 레터 미리보기로' : '← 템플릿 목록'}
        </Link>
        {programId || hasCanvas ? (
          <div className="editor-actions">
            {programId ? (
              <span className="status-badge">
                {isCustomized ? '이 프로그램 전용으로 수정됨' : '표준 템플릿 사용 중'}
              </span>
            ) : null}
            {programId && isCustomized ? (
              <button
                className="button button--quiet"
                type="button"
                disabled={isResetting}
                onClick={handleReset}
              >
                {isResetting ? '되돌리는 중…' : '표준으로 되돌리기'}
              </button>
            ) : null}
            {hasCanvas ? (
              <>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => setIsAddingField((isOpen) => !isOpen)}
                >
                  + 텍스트 추가
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  disabled={isSaving}
                  onClick={handleSave}
                >
                  {isSaving ? '저장 중…' : '저장'}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {!programId ? (
        <div className="content-card" style={{ marginBottom: '1.5rem' }}>
          <label>
            발송 대상 분류 (선택)
            <select
              value={template.category_id ?? ''}
              disabled={isSavingCategory}
              onChange={(event) => handleCategoryChange(event.target.value)}
            >
              <option value="">선택 안 함 — 선정된 참여자 전체 대상</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.display_name}
                </option>
              ))}
            </select>
            <small className="field-hint">
              안내메일 발송 화면에서 누구에게 보낼 수 있는 템플릿인지 판단하는 데 쓰입니다. 예:
              &ldquo;미당첨 안내&rdquo;로 지정하면 선정된 참여자에게는 발송 대상으로 뜨지 않습니다.
            </small>
          </label>
          {categoryError ? (
            <p className="form-error" role="alert">
              {categoryError}
            </p>
          ) : null}
        </div>
      ) : null}

      {!hasCanvas ? (
        <section className="background-upload-card">
          <div className="upload-icon" aria-hidden="true">
            ↑
          </div>
          <h2>배경 이미지 업로드</h2>
          <p>레터 디자인 원본을 올리면 이미지 크기가 편집 캔버스 크기로 사용됩니다.</p>
          <label className={`button button--primary ${isUploading ? 'is-disabled' : ''}`}>
            {isUploading ? '업로드 중…' : '이미지 선택'}
            <input
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={isUploading}
              onChange={handleBackgroundUpload}
            />
          </label>
          <small>PNG, JPEG, WebP</small>
          {uploadError ? (
            <p className="form-error" role="alert">
              {uploadError}
            </p>
          ) : null}
        </section>
      ) : (
        <>
          {isAddingField ? (
            <section className="add-field-bar" aria-label="새 텍스트 필드">
              <label>
                필드
                <select
                  value={newFieldKey}
                  onChange={(event) => setNewFieldKey(event.target.value as LetterFieldKey)}
                >
                  {LETTER_FIELD_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {FIELD_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              {newFieldKey === 'static' ? (
                <label className="add-field-text-input">
                  표시할 문구
                  <input
                    value={newStaticText}
                    onChange={(event) => setNewStaticText(event.target.value)}
                    placeholder="고정 문구를 입력하세요"
                  />
                </label>
              ) : null}
              <button
                className="button button--primary"
                type="button"
                disabled={newFieldKey === 'static' && !newStaticText.trim()}
                onClick={handleAddField}
              >
                캔버스에 추가
              </button>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => setIsAddingField(false)}
              >
                취소
              </button>
            </section>
          ) : null}

          <div className="editor-status" aria-live="polite">
            <span>
              캔버스 {template.canvas_width} × {template.canvas_height}px · 텍스트 필드{' '}
              {fields.length}개
            </span>
            {saveMessage ? <strong className="save-success">{saveMessage}</strong> : null}
            {saveError ? (
              <strong className="save-error" role="alert">
                {saveError}
              </strong>
            ) : null}
          </div>

          <div className="template-editor-layout">
            <section className="canvas-panel" aria-label="템플릿 캔버스">
              <CanvasSurface
                template={template}
                fields={fields}
                selectedFieldId={selectedFieldId}
                onSelectField={setSelectedFieldId}
                onMoveField={(fieldId, x, y) => replaceField(fieldId, { x, y })}
              />
            </section>

            <aside className="field-panel" aria-label="텍스트 필드 속성">
              <h2>텍스트 속성</h2>
              {!selectedField ? (
                <div className="panel-empty">
                  <p>캔버스의 텍스트를 선택하면 속성을 편집할 수 있습니다.</p>
                </div>
              ) : (
                <div className="property-form">
                  <label>
                    필드
                    <select
                      value={selectedField.key}
                      onChange={(event) => {
                        const key = event.target.value as LetterFieldKey;
                        replaceField(selectedField.id, {
                          key,
                          static_text:
                            key === 'static' ? (selectedField.static_text ?? '고정 텍스트') : null,
                        });
                      }}
                    >
                      {LETTER_FIELD_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {FIELD_LABELS[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedField.key === 'static' ? (
                    <label>
                      고정 문구
                      <input
                        value={selectedField.static_text ?? ''}
                        onChange={(event) =>
                          replaceField(selectedField.id, { static_text: event.target.value })
                        }
                      />
                    </label>
                  ) : null}
                  <div className="property-grid">
                    <label>
                      글자 크기
                      <input
                        type="number"
                        min="8"
                        max="300"
                        value={selectedField.font_size}
                        onChange={(event) =>
                          replaceField(selectedField.id, {
                            font_size: Math.max(8, Number(event.target.value)),
                          })
                        }
                      />
                    </label>
                    <label>
                      글자 굵기
                      <select
                        value={
                          selectedField.font_weight === '700' ||
                          selectedField.font_weight === 'bold'
                            ? '700'
                            : '400'
                        }
                        onChange={(event) =>
                          replaceField(selectedField.id, { font_weight: event.target.value })
                        }
                      >
                        <option value="400">보통</option>
                        <option value="700">굵게</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    글자 색상
                    <span className="color-control">
                      <input
                        type="color"
                        value={selectedField.color}
                        onChange={(event) =>
                          replaceField(selectedField.id, { color: event.target.value })
                        }
                      />
                      <input
                        aria-label="색상 HEX 값"
                        value={selectedField.color}
                        onChange={(event) =>
                          replaceField(selectedField.id, { color: event.target.value })
                        }
                      />
                    </span>
                  </label>
                  <label>
                    정렬
                    <select
                      value={selectedField.text_align}
                      onChange={(event) =>
                        replaceField(selectedField.id, {
                          text_align: event.target.value as TextField['text_align'],
                        })
                      }
                    >
                      <option value="left">왼쪽</option>
                      <option value="center">가운데</option>
                      <option value="right">오른쪽</option>
                    </select>
                  </label>
                  <div className="property-grid">
                    <label>
                      너비
                      <input
                        type="number"
                        min="20"
                        value={selectedField.width}
                        onChange={(event) =>
                          replaceField(selectedField.id, {
                            width: Math.max(20, Number(event.target.value)),
                          })
                        }
                      />
                    </label>
                    <label>
                      높이
                      <input
                        type="number"
                        min="20"
                        value={selectedField.height}
                        onChange={(event) =>
                          replaceField(selectedField.id, {
                            height: Math.max(20, Number(event.target.value)),
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="coordinate-readout">
                    위치: x {selectedField.x}, y {selectedField.y}
                  </div>
                  <button
                    className="button button--danger"
                    type="button"
                    onClick={handleDeleteField}
                  >
                    이 필드 삭제
                  </button>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </PageShell>
  );
}
