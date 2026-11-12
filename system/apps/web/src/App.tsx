import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { useSession } from '@/stores/session';
import { AppLayout } from '@/components/layout/AppLayout';
import { ConfirmHost, PreviewHost, Spinner, ToastHost } from '@/components/ui';
import { extraRoutes } from '@/routes/extra';

// Route level code splitting: each page is loaded on demand (fast first paint)
const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const ProfilePage = lazy(() => import('@/features/auth/ProfilePage'));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const ResourcePage = lazy(() => import('@/features/resources/ResourcePage'));
const UnsubscribePage = lazy(() => import('@/features/emailcampaign/UnsubscribePage'));
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
const SeverancePage = lazy(() => import('@/features/hris/SeverancePage'));
const StockCountListPage = lazy(() => import('@/features/inventory/StockCountPages').then((m) => ({ default: m.StockCountListPage })));
const StockCountPage = lazy(() => import('@/features/inventory/StockCountPages').then((m) => ({ default: m.StockCountPage })));
const ReorderPage = lazy(() => import('@/features/inventory/ReorderPage'));
const LabelsPage = lazy(() => import('@/features/inventory/LabelsPage'));
const LotsPage = lazy(() => import('@/features/inventory/LotsPage'));
const mfg = () => import('@/features/manufacturing/ManufacturingPages');
const PosPage = lazy(() => import('@/features/pos/PosPage'));
const PosShiftsPage = lazy(() => import('@/features/pos/PosShiftsPage'));
const PosSetupPage = lazy(() => import('@/features/pos/PosSetupPage'));
const PosMembersPage = lazy(() => import('@/features/pos/PosMembersPage'));
const TableQrPage = lazy(() => import('@/features/pos/TableQrPage'));
const GuestOrderPage = lazy(() => import('@/features/pos/GuestOrderPage'));
const posScreens = () => import('@/features/pos/screens');
const CustomerDisplayScreen = lazy(() => posScreens().then((m) => ({ default: m.CustomerDisplayScreen })));
const KitchenDisplayScreen = lazy(() => posScreens().then((m) => ({ default: m.KitchenDisplayScreen })));
const QueueBoardScreen = lazy(() => posScreens().then((m) => ({ default: m.QueueBoardScreen })));
const BomListPage = lazy(() => mfg().then((m) => ({ default: m.BomListPage })));
const BomEditPage = lazy(() => mfg().then((m) => ({ default: m.BomEditPage })));
const WorkOrderListPage = lazy(() => mfg().then((m) => ({ default: m.WorkOrderListPage })));
const WorkOrderPage = lazy(() => mfg().then((m) => ({ default: m.WorkOrderPage })));
const mfgFloor = () => import('@/features/manufacturing/MfgFloorPages');
const ShopFloorPage = lazy(() => mfgFloor().then((m) => ({ default: m.ShopFloorPage })));
const CapacityPage = lazy(() => mfgFloor().then((m) => ({ default: m.CapacityPage })));
const MrpPage = lazy(() => import('@/features/manufacturing/MrpPage'));
const qualityPages = () => import('@/features/quality/QualityPages');
const InspectionsPage = lazy(() => qualityPages().then((m) => ({ default: m.InspectionsPage })));
const InspectionPage = lazy(() => qualityPages().then((m) => ({ default: m.InspectionPage })));
const QcPlansPage = lazy(() => qualityPages().then((m) => ({ default: m.PlansPage })));
const NcrPage = lazy(() => qualityPages().then((m) => ({ default: m.NcrPage })));
const ProductionSummaryPage = lazy(() => mfg().then((m) => ({ default: m.ProductionSummaryPage })));
const TaskListPage = lazy(() => import('@/features/tasks/TaskListPage'));
const MyTasksPage = lazy(() => import('@/features/tasks/MyTasksPage'));
const TaskBoardPage = lazy(() => import('@/features/tasks/TaskBoardPage'));
const PipelineBoardPage = lazy(() => import('@/features/crm/PipelineBoardPage'));
const CashListPage = lazy(() => import('@/features/cash/CashListPage'));
const CashViewPage = lazy(() => import('@/features/cash/CashViewPage'));
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
const VerifyPage = lazy(() => import('@/features/auth/VerifyPage'));
const SecurityCenterPage = lazy(() => import('@/features/system/SecurityCenterPage'));

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
  if (me?.user.mfaSetupRequired && location.pathname !== '/profile') return <Navigate to="/profile?mfa=setup" replace />;
  return <AppLayout />;
}

