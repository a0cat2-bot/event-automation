import { Link, useParams } from 'react-router-dom';

import { PageShell } from '../components/PageShell';

export function ProgramDetailPage() {
  const { programId = '' } = useParams();
  const base = `/programs/${programId}`;

  return (
    <PageShell
      title="Program Detail"
      description="This workflow hub will summarize one program and link coordinators to each next action."
      designSection="DESIGN.md §8 (Dashboard flow)"
    >
      <nav className="workflow-links" aria-label="Program workflow">
        <Link to={`${base}/applicants/upload`}>Applicant upload</Link>
        <Link to={`${base}/selection`}>Review and selection</Link>
        <Link to={`${base}/notifications`}>Notifications and surveys</Link>
        <Link to={`${base}/surveys`}>Survey results</Link>
        <Link to={`${base}/gifts`}>Gift selection</Link>
        <Link to={`${base}/reports`}>Results report</Link>
      </nav>
    </PageShell>
  );
}
