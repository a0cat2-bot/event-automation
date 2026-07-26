import type { PropsWithChildren } from 'react';

import { API_BASE_URL } from '../config/api';

type PageShellProps = PropsWithChildren<{
  title: string;
  description: string;
  designSection?: string;
  showStubNote?: boolean;
}>;

export function PageShell({
  title,
  description,
  designSection,
  showStubNote = true,
  children,
}: PageShellProps) {
  return (
    <section className="page-shell">
      {designSection ? <p className="eyebrow">{designSection}</p> : null}
      <h1>{title}</h1>
      <p className="page-description">{description}</p>
      {children}
      {showStubNote ? (
        <aside className="stub-note" aria-label="Implementation status">
          <strong>Skeleton only.</strong> Future requests will use <code>{API_BASE_URL}</code>.
        </aside>
      ) : null}
    </section>
  );
}
