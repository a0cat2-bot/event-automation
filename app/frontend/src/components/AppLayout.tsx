import { IconChevronDown, IconUser } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

const ADMIN_LINKS = [
  { to: '/letter-templates', label: '레터 템플릿' },
  { to: '/business-units', label: '사업부 관리' },
  { to: '/org-settings', label: '조직 설정' },
  { to: '/audit-logs', label: '작업 히스토리' },
];

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
  const [isOpen, setIsOpen] = useState(false);
  const isActive = ADMIN_LINKS.some((link) => location.pathname.startsWith(link.to));
  const containerRef = useClickOutside(() => setIsOpen(false));

  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  return (
    <div className="admin-menu" ref={containerRef}>
      <button
        type="button"
        className={isActive ? 'active' : undefined}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        관리
        <IconChevronDown
          size={14}
          stroke={2}
          className={isOpen ? 'chevron chevron--open' : 'chevron'}
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <div className="admin-menu__panel">
          {ADMIN_LINKS.map((link) => (
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
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useClickOutside(() => setIsOpen(false));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const initials = actorInitials(actorName);

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
        <span className="actor-chip__name">{actorName || '작업자 미설정'}</span>
        <IconChevronDown
          size={14}
          stroke={2}
          className={isOpen ? 'chevron chevron--open' : 'chevron'}
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <div className="actor-chip__panel">
          <label htmlFor="actor-name-input">작업자 이름</label>
          <input
            id="actor-name-input"
            ref={inputRef}
            value={actorName}
            onChange={(event) => onActorNameChange(event.target.value)}
            placeholder="작업자 이름 입력"
          />
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
