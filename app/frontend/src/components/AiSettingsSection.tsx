import { useEffect, useState } from 'react';

import {
  AI_FEATURES,
  AI_FEATURE_DESCRIPTIONS,
  AI_FEATURE_LABELS,
  getAiSettings,
  updateAiSettings,
  type AiFeature,
  type AiSettings,
} from '../api/aiSettings';
import { useSession } from './SessionContext';
import { ToggleSwitch } from './ToggleSwitch';

const PROVIDER_LABELS: Record<string, string> = {
  disabled: '사용 안 함',
  claude: 'Claude (외부 API)',
  ai_pro: 'AI Pro (사내)',
};

export function AiSettingsSection() {
  const canEdit = useSession().allows('admin');
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingFeature, setSavingFeature] = useState<AiFeature | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    getAiSettings(controller.signal)
      .then((next) => {
        if (!isCurrent) return;
        setSettings(next);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setLoadError(error instanceof Error ? error.message : 'AI 설정을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, []);

  async function handleToggle(feature: AiFeature, next: boolean) {
    setSavingFeature(feature);
    setSaveError(null);
    try {
      const updated = await updateAiSettings({ [feature]: next });
      setSettings(updated);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'AI 설정을 저장하지 못했습니다.');
    } finally {
      setSavingFeature(null);
    }
  }

  const isConfigured = settings?.configured ?? false;

  return (
    <section className="content-card" aria-labelledby="ai-settings-title">
      <div className="section-heading">
        <div>
          <h2 id="ai-settings-title">AI 기능</h2>
          <p>
            기능별로 AI 사용 여부를 선택합니다. 꺼져 있으면 기존 규칙 기반 방식으로 동작하며, 업무는
            그대로 진행됩니다.
          </p>
        </div>
        <span className={isConfigured ? 'status-badge status-badge--success' : 'status-badge'}>
          {PROVIDER_LABELS[settings?.provider ?? 'disabled'] ?? settings?.provider}
        </span>
      </div>

      {isLoading ? <p className="state-message">AI 설정을 불러오는 중입니다…</p> : null}
      {loadError ? (
        <p className="state-message state-message--error" role="alert">
          {loadError}
        </p>
      ) : null}

      {!isLoading && !loadError && settings ? (
        <>
          {!isConfigured ? (
            <p className="field-hint field-hint--warning">
              서버에 AI 제공자가 설정되어 있지 않아 기능을 켤 수 없습니다. 관리자가 서버의{' '}
              <code>LLM_PROVIDER</code>와 인증 정보를 설정하면 여기에서 켤 수 있습니다.
            </p>
          ) : null}
          {!canEdit ? (
            <p className="field-hint">변경하려면 관리자 권한이 필요합니다.</p>
          ) : null}
          {saveError ? (
            <p className="form-error" role="alert">
              {saveError}
            </p>
          ) : null}

          <div className="precaution-list">
            {AI_FEATURES.map((feature) => (
              <label className="switch-row" key={feature}>
                <span className="switch-row__text">
                  <strong>{AI_FEATURE_LABELS[feature]}</strong>
                  <span className="field-hint">{AI_FEATURE_DESCRIPTIONS[feature]}</span>
                </span>
                <ToggleSwitch
                  checked={settings.flags[feature]}
                  disabled={!canEdit || !isConfigured || savingFeature !== null}
                  onChange={(next) => handleToggle(feature, next)}
                />
              </label>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
