import { NavLink, Outlet } from 'react-router-dom';

export function AppLayout() {
  return (
    <div className="app-layout">
      <header className="app-header">
        <NavLink className="brand" to="/">
          EHS Program Automation
        </NavLink>
        <nav aria-label="Primary navigation">
          <NavLink end to="/">
            Dashboard
          </NavLink>
          <NavLink to="/programs/new">New program</NavLink>
          <NavLink to="/letter-templates">Letter templates</NavLink>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
