import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

const ADMIN_LINKS = [
  { to: '/letter-templates', label: '레터 템플릿' },
  { to: '/business-units', label: '사업부 관리' },
  { to: '/org-settings', label: '조직 설정' },
  { to: '/audit-logs', label: '작업 히스토리' },
];

function AdminMenu() {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isActive = ADMIN_LINKS.some((link) => location.pathname.startsWith(link.to));

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

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
        관리 {isOpen ? '▲' : '▼'}
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
          <label className="actor-name-field">
            작업자:
            <input
              value={actorName}
              onChange={(event) => handleActorNameChange(event.target.value)}
              placeholder="작업자 이름 입력"
            />
          </label>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
