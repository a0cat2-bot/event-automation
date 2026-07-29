import { IconChevronDown } from '@tabler/icons-react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { listApplicants, type Applicant } from '../api/applicants';
import {
  getLetterCategories,
  getLetterTemplates,
  type LetterCategory,
  type LetterTemplate,
} from '../api/letterTemplates';
import {
  getNotificationHistory,
  listParticipants,
  notifyParticipant,
  type NotificationHistoryEntry,
  type Participant,
} from '../api/participants';
import { PageShell } from '../components/PageShell';
import { ProgramContextBar } from '../components/ProgramContextBar';
import { formatDateTime } from '../utils/format';

const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  recruitment: '모집 안내',
  notification: '선정 결과 안내',
  gift_notification: '기프트 안내',
};

// Categories whose audience is narrower than "everyone currently selected" — sending them to
// the wrong person is the kind of mistake this page exists to prevent (e.g. a 미당첨 안내
// going to someone who WAS selected). 참여자 선정 자체가 안 된 신청자에게는 이 화면에서 보내는
// 발송 파이프라인 자체가 없어서(참여자 단위로만 발송 이력을 추적), 미당첨 안내는 발송 대상
// 표시만 하고 실제 발송 버튼은 제공하지 않는다.
const NON_SELECTION_CATEGORY_SLUG = 'non_selection_notice';
const GIFT_PICKUP_CATEGORY_SLUG = 'gift_pickup_notice';

