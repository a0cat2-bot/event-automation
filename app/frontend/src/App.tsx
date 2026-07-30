import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { AppLayout } from './components/AppLayout';
import { SessionProvider } from './components/SessionContext';
import { AuditLogPage } from './pages/AuditLogPage';
import { ApplicantReviewSelectionPage } from './pages/ApplicantReviewSelectionPage';
import { ApplicantUploadPage } from './pages/ApplicantUploadPage';
import { BusinessUnitsPage } from './pages/BusinessUnitsPage';
import { CycleMetricsPage } from './pages/CycleMetricsPage';
import { DashboardPage } from './pages/DashboardPage';
import { GiftSelectionPage } from './pages/GiftSelectionPage';
import { LetterDraftsPage } from './pages/LetterDraftsPage';
import { LetterTemplateEditorPage } from './pages/LetterTemplateEditorPage';
import { LetterTemplateListPage } from './pages/LetterTemplateListPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrgSettingsPage } from './pages/OrgSettingsPage';
import { ProgramDetailPage } from './pages/ProgramDetailPage';
import { ProgramEditPage } from './pages/ProgramEditPage';
import { ProgramSetupPage } from './pages/ProgramSetupPage';
import { ResultsReportPage } from './pages/ResultsReportPage';
import { SelectionReviewSurveySendingPage } from './pages/SelectionReviewSurveySendingPage';
import { SurveyResultsPage } from './pages/SurveyResultsPage';
import { UsersPage } from './pages/UsersPage';

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/programs/new', element: <ProgramSetupPage /> },
      { path: '/programs/:programId', element: <ProgramDetailPage /> },
      { path: '/programs/:programId/edit', element: <ProgramEditPage /> },
      { path: '/programs/:programId/applicants/upload', element: <ApplicantUploadPage /> },
      { path: '/programs/:programId/letters', element: <LetterDraftsPage /> },
      {
        path: '/programs/:programId/letters/:templateId/edit',
        element: <LetterTemplateEditorPage />,
      },
      { path: '/programs/:programId/selection', element: <ApplicantReviewSelectionPage /> },
      {
        path: '/programs/:programId/notifications',
        element: <SelectionReviewSurveySendingPage />,
      },
      { path: '/programs/:programId/surveys', element: <SurveyResultsPage /> },
      { path: '/programs/:programId/gifts', element: <GiftSelectionPage /> },
      { path: '/programs/:programId/reports', element: <ResultsReportPage /> },
      { path: '/letter-templates', element: <LetterTemplateListPage /> },
      { path: '/letter-templates/:id', element: <LetterTemplateEditorPage /> },
      { path: '/business-units', element: <BusinessUnitsPage /> },
      { path: '/org-settings', element: <OrgSettingsPage /> },
      { path: '/users', element: <UsersPage /> },
      { path: '/cycle-metrics', element: <CycleMetricsPage /> },
      { path: '/audit-logs', element: <AuditLogPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return (
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  );
}
