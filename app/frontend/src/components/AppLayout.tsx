import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

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
              대시보드
            </NavLink>
            <NavLink to="/programs/new">새 프로그램</NavLink>
            <NavLink to="/letter-templates">레터 템플릿</NavLink>
            <NavLink to="/org-settings">조직 설정</NavLink>
            <NavLink to="/audit-logs">감사 로그</NavLink>
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