/** signed-in pages without the app frame (customer display, kitchen display, queue board on their own screens) */
function ProtectedScreen() {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
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
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/unsubscribe" element={<UnsubscribePage />} />
          <Route path="/order/:token" element={<GuestOrderPage />} />
          <Route element={<ProtectedScreen />}>
            <Route path="screen/display" element={<CustomerDisplayScreen />} />
            <Route path="screen/kitchen" element={<KitchenDisplayScreen />} />
            <Route path="screen/queue" element={<QueueBoardScreen />} />
            <Route path="pos/kitchen" element={<Navigate to="/screen/kitchen" replace />} />
            <Route path="pos/queue" element={<Navigate to="/screen/queue" replace />} />
          </Route>
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
            <Route path="hris/severance" element={<SeverancePage />} />
            <Route path="inventory/stock-counts" element={<StockCountListPage />} />
            <Route path="inventory/stock-counts/:id" element={<StockCountPage />} />
            <Route path="inventory/reorder" element={<ReorderPage />} />
            <Route path="inventory/labels" element={<LabelsPage />} />
            <Route path="inventory/lots" element={<LotsPage />} />
            <Route path="pos" element={<PosPage />} />
            <Route path="pos/shifts" element={<PosShiftsPage />} />
            <Route path="pos/setup" element={<PosSetupPage />} />
            <Route path="pos/members" element={<PosMembersPage />} />
            <Route path="pos/table-qr" element={<TableQrPage />} />
            <Route path="manufacturing/boms" element={<BomListPage />} />
            <Route path="manufacturing/boms/:id" element={<BomEditPage />} />
            <Route path="manufacturing/orders" element={<WorkOrderListPage />} />
            <Route path="manufacturing/orders/:id" element={<WorkOrderPage />} />
            <Route path="manufacturing/summary" element={<ProductionSummaryPage />} />
            <Route path="manufacturing/shop-floor" element={<ShopFloorPage />} />
            <Route path="manufacturing/capacity" element={<CapacityPage />} />
            <Route path="manufacturing/mrp" element={<MrpPage />} />
            <Route path="quality/inspections" element={<InspectionsPage />} />
            <Route path="quality/inspections/:id" element={<InspectionPage />} />
            <Route path="quality/plans" element={<QcPlansPage />} />
            <Route path="quality/ncr" element={<NcrPage />} />
            <Route path="tasks" element={<TaskListPage />} />
            <Route path="tasks/my" element={<MyTasksPage />} />
            <Route path="tasks/board" element={<TaskBoardPage />} />
            <Route path="crm/pipeline" element={<PipelineBoardPage />} />
            <Route path="accounting/cash" element={<CashListPage />} />
            <Route path="accounting/cash/:id" element={<CashViewPage />} />
            <Route path="files" element={<FileManagerPage />} />
            <Route path="reports" element={<ReportCenterPage />} />
            <Route path="reports/:key" element={<ReportViewPage />} />
            <Route path="system/users" element={<UsersPage />} />
            <Route path="system/roles" element={<RolesPage />} />
            <Route path="system/menus" element={<MenusPage />} />
            <Route path="system/settings" element={<SettingsPage />} />
            <Route path="system/hostinger" element={<HostingerPage />} />
            <Route path="system/audit" element={<AuditPage />} />
            <Route path="system/security" element={<SecurityCenterPage />} />
            <Route path="system/activity" element={<ActivityPage />} />
            <Route path="system/sessions" element={<SessionsPage />} />
            {extraRoutes.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
      <ToastHost />
      <ConfirmHost />
      <PreviewHost />
    </BrowserRouter>
  );
}
