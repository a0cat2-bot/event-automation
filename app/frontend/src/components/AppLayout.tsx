import { IconChevronDown, IconDots, IconUser } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { ROLE_LABELS, type UserRole } from '../api/session';
import { useSession } from './SessionContext';

/** `minRole` is the role the corresponding screen requires, matching the backend route guards. */
const ADMIN_LINKS: Array<{ to: string; label: string; minRole: UserRole }> = [
  { to: '/letter-templates', label: '레터 템플릿', minRole: 'coordinator' },
  { to: '/business-units', label: '사업부 관리', minRole: 'admin' },
  { to: '/org-settings', label: '조직 설정', minRole: 'admin' },
  { to: '/users', label: '사용자 관리', minRole: 'admin' },
  { to: '/cycle-metrics', label: '운영 소요 시간', minRole: 'admin' },
  { to: '/audit-logs', label: '작업 히스토리', minRole: 'admin' },
];

const ROLE_BADGE_CLASS: Record<UserRole, string> = {
  admin: 'status-badge status-badge--info',
  coordinator: 'status-badge status-badge--success',
  viewer: 'status-badge',
};

function useClickOutside(onOutsideClick: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onOutsideClick();
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [onOutsideClick]);

  return containerRef;
}

function AdminMenu() {
  const location = useLocation();
  const { allows } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useClickOutside(() => setIsOpen(false));

  // Only offer screens this role can actually open, so nobody navigates into a 403.
  const visibleLinks = ADMIN_LINKS.filter((link) => allows(link.minRole));
  const isActive = visibleLinks.some((link) => location.pathname.startsWith(link.to));

  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  if (visibleLinks.length === 0) return null;

  return (
    <div className="admin-menu" ref={containerRef}>
      <button
        type="button"
        className={isActive ? 'admin-menu__trigger active' : 'admin-menu__trigger'}
        aria-expanded={isOpen}
        aria-label="관리"
        title="관리"
        onClick={() => setIsOpen((open) => !open)}
      >
        <IconDots size={18} stroke={2} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="admin-menu__panel">
          {visibleLinks.map((link) => (
            <NavLink key={link.to} to={link.to}>
              {link.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function actorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function ActorChip({
  actorName,
  onActorNameChange,
}: {
  actorName: string;
  onActorNameChange: (value: string) => void;
}) {
  const { session } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useClickOutside(() => setIsOpen(false));
  const inputRef = useRef<HTMLInputElement>(null);

  // With access control on, identity comes from the SSO gateway and is not editable here. Without
  // it, the actor is a self-declared name and the chip stays a text field, as before.
  const signedInUser = session?.authEnforced ? session.user : null;
  const isEditable = !session?.authEnforced;
  // Kept separate from the label below: initials must come from a real name, never from the
  // "not set" placeholder, which would render a meaningless two-character avatar.
  const identityName = signedInUser ? (signedInUser.name ?? signedInUser.email) : actorName;
  const displayName = identityName || '작업자 미설정';

  useEffect(() => {
    if (isOpen && isEditable) inputRef.current?.focus();
  }, [isOpen, isEditable]);

  const initials = actorInitials(identityName);

  return (
    <div className="actor-chip" ref={containerRef}>
      <button
        type="button"
        className="actor-chip__trigger"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="actor-chip__avatar">
          {initials || <IconUser size={14} stroke={2} aria-hidden="true" />}
        </span>
        <span className="actor-chip__name">{displayName}</span>
        {signedInUser ? (
          <span className={ROLE_BADGE_CLASS[signedInUser.role]}>
            {ROLE_LABELS[signedInUser.role]}
          </span>
        ) : null}
        <IconChevronDown
          size={14}
          stroke={2}
          className={isOpen ? 'chevron chevron--open' : 'chevron'}
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <div className="actor-chip__panel">
          {isEditable ? (
            <>
              <label htmlFor="actor-name-input">작업자 이름</label>
              <input
                id="actor-name-input"
                ref={inputRef}
                value={actorName}
                onChange={(event) => onActorNameChange(event.target.value)}
                placeholder="작업자 이름 입력"
              />
            </>
          ) : (
            <dl className="actor-chip__identity">
              <dt>계정</dt>
              <dd>{signedInUser?.email ?? '로그인되지 않음'}</dd>
              <dt>권한</dt>
              <dd>{signedInUser ? ROLE_LABELS[signedInUser.role] : '없음'}</dd>
            </dl>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function AppLayout() {
  const [actorName, setActorName] = useState('');

  useEffect(() => {
    setActorName(localStorage.getItem('actorName') ?? '');
  }, []);

  function handleActorNameChange(value: string) {
    setActorName(value);
    localStorage.setItem('actorName', value);
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        <NavLink className="brand" to="/">
          {/* Adopters should replace this with their own program or brand name. */}
          Program Automation
        </NavLink>
        <div className="header-controls">
          <nav aria-label="주요 메뉴">
            <NavLink end to="/">
              프로그램
            </NavLink>
            <AdminMenu />
          </nav>
          <ActorChip actorName={actorName} onActorNameChange={handleActorNameChange} />
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