export function SelectionReviewSurveySendingPage() {
  const { programId = '' } = useParams();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [templates, setTemplates] = useState<LetterTemplate[]>([]);
  const [categories, setCategories] = useState<LetterCategory[]>([]);
  const [history, setHistory] = useState<NotificationHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);

  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [bulkSendingTemplateId, setBulkSendingTemplateId] = useState<string | null>(null);

  const reload = useCallback(
    (signal?: AbortSignal) =>
      Promise.all([
        listParticipants(programId, signal).then(({ participants: next }) => setParticipants(next)),
        listApplicants(programId, signal).then(({ applicants: next }) => setApplicants(next)),
        getLetterTemplates(signal).then(({ templates: next }) =>
          setTemplates(next.filter((template) => template.template_type !== 'recruitment')),
        ),
        getLetterCategories(signal).then(({ categories: next }) => setCategories(next)),
        getNotificationHistory(programId, signal).then(({ history: next }) => setHistory(next)),
      ]),
    [programId],
  );

  const categorySlugById = new Map(categories.map((category) => [category.id, category.slug]));
  const categoryDisplayNameById = new Map(
    categories.map((category) => [category.id, category.display_name]),
  );

  // The category (미당첨 안내, 당첨 안내, 만족도 설문, ...) is far more useful here than the
  // coarse template_type — almost every notification-stage template shares template_type
  // 'notification', so showing that alone made every row read as "선정 결과 안내".
  function typeLabelFor(template: LetterTemplate): string {
    const categoryLabel = template.category_id
      ? categoryDisplayNameById.get(template.category_id)
      : undefined;
    return categoryLabel ?? TEMPLATE_TYPE_LABELS[template.template_type] ?? template.template_type;
  }
  const selectedApplicantIds = new Set(participants.map((participant) => participant.applicant_id));
  const nonSelectedApplicants = applicants.filter(
    (applicant) => !selectedApplicantIds.has(applicant.id),
  );

  function audienceFor(template: LetterTemplate): Participant[] {
    const slug = template.category_id ? categorySlugById.get(template.category_id) : undefined;
    if (slug === GIFT_PICKUP_CATEGORY_SLUG) {
      return participants.filter((participant) => participant.gift_status !== 'not_selected');
    }
    return participants;
  }

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    reload(controller.signal)
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
  }, [programId, reload]);

  function statusFor(templateId: string, participantId: string) {
    return history.find(
      (entry) => entry.template_id === templateId && entry.participant_id === participantId,
    );
  }

  function summaryFor(templateId: string, audience: Participant[]) {
    let sent = 0;
    let failed = 0;
    let latestSentAt: string | null = null;
    for (const participant of audience) {
      const entry = statusFor(templateId, participant.id);
      if (entry?.status === 'sent') {
        sent += 1;
        if (!latestSentAt || entry.sent_at > latestSentAt) latestSentAt = entry.sent_at;
      } else if (entry?.status === 'failed') {
        failed += 1;
      }
    }
    return { sent, failed, pending: audience.length - sent - failed, latestSentAt };
  }

  async function handleSend(templateId: string, participantId: string) {
    const key = `${templateId}:${participantId}`;
    setSendingKey(key);
    setRowErrors((current) => ({ ...current, [key]: '' }));

    try {
      await notifyParticipant(programId, participantId, templateId);
      await reload();
    } catch (error) {
      setRowErrors((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : '발송하지 못했습니다.',
      }));
    } finally {
      setSendingKey(null);
    }
  }

  async function handleBulkSend(templateId: string, audience: Participant[]) {
    const pending = audience.filter((participant) => {
      const entry = statusFor(templateId, participant.id);
      return !entry || entry.status !== 'sent';
    });
    setBulkSendingTemplateId(templateId);

    for (const participant of pending) {
      try {
        await notifyParticipant(programId, participant.id, templateId);
      } catch (error) {
        setRowErrors((current) => ({
          ...current,
          [`${templateId}:${participant.id}`]:
            error instanceof Error ? error.message : '발송하지 못했습니다.',
        }));
      }
    }

    await reload();
    setBulkSendingTemplateId(null);
  }

  return (
    <PageShell
      title="안내메일 발송"
      designSection="안내메일 발송"
      description="레터 유형별로 어디까지 발송했는지 확인하고, 펼쳐서 개별 또는 일괄로 발송합니다."
      showStubNote={false}
    >
      <ProgramContextBar programId={programId} />
      {isLoading ? <p className="state-message">불러오는 중입니다…</p> : null}
      {loadError ? (
        <p className="state-message state-message--error" role="alert">
          {loadError}
        </p>
      ) : null}

      {participants.length === 0 && !isLoading ? (
        <div className="empty-state">
          <strong>선정된 참여자가 없습니다.</strong>
          <p>먼저 참여자 선정을 실행해주세요.</p>
        </div>
      ) : null}

      {participants.length > 0 ? (
        <div className="content-card">
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>템플릿</th>
                  <th>유형</th>
                  <th>발송됨</th>
                  <th>대기</th>
                  <th>실패</th>
                  <th>최근 발송</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => {
                  const templateId = String(template.id);
                  const categorySlug = template.category_id
                    ? categorySlugById.get(template.category_id)
                    : undefined;
                  const isNonSelectionNotice = categorySlug === NON_SELECTION_CATEGORY_SLUG;
                  const audience = audienceFor(template);
                  const summary = summaryFor(templateId, audience);
                  const isExpanded = expandedTemplateId === templateId;
                  return (
                    <Fragment key={template.id}>
                      <tr className={isExpanded ? 'notification-row--expanded' : undefined}>
                        <td>{template.name}</td>
                        <td>{typeLabelFor(template)}</td>
                        {isNonSelectionNotice ? (
                          <td colSpan={4} className="field-hint">
                            미선정 신청자 {nonSelectedApplicants.length}명 대상 — 이 화면에서는
                            선정된 참여자만 발송할 수 있어 발송할 수 없습니다.
                          </td>
                        ) : (
                          <>
                            <td>{summary.sent}명</td>
                            <td>{summary.pending}명</td>
                            <td>{summary.failed}명</td>
                            <td>
                              {summary.latestSentAt ? formatDateTime(summary.latestSentAt) : '-'}
                            </td>
                          </>
                        )}
                        <td>
                          <button
                            className="button button--quiet"
                            type="button"
                            onClick={() => setExpandedTemplateId(isExpanded ? null : templateId)}
                          >
                            {isExpanded ? '접기' : '펼치기'}
                            <IconChevronDown
                              size={14}
                              stroke={2}
                              className={isExpanded ? 'chevron chevron--open' : 'chevron'}
                              aria-hidden="true"
                            />
                          </button>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="notification-detail-row">
                          <td colSpan={7}>
                            <div className="notification-detail-panel">
                              <div className="section-heading">
                                <div>
                                  <h2>{template.name}</h2>
                                  <p>
                                    {typeLabelFor(template)} · {template.brand_variant}
                                  </p>
                                </div>
                                {!isNonSelectionNotice ? (
                                  <div className="editor-actions">
                                    <button
                                      className="button button--secondary"
                                      type="button"
                                      disabled={
                                        bulkSendingTemplateId === templateId ||
                                        summary.pending === 0
                                      }
                                      onClick={() => handleBulkSend(templateId, audience)}
                                    >
                                      {bulkSendingTemplateId === templateId
                                        ? '전체 발송 중…'
                                        : '미발송자 전체 발송'}
                                    </button>
                                  </div>
                                ) : null}
                              </div>

                              {isNonSelectionNotice ? (
                                <>
                                  <p className="field-hint">
                                    이 템플릿은 미선정 신청자용입니다. 참여자 단위로만 발송 이력을
                                    추적하는 현재 구조상 이 화면에서 바로 보낼 수는 없고, 대상자
                                    명단만 참고용으로 보여줍니다.
                                  </p>
                                  {nonSelectedApplicants.length === 0 ? (
                                    <p className="state-message">미선정 신청자가 없습니다.</p>
                                  ) : (
                                    <div style={{ overflowX: 'auto' }}>
                                      <table>
                                        <thead>
                                          <tr>
                                            <th>이름</th>
                                            <th>이메일</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {nonSelectedApplicants.map((applicant) => (
                                            <tr key={applicant.id}>
                                              <td>{applicant.name}</td>
                                              <td>{applicant.email}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </>
                              ) : (
                              <div style={{ overflowX: 'auto' }}>
                                <table>
                                  <thead>
                                    <tr>
                                      <th>이름</th>
                                      <th>이메일</th>
                                      <th>상태</th>
                                      <th>발송 시각</th>
                                      <th></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {audience.map((participant) => {
                                      const key = `${templateId}:${participant.id}`;
                                      const entry = statusFor(templateId, participant.id);
                                      const isSent = entry?.status === 'sent';
                                      return (
                                        <tr key={participant.id}>
                                          <td>{participant.name}</td>
                                          <td>{participant.email}</td>
                                          <td>
                                            {isSent
                                              ? '발송됨'
                                              : entry?.status === 'failed'
                                                ? '실패'
                                                : '대기'}
                                          </td>
                                          <td>
                                            {entry ? formatDateTime(entry.sent_at) : '-'}
                                          </td>
                                          <td>
                                            <button
                                              className="button button--secondary"
                                              type="button"
                                              disabled={
                                                sendingKey === key ||
                                                bulkSendingTemplateId === templateId
                                              }
                                              onClick={() => handleSend(templateId, participant.id)}
                                            >
                                              {sendingKey === key
                                                ? '발송 중…'
                                                : isSent
                                                  ? '다시 발송'
                                                  : '발송'}
                                            </button>
                                            {rowErrors[key] ? (
                                              <p className="form-error" role="alert">
                                                {rowErrors[key]}
                                              </p>
                                            ) : null}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
