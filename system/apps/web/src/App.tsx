import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { useSession } from '@/stores/session';
import { AppLayout } from '@/components/layout/AppLayout';
import { ConfirmHost, Spinner, ToastHost } from '@/components/ui';

// Route level code splitting: each page is loaded on demand (fast first paint)
const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const ProfilePage = lazy(() => import('@/features/auth/ProfilePage'));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const ResourcePage = lazy(() => import('@/features/resources/ResourcePage'));
const DocumentListPage = lazy(() => import('@/features/documents/DocumentListPage'));
const DocumentFormPage = lazy(() => import('@/features/documents/DocumentFormPage'));
const DocumentViewPage = lazy(() => import('@/features/documents/DocumentViewPage'));
const PaymentListPage = lazy(() => import('@/features/payments/PaymentListPage'));
const PaymentFormPage = lazy(() => import('@/features/payments/PaymentFormPage'));
const PaymentViewPage = lazy(() => import('@/features/payments/PaymentViewPage'));
const JournalListPage = lazy(() => import('@/features/accounting/JournalListPage'));
const JournalFormPage = lazy(() => import('@/features/accounting/JournalFormPage'));
const JournalViewPage = lazy(() => import('@/features/accounting/JournalViewPage'));
const PayrollListPage = lazy(() => import('@/features/hris/PayrollListPage'));
const PayrollDetailPage = lazy(() => import('@/features/hris/PayrollDetailPage'));
const FileManagerPage = lazy(() => import('@/features/files/FileManagerPage'));
const ReportCenterPage = lazy(() => import('@/features/reports/ReportCenterPage'));
const ReportViewPage = lazy(() => import('@/features/reports/ReportViewPage'));
const UsersPage = lazy(() => import('@/features/system/UsersPage'));
const RolesPage = lazy(() => import('@/features/system/RolesPage'));
const MenusPage = lazy(() => import('@/features/system/MenusPage'));
const SettingsPage = lazy(() => import('@/features/system/SettingsPage'));
const HostingerPage = lazy(() => import('@/features/system/HostingerPage'));
const AuditPage = lazy(() => import('@/features/system/AuditPage'));
const ActivityPage = lazy(() => import('@/features/system/ActivityPage'));
const SessionsPage = lazy(() => import('@/features/system/SessionsPage'));
const NotFoundPage = lazy(() => import('@/features/auth/NotFoundPage'));

function FullScreenSpinner() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <Spinner className="h-8 w-8 text-brand-700" />
    </div>
  );
}

function Protected() {
  const { status, me } = useSession();
  const location = useLocation();
  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (me?.user.mustChangePassword && location.pathname !== '/profile') return <Navigate to="/profile?force=1" replace />;
  return <AppLayout />;
}

export default function App() {
  const bootstrap = useSession((s) => s.bootstrap);
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  return (
    <BrowserRouter>
      <Suspense fallback={<FullScreenSpinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Protected />}>
            <Route index element={<DashboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="r/:key" element={<ResourcePage />} />
            <Route path="documents/:type" element={<DocumentListPage />} />
            <Route path="documents/:type/new" element={<DocumentFormPage />} />
            <Route path="documents/:type/:id" element={<DocumentViewPage />} />
            <Route path="documents/:type/:id/edit" element={<DocumentFormPage />} />
            <Route path="payments/:direction" element={<PaymentListPage />} />
            <Route path="payments/:direction/new" element={<PaymentFormPage />} />
            <Route path="payments/:direction/:id" element={<PaymentViewPage />} />
            <Route path="accounting/journals" element={<JournalListPage />} />
            <Route path="accounting/journals/new" element={<JournalFormPage />} />
            <Route path="accounting/journals/:id" element={<JournalViewPage />} />
            <Route path="hris/payroll" element={<PayrollListPage />} />
            <Route path="hris/payroll/:id" element={<PayrollDetailPage />} />
            <Route path="files" element={<FileManagerPage />} />
            <Route path="reports" element={<ReportCenterPage />} />
            <Route path="reports/:key" element={<ReportViewPage />} />
            <Route path="system/users" element={<UsersPage />} />
            <Route path="system/roles" element={<RolesPage />} />
            <Route path="system/menus" element={<MenusPage />} />
            <Route path="system/settings" element={<SettingsPage />} />
            <Route path="system/hostinger" element={<HostingerPage />} />
            <Route path="system/audit" element={<AuditPage />} />
            <Route path="system/activity" element={<ActivityPage />} />
            <Route path="system/sessions" element={<SessionsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
      <ToastHost />
      <ConfirmHost />
    </BrowserRouter>
  );
}
