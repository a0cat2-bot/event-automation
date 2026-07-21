import { Link } from 'react-router-dom';

import { PageShell } from '../components/PageShell';

export function DashboardPage() {
  return (
    <PageShell
      title="Dashboard"
      description="Active and recent programs, summary statistics, quick actions, and recent activity will appear here."
    >
      <div className="placeholder-grid">
        <article>
          <h2>Program list</h2>
          <p>Status, applicant, participant, and survey summaries.</p>
        </article>
        <article>
          <h2>Quick actions</h2>
          <p>
            <Link to="/programs/new">Create a new program</Link> or resume a workflow.
          </p>
        </article>
        <article>
          <h2>Statistics</h2>
          <p>Monthly program and pending-action totals.</p>
        </article>
        <article>
          <h2>Recent activity</h2>
          <p>The five most recent audited events.</p>
        </article>
      </div>
    </PageShell>
  );
}
