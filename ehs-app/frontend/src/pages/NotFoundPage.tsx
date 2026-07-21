import { Link } from 'react-router-dom';

import { PageShell } from '../components/PageShell';

export function NotFoundPage() {
  return (
    <PageShell title="Page not found" description="This route is not part of the EHS workflow skeleton.">
      <Link to="/">Return to the dashboard</Link>
    </PageShell>
  );
}
