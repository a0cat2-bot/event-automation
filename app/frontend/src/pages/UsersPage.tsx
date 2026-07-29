import { Fragment, useEffect, useState, type FormEvent } from 'react';

import { listBusinessUnits, type BusinessUnit } from '../api/businessUnits';
import { ROLE_LABELS, USER_ROLES, type UserRole } from '../api/session';
import { createUser, listUsers, updateUser, type AppUser } from '../api/users';
import { PageShell } from '../components/PageShell';

const ROLE_BADGE_CLASS: Record<UserRole, string> = {
  admin: 'status-badge status-badge--info',
  coordinator: 'status-badge status-badge--success',
  viewer: 'status-badge',
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: '조직 설정, 사업부, 사용자, 작업 히스토리까지 모두 관리합니다.',
  coordinator: '담당 사업부의 프로그램을 실제로 운영합니다.',
  viewer: '조회만 가능하며 아무것도 변경할 수 없습니다.',
};

export function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('coordinator');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('coordinator');
  const [editBusinessUnitIds, setEditBusinessUnitIds] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    Promise.all([listUsers(controller.signal), listBusinessUnits(undefined, controller.signal)])
      .then(([userResponse, businessUnitResponse]) => {
        if (!isCurrent) return;
        setUsers(userResponse.users);
        setBusinessUnits(businessUnitResponse.business_units);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setLoadError(error instanceof Error ? error.message : '사용자를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setIsCreating(true);
    setCreateError(null);
    try {
      const { user } = await createUser({
        email: newEmail.trim(),
        name: newName.trim() || undefined,
        role: newRole,
      });
      setUsers((current) => [...current, user]);
      setNewEmail('');
      setNewName('');
      setNewRole('coordinator');
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '사용자를 추가하지 못했습니다.');
    } finally {
      setIsCreating(false);
    }
  }

  function startEditing(user: AppUser) {
    setEditingId(user.id);
    setEditRole(user.role);
    setEditBusinessUnitIds(user.business_unit_ids);
    setUpdateError(null);
  }

  async function handleUpdate(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setIsUpdating(true);
    setUpdateError(null);
    try {
      const { user } = await updateUser(editingId, {
        role: editRole,
        business_unit_ids: editBusinessUnitIds,
      });
      setUsers((current) => current.map((item) => (item.id === user.id ? user : item)));
      setEditingId(null);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : '사용자를 수정하지 못했습니다.');
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleActiveToggle(user: AppUser) {
    setIsUpdating(true);
    setUpdateError(null);
    try {
      const { user: updated } = await updateUser(user.id, { is_active: !user.is_active });
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : '상태를 변경하지 못했습니다.');
    } finally {
      setIsUpdating(false);
    }
  }

  function toggleBusinessUnit(id: string) {
    setEditBusinessUnitIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function businessUnitSummary(user: AppUser): string {
    if (user.role === 'admin' || user.business_unit_ids.length === 0) return '전체';
    const names = user.business_unit_ids
      .map((id) => businessUnits.find((unit) => unit.id === id)?.name)
      .filter(Boolean);
    return names.length > 0 ? names.join(', ') : '전체';
  }

  return (
    <PageShell
      title="사용자 관리"
      description="사내 인증을 통과한 계정에 어떤 권한을 줄지 관리합니다. 비밀번호는 이 앱에 저장되지 않습니다."
      designSection="사용자 관리"
      showStubNote={false}
    >
      <div className="template-list-layout">
        <section className="content-card" aria-labelledby="user-list-title">
          <div className="section-heading">
            <div>
              <h2 id="user-list-title">사용자 목록</h2>
              <p>등록되지 않은 계정은 로그인해도 접근이 거부됩니다.</p>
            </div>
            {!isLoading && !loadError ? (
              <span className="count-badge">{users.length}명</span>
            ) : null}
          </div>

          {isLoading ? <p className="state-message">사용자를 불러오는 중입니다…</p> : null}
          {loadError ? (
            <p className="state-message state-message--error" role="alert">
              {loadError}
            </p>
          ) : null}
          {updateError ? (
            <p className="form-error" role="alert">
              {updateError}
            </p>
          ) : null}
          {!isLoading && !loadError && users.length === 0 ? (
            <div className="empty-state">
              <strong>등록된 사용자가 없습니다.</strong>
              <p>오른쪽 양식에서 첫 관리자를 추가하세요.</p>
            </div>
          ) : null}

          {!isLoading && !loadError && users.length > 0 ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>계정</th>
                    <th>권한</th>
                    <th>담당 사업부</th>
                    <th>상태</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <Fragment key={user.id}>
                      <tr>
                        <td>
                          {user.name ? <strong>{user.name}</strong> : null}
                          <div className="table-subtext">{user.email}</div>
                        </td>
                        <td>
                          <span className={ROLE_BADGE_CLASS[user.role]}>
                            {ROLE_LABELS[user.role]}
                          </span>
                        </td>
                        <td>{businessUnitSummary(user)}</td>
                        <td>
                          <span
                            className={
                              user.is_active
                                ? 'status-badge status-badge--success'
                                : 'status-badge'
                            }
                          >
                            {user.is_active ? '활성' : '비활성'}
                          </span>
                        </td>
                        <td>
                          <div className="standard-save-row">
                            <button
                              className="button button--secondary"
                              type="button"
                              onClick={() => startEditing(user)}
                              disabled={isUpdating}
                            >
                              권한 수정
                            </button>
                            <button
                              className="button button--quiet"
                              type="button"
                              onClick={() => handleActiveToggle(user)}
                              disabled={isUpdating}
                            >
                              {user.is_active ? '비활성화' : '활성화'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {editingId === user.id ? (
                        <tr>
                          <td colSpan={5}>
                            <form className="stack-form" onSubmit={handleUpdate}>
                              <label>
                                권한
                                <select
                                  value={editRole}
                                  onChange={(event) => setEditRole(event.target.value as UserRole)}
                                >
                                  {USER_ROLES.map((role) => (
                                    <option key={role} value={role}>
                                      {ROLE_LABELS[role]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <p className="field-hint">{ROLE_DESCRIPTIONS[editRole]}</p>

                              {editRole === 'admin' ? (
                                <p className="field-hint">
                                  관리자는 모든 사업부에 접근합니다.
                                </p>
                              ) : (
                                <fieldset className="checkbox-set">
                                  <legend>담당 사업부</legend>
                                  <p className="field-hint">
                                    아무것도 선택하지 않으면 전체 사업부에 접근합니다.
                                  </p>
                                  {businessUnits.map((unit) => (
                                    <label key={unit.id} className="checkbox-row">
                                      <input
                                        type="checkbox"
                                        checked={editBusinessUnitIds.includes(unit.id)}
                                        onChange={() => toggleBusinessUnit(unit.id)}
                                      />
                                      {unit.name}
                                    </label>
                                  ))}
                                </fieldset>
                              )}

                              <div className="standard-save-row">
                                <button
                                  className="button button--primary"
                                  type="submit"
                                  disabled={isUpdating}
                                >
                                  {isUpdating ? '저장 중…' : '저장'}
                                </button>
                                <button
                                  className="button button--quiet"
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  disabled={isUpdating}
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
        </section>

        <section className="content-card" aria-labelledby="user-create-title">
          <h2 id="user-create-title">사용자 추가</h2>
          <p>사내 인증에서 사용하는 이메일과 동일하게 입력하세요.</p>
          <form className="stack-form" onSubmit={handleCreate}>
            <label>
              이메일
              <input
                required
                type="email"
                maxLength={255}
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                placeholder="gildong.hong@samsung.com"
              />
            </label>
            <label>
              이름 (선택)
              <input
                maxLength={255}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="홍길동"
              />
            </label>
            <label>
              권한
              <select
                value={newRole}
                onChange={(event) => setNewRole(event.target.value as UserRole)}
              >
                {USER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-hint">{ROLE_DESCRIPTIONS[newRole]}</p>
            {createError ? (
              <p className="form-error" role="alert">
                {createError}
              </p>
            ) : null}
            <button
              className="button button--primary"
              type="submit"
              disabled={isCreating || !newEmail.trim()}
            >
              {isCreating ? '추가 중…' : '사용자 추가'}
            </button>
          </form>
        </section>
      </div>
    </PageShell>
  );
}
