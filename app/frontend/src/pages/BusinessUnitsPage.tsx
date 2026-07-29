import { FormEvent, Fragment, useEffect, useState } from 'react';

import {
  createBusinessUnit,
  listBusinessUnits,
  type BusinessUnit,
  updateBusinessUnit,
} from '../api/businessUnits';
import { PageShell } from '../components/PageShell';

export function BusinessUnitsPage() {
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    listBusinessUnits(undefined, controller.signal)
      .then(({ business_units: nextBusinessUnits }) => {
        if (!isCurrent) return;
        setBusinessUnits(nextBusinessUnits);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setLoadError(error instanceof Error ? error.message : '사업부 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
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
      const { business_unit: created } = await createBusinessUnit(name.trim());
      setBusinessUnits((current) =>
        [...current, created].sort((left, right) => left.name.localeCompare(right.name, 'ko')),
      );
      setName('');
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '사업부를 추가하지 못했습니다.');
    } finally {
      setIsCreating(false);
    }
  }

  function startEditing(businessUnit: BusinessUnit) {
    setEditingId(businessUnit.id);
    setEditName(businessUnit.name);
    setUpdateError(null);
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    setIsUpdating(true);
    setUpdateError(null);

    try {
      const { business_unit: updated } = await updateBusinessUnit(editingId, {
        name: editName.trim(),
      });
      setBusinessUnits((current) =>
        current
          .map((businessUnit) => (businessUnit.id === updated.id ? updated : businessUnit))
          .sort((left, right) => left.name.localeCompare(right.name, 'ko')),
      );
      setEditingId(null);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : '사업부 이름을 수정하지 못했습니다.');
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleActiveToggle(businessUnit: BusinessUnit) {
    setIsUpdating(true);
    setUpdateError(null);

    try {
      const { business_unit: updated } = await updateBusinessUnit(businessUnit.id, {
        is_active: !businessUnit.is_active,
      });
      setBusinessUnits((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : '사업부 상태를 변경하지 못했습니다.');
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <PageShell
      title="사업부 관리"
      description="프로그램에서 사용할 사업부 이름과 활성 상태를 관리합니다."
      designSection="사업부 관리"
      showStubNote={false}
    >
      <div className="template-list-layout">
        <section className="content-card" aria-labelledby="business-unit-list-title">
          <div className="section-heading">
            <div>
              <h2 id="business-unit-list-title">사업부 목록</h2>
              <p>
                비활성 사업부는 기존 프로그램에는 유지되지만 새 프로그램에서는 선택할 수 없습니다.
              </p>
            </div>
            {!isLoading && !loadError ? (
              <span className="count-badge">{businessUnits.length}개</span>
            ) : null}
          </div>

          {isLoading ? <p className="state-message">사업부를 불러오는 중입니다…</p> : null}
          {loadError ? (
            <p className="state-message state-message--error" role="alert">
              {loadError}
            </p>
          ) : null}
          {!isLoading && !loadError && businessUnits.length === 0 ? (
            <div className="empty-state">
              <strong>등록된 사업부가 없습니다.</strong>
              <p>아래 양식에서 첫 사업부를 추가하세요.</p>
            </div>
          ) : null}
          {!isLoading && !loadError && businessUnits.length > 0 ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>상태</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {businessUnits.map((businessUnit) => (
                    <Fragment key={businessUnit.id}>
                      <tr>
                        <td>{businessUnit.name}</td>
                        <td>
                          <span className="status-badge">
                            {businessUnit.is_active ? '활성' : '비활성'}
                          </span>
                        </td>
                        <td>
                          <div className="standard-save-row">
                            <button
                              className="button button--secondary"
                              type="button"
                              onClick={() => startEditing(businessUnit)}
                              disabled={isUpdating}
                            >
                              수정
                            </button>
                            <button
                              className="button button--quiet"
                              type="button"
                              onClick={() => handleActiveToggle(businessUnit)}
                              disabled={isUpdating}
                            >
                              {businessUnit.is_active ? '비활성화' : '활성화'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {editingId === businessUnit.id ? (
                        <tr>
                          <td colSpan={3}>
                            <form className="stack-form" onSubmit={handleUpdate}>
                              <label>
                                사업부 이름
                                <input
                                  required
                                  maxLength={100}
                                  value={editName}
                                  onChange={(event) => setEditName(event.target.value)}
                                />
                              </label>
                              {updateError ? (
                                <p className="form-error" role="alert">
                                  {updateError}
                                </p>
                              ) : null}
                              <div className="standard-save-row">
                                <button
                                  className="button button--primary"
                                  type="submit"
                                  disabled={isUpdating || !editName.trim()}
                                >
                                  {isUpdating ? '저장 중…' : '저장'}
                                </button>
                                <button
                                  className="button button--secondary"
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() => setEditingId(null)}
                                >
                                  취소
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {updateError && !editingId ? (
            <p className="form-error" role="alert">
              {updateError}
            </p>
          ) : null}
        </section>

        <section
          className="content-card create-template-card"
          aria-labelledby="create-business-unit-title"
        >
          <div className="section-heading">
            <div>
              <h2 id="create-business-unit-title">새 사업부 추가</h2>
              <p>프로그램 생성과 조직 설정에서 선택할 사업부를 등록합니다.</p>
            </div>
          </div>
          <form className="stack-form" onSubmit={handleCreate}>
            <label>
              사업부 이름
              <input
                required
                maxLength={100}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setCreateError(null);
                }}
                placeholder="예: AX센터 EHS그룹"
              />
            </label>
            {createError ? (
              <p className="form-error" role="alert">
                {createError}
              </p>
            ) : null}
            <button
              className="button button--primary"
              type="submit"
              disabled={isCreating || !name.trim()}
            >
              {isCreating ? '추가 중…' : '사업부 추가'}
            </button>
          </form>
        </section>
      </div>
    </PageShell>
  );
}
