import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';

import {
  getOrgSettings,
  type OrgSettings,
  updateOrgSettings,
  uploadOrgSettingsCharacterImage,
} from '../api/letterTemplates';
import { listPrograms } from '../api/programs';
import { PageShell } from '../components/PageShell';
import { resolveBackendAssetUrl } from '../config/api';

export function OrgSettingsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [businessUnits, setBusinessUnits] = useState<string[]>([]);
  const [selectedBusinessUnit, setSelectedBusinessUnit] = useState('');
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [characterImage, setCharacterImage] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [imageMessage, setImageMessage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [businessUnitError, setBusinessUnitError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    listPrograms(controller.signal)
      .then(({ programs }) => {
        if (!isCurrent) return;
        const units = [
          ...new Set(
            programs
              .map((program) => program.business_unit.trim())
              .filter((businessUnit) => businessUnit.length > 0),
          ),
        ].sort((left, right) => left.localeCompare(right, 'ko'));
        setBusinessUnits(units);
        setBusinessUnitError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setBusinessUnitError(
          error instanceof Error ? error.message : '사업부 목록을 불러오지 못했습니다.',
        );
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    setIsLoading(true);
    setSettings(null);
    setLoadError(null);
    setNameMessage(null);
    setNameError(null);
    setImageMessage(null);
    setImageError(null);
    setCharacterImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    getOrgSettings(controller.signal, selectedBusinessUnit)
      .then(({ org_settings: nextSettings }) => {
        if (!isCurrent) return;
        setSettings(nextSettings);
        setDisplayName(nextSettings.org_display_name);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setLoadError(error instanceof Error ? error.message : '조직 설정을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [selectedBusinessUnit]);

  async function handleNameSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingName(true);
    setNameMessage(null);
    setNameError(null);

    try {
      const { org_settings: nextSettings } = await updateOrgSettings(
        {
          org_display_name: displayName.trim(),
        },
        selectedBusinessUnit,
      );
      setSettings(nextSettings);
      setDisplayName(nextSettings.org_display_name);
      setNameMessage('저장되었습니다.');
    } catch (error) {
      setNameError(error instanceof Error ? error.message : '조직 이름을 저장하지 못했습니다.');
    } finally {
      setIsSavingName(false);
    }
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    setCharacterImage(event.target.files?.[0] ?? null);
    setImageMessage(null);
    setImageError(null);
  }

  async function handleImageUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!characterImage) return;

    setIsUploading(true);
    setImageMessage(null);
    setImageError(null);

    try {
      const { org_settings: nextSettings } = await uploadOrgSettingsCharacterImage(
        characterImage,
        selectedBusinessUnit,
      );
      setSettings(nextSettings);
      setDisplayName(nextSettings.org_display_name);
      setCharacterImage(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setImageMessage('업로드되었습니다.');
    } catch (error) {
      setImageError(
        error instanceof Error ? error.message : '캐릭터 이미지를 업로드하지 못했습니다.',
      );
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <PageShell
      title="조직 설정"
      description="표준 레터에 표시할 조직 이름과 캐릭터 이미지를 관리합니다."
      designSection="조직 설정"
      showStubNote={false}
    >
      {isLoading ? <p className="state-message">조직 설정을 불러오는 중입니다…</p> : null}
      {loadError ? (
        <p className="state-message state-message--error" role="alert">
          {loadError}
        </p>
      ) : null}

      <section className="content-card org-unit-selector" aria-labelledby="org-unit-title">
        <div className="section-heading">
          <div>
            <h2 id="org-unit-title">사업부</h2>
            <p>사업부별 레터 표시 설정을 선택하세요. 전용 설정이 없으면 기본값을 사용합니다.</p>
          </div>
        </div>
        <label>
          설정 대상
          <select
            value={selectedBusinessUnit}
            onChange={(event) => setSelectedBusinessUnit(event.target.value)}
          >
            <option value="">기본값</option>
            {businessUnits.map((businessUnit) => (
              <option key={businessUnit} value={businessUnit}>
                {businessUnit}
              </option>
            ))}
          </select>
        </label>
        {businessUnitError ? (
          <p className="form-error" role="alert">
            {businessUnitError}
          </p>
        ) : null}
      </section>

      {!isLoading && !loadError && settings ? (
        <>
          {selectedBusinessUnit && settings.business_unit !== selectedBusinessUnit ? (
            <p className="state-message">
              이 사업부의 전용 설정이 없어 현재 기본값을 표시합니다. 저장하거나 이미지를 업로드하면
              이 사업부만의 설정이 만들어집니다.
            </p>
          ) : null}
          <div className="org-settings-layout">
            <section className="content-card" aria-labelledby="org-name-title">
              <div className="section-heading">
                <div>
                  <h2 id="org-name-title">조직 이름</h2>
                  <p>표준 레터 미리보기와 발송 레터에 표시되는 이름입니다.</p>
                </div>
              </div>
              <form className="stack-form" onSubmit={handleNameSave}>
                <label>
                  표시 이름
                  <input
                    required
                    value={displayName}
                    onChange={(event) => {
                      setDisplayName(event.target.value);
                      setNameMessage(null);
                      setNameError(null);
                    }}
                  />
                </label>
                {nameError ? (
                  <p className="form-error" role="alert">
                    {nameError}
                  </p>
                ) : null}
                {nameMessage ? (
                  <strong className="save-success" aria-live="polite">
                    {nameMessage}
                  </strong>
                ) : null}
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={isSavingName || !displayName.trim()}
                >
                  {isSavingName ? '저장 중…' : '이름 저장'}
                </button>
              </form>
            </section>

            <section className="content-card" aria-labelledby="character-image-title">
              <div className="section-heading">
                <div>
                  <h2 id="character-image-title">캐릭터 이미지</h2>
                  <p>표준 레터 오른쪽 위에 표시됩니다.</p>
                </div>
              </div>
              <div className="org-character-preview">
                {settings.character_image_url ? (
                  <img
                    src={resolveBackendAssetUrl(settings.character_image_url)}
                    alt="현재 조직 캐릭터"
                  />
                ) : (
                  <span>등록된 이미지가 없습니다.</span>
                )}
              </div>
              <form className="stack-form org-image-form" onSubmit={handleImageUpload}>
                <label>
                  새 이미지
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleImageChange}
                  />
                </label>
                {imageError ? (
                  <p className="form-error" role="alert">
                    {imageError}
                  </p>
                ) : null}
                {imageMessage ? (
                  <strong className="save-success" aria-live="polite">
                    {imageMessage}
                  </strong>
                ) : null}
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={isUploading || !characterImage}
                >
                  {isUploading ? '업로드 중…' : '이미지 업로드'}
                </button>
              </form>
            </section>
          </div>
        </>
      ) : null}
    </PageShell>
  );
}
