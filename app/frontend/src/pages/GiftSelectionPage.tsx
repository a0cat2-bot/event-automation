import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  confirmGiftDelivery,
  createGiftItem,
  listGiftItems,
  listGiftRecipients,
  selectGiftRecipients,
  type GiftItem,
  type GiftRecipient,
} from '../api/gifts';
import { PageShell } from '../components/PageShell';
import { resolveBackendAssetUrl } from '../config/api';
import { formatDateTime } from '../utils/format';

const GIFT_STATUS_LABELS: Record<GiftRecipient['gift_status'], string> = {
  selected: '선정됨',
  delivered: '수령완료',
  failed: '실패',
};

function giftStatusLabel(status: GiftRecipient['gift_status']) {
  return GIFT_STATUS_LABELS[status];
}

export function GiftSelectionPage() {
  const { programId = '' } = useParams();
  const [giftItems, setGiftItems] = useState<GiftItem[]>([]);
  const [recipients, setRecipients] = useState<GiftRecipient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [itemName, setItemName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemQuantity, setItemQuantity] = useState('10');
  const [itemImage, setItemImage] = useState<File | null>(null);
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [createItemError, setCreateItemError] = useState<string | null>(null);

  const [selectedGiftItemId, setSelectedGiftItemId] = useState('');
  const [minimumScore, setMinimumScore] = useState('3');
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [selectWarning, setSelectWarning] = useState<string | null>(null);
  const [confirmingRecipientId, setConfirmingRecipientId] = useState<string | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  const reload = useCallback(
    (signal?: AbortSignal) =>
      Promise.all([
        listGiftItems(programId, signal).then(({ gift_items: next }) => {
          setGiftItems(next);
          setSelectedGiftItemId((current) => current || next[0]?.id || '');
        }),
        listGiftRecipients(programId, signal).then(({ gift_recipients: next }) => {
          setRecipients(next);
        }),
      ]),
    [programId],
  );

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

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    setItemImage(event.target.files?.[0] ?? null);
  }

  async function handleCreateItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreatingItem(true);
    setCreateItemError(null);

    try {
      await createGiftItem(programId, {
        name: itemName.trim(),
        description: itemDescription.trim() || undefined,
        quantity: Number(itemQuantity),
        image: itemImage ?? undefined,
      });
      setItemName('');
      setItemDescription('');
      setItemQuantity('10');
      setItemImage(null);
      await reload();
    } catch (error) {
      setCreateItemError(error instanceof Error ? error.message : '상품을 등록하지 못했습니다.');
    } finally {
      setIsCreatingItem(false);
    }
  }

  async function handleSelect() {
    if (!selectedGiftItemId) return;
    setIsSelecting(true);
    setSelectError(null);
    setSelectWarning(null);

    try {
      const result = await selectGiftRecipients(programId, {
        gift_item_id: selectedGiftItemId,
        minimum_satisfaction_score: Number(minimumScore),
      });
      if (result.warning) setSelectWarning(result.warning);
      await reload();
    } catch (error) {
      setSelectError(error instanceof Error ? error.message : '상품 수령자를 선정하지 못했습니다.');
    } finally {
      setIsSelecting(false);
    }
  }

  async function handleDeliveryConfirmation(recipient: GiftRecipient) {
    const deliveryMethod = window.prompt('수령 방법을 입력하세요. (선택)');
    if (deliveryMethod === null) return;

    setConfirmingRecipientId(recipient.id);
    setDeliveryError(null);
    try {
      await confirmGiftDelivery(programId, recipient.id, {
        ...(deliveryMethod.trim() ? { delivery_method: deliveryMethod.trim() } : {}),
      });
      await reload();
    } catch (error) {
      setDeliveryError(error instanceof Error ? error.message : '수령 확인을 처리하지 못했습니다.');
    } finally {
      setConfirmingRecipientId(null);
    }
  }

  return (
    <PageShell
      title="상품 수령자 선정"
      description="먼저 상품을 등록(이름/이미지/수량)한 뒤, 만족도 설문을 완료하고 기준 점수 이상인 참여자 중 무작위로 수령자를 선정합니다."
      showStubNote={false}
    >
      <div className="content-card">
        <h2>상품 등록</h2>
        <form className="stack-form" onSubmit={handleCreateItem}>
          <label>
            상품 이름
            <input
              required
              value={itemName}
              onChange={(event) => setItemName(event.target.value)}
              placeholder="예: 스타벅스 기프티콘"
            />
          </label>
          <label>
            설명 (선택)
            <input
              value={itemDescription}
              onChange={(event) => setItemDescription(event.target.value)}
              placeholder="예: 아메리카노 톨 사이즈"
            />
          </label>
          <label>
            수량 (몇 명에게 줄지)
            <input
              required
              type="number"
              min={1}
              value={itemQuantity}
              onChange={(event) => setItemQuantity(event.target.value)}
            />
          </label>
          <label>
            이미지 (선택)
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} />
          </label>

          {createItemError ? (
            <p className="form-error" role="alert">
              {createItemError}
            </p>
          ) : null}

          <button
            className="button button--secondary"
            type="submit"
            disabled={isCreatingItem || !itemName.trim()}
          >
            {isCreatingItem ? '등록 중…' : '상품 등록'}
          </button>
        </form>
      </div>

      {giftItems.length > 0 ? (
        <div className="content-card">
          <h2>등록된 상품</h2>
          <div className="placeholder-grid">
            {giftItems.map((item) => (
              <article key={item.id}>
                {item.image_url ? (
                  <img
                    src={resolveBackendAssetUrl(item.image_url)}
                    alt={item.name}
                    style={{ width: '100%', borderRadius: '8px', marginBottom: '0.5rem' }}
                  />
                ) : null}
                <h2>{item.name}</h2>
                <p>
                  {item.description ? `${item.description} · ` : ''}
                  {item.selected_count} / {item.quantity}명 선정됨
                </p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div className="content-card">
        <h2>상품 수령자 선정 실행</h2>
        <label>
          선정할 상품
          <select
            value={selectedGiftItemId}
            onChange={(event) => setSelectedGiftItemId(event.target.value)}
          >
            {giftItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.selected_count}/{item.quantity})
              </option>
            ))}
          </select>
        </label>
        <label>
          최소 만족도 점수 (1~5)
          <input
            type="number"
            min={1}
            max={5}
            value={minimumScore}
            onChange={(event) => setMinimumScore(event.target.value)}
          />
        </label>

        {selectError ? (
          <p className="form-error" role="alert">
            {selectError}
          </p>
        ) : null}
        {selectWarning ? <p className="form-error">{selectWarning}</p> : null}

        <div className="standard-save-row" style={{ marginTop: '1rem' }}>
          <button
            className="button button--primary"
            type="button"
            onClick={handleSelect}
            disabled={isSelecting || !selectedGiftItemId}
          >
            {isSelecting ? '선정 중…' : '상품 수령자 선정'}
          </button>
        </div>
      </div>

      {isLoading ? <p className="state-message">불러오는 중입니다…</p> : null}
      {loadError ? (
        <p className="state-message state-message--error" role="alert">
          {loadError}
        </p>
      ) : null}

      {recipients.length > 0 ? (
        <div className="content-card">
          <h2>상품 수령자 ({recipients.length}명)</h2>
          {deliveryError ? (
            <p className="form-error" role="alert">
              {deliveryError}
            </p>
          ) : null}
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>상품</th>
                  <th>선정 사유</th>
                  <th>상태</th>
                  <th>선정 시각</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((recipient) => (
                  <tr key={recipient.id}>
                    <td>{recipient.name}</td>
                    <td>{recipient.email}</td>
                    <td>{recipient.gift_item_name ?? '-'}</td>
                    <td>{recipient.selection_reason}</td>
                    <td>
                      <div className="standard-save-row">
                        <span>{giftStatusLabel(recipient.gift_status)}</span>
                        {recipient.gift_status === 'selected' ? (
                          <button
                            className="button button--secondary"
                            type="button"
                            disabled={confirmingRecipientId === recipient.id}
                            onClick={() => handleDeliveryConfirmation(recipient)}
                          >
                            {confirmingRecipientId === recipient.id ? '처리 중…' : '수령 확인'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td>{formatDateTime(recipient.selected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
