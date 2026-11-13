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
const mntPages = () => import('@/features/manufacturing/MaintenancePages');
const SubcontractingPage = lazy(() => mntPages().then((m) => ({ default: m.SubcontractingPage })));
const MaintenanceOrdersPage = lazy(() => mntPages().then((m) => ({ default: m.MaintenanceOrdersPage })));
const MaintenancePlansPage = lazy(() => mntPages().then((m) => ({ default: m.MaintenancePlansPage })));
const OeePage = lazy(() => mntPages().then((m) => ({ default: m.OeePage })));
const qualityPages = () => import('@/features/quality/QualityPages');
const compliancePages = () => import('@/features/compliance/CompliancePages');
const ComplianceOverviewPage = lazy(() => compliancePages().then((m) => ({ default: m.ComplianceOverviewPage })));
const CertificatesPage = lazy(() => compliancePages().then((m) => ({ default: m.CertificatesPage })));
const TkdnListPage = lazy(() => compliancePages().then((m) => ({ default: m.TkdnListPage })));
const TkdnEditorPage = lazy(() => compliancePages().then((m) => ({ default: m.TkdnEditorPage })));
const wastePages = () => import('@/features/compliance/WastePages');
const farmPages = () => import('@/features/farm/FarmPages');
const CyclesPage = lazy(() => farmPages().then((m) => ({ default: m.CyclesPage })));
const CyclePage = lazy(() => farmPages().then((m) => ({ default: m.CyclePage })));
const ContractsPage = lazy(() => farmPages().then((m) => ({ default: m.ContractsPage })));
const PartnershipReportPage = lazy(() => farmPages().then((m) => ({ default: m.PartnershipReportPage })));
const plantationPages = () => import('@/features/plantation/PlantationPages');
const millPages = () => import('@/features/mill/MillPages');
const herdPages = () => import('@/features/herd/HerdPages');
const commodityPages = () => import('@/features/commodity/CommodityPages');
const CommContractsPage = lazy(() => commodityPages().then((m) => ({ default: m.ContractsPage })));
const CommContractPage = lazy(() => commodityPages().then((m) => ({ default: m.ContractPage })));
const CommShipmentsPage = lazy(() => commodityPages().then((m) => ({ default: m.ShipmentsPage })));
const CommShipmentPage = lazy(() => commodityPages().then((m) => ({ default: m.ShipmentPage })));
const CommRegisterPage = lazy(() => commodityPages().then((m) => ({ default: m.RegisterPage })));
const CommReferencesPage = lazy(() => commodityPages().then((m) => ({ default: m.ReferencesPage })));
const garmentPages = () => import('@/features/garment/GarmentPages');
const GarmentStylesPage = lazy(() => garmentPages().then((m) => ({ default: m.StylesPage })));
const GarmentOrdersPage = lazy(() => garmentPages().then((m) => ({ default: m.OrdersPage })));
const GarmentOrderPage = lazy(() => garmentPages().then((m) => ({ default: m.OrderPage })));
const GarmentEfficiencyPage = lazy(() => garmentPages().then((m) => ({ default: m.EfficiencyPage })));
const bondedPages = () => import('@/features/bonded/BondedPages');
const BondedDocumentsPage = lazy(() => bondedPages().then((m) => ({ default: m.DocumentsPage })));
const BondedDocumentPage = lazy(() => bondedPages().then((m) => ({ default: m.DocumentPage })));
const BondedReportsPage = lazy(() => bondedPages().then((m) => ({ default: m.ReportsPage })));
const BondedQuotaPage = lazy(() => bondedPages().then((m) => ({ default: m.QuotaPage })));
const BondedKitePage = lazy(() => bondedPages().then((m) => ({ default: m.KitePage })));
const HerdHerdOverviewPage = lazy(() => herdPages().then((m) => ({ default: m.HerdOverviewPage })));
const HerdAnimalsPage = lazy(() => herdPages().then((m) => ({ default: m.AnimalsPage })));
const HerdAnimalPage = lazy(() => herdPages().then((m) => ({ default: m.AnimalPage })));
const HerdMilkPage = lazy(() => herdPages().then((m) => ({ default: m.MilkPage })));
const HerdMilkSalesPage = lazy(() => herdPages().then((m) => ({ default: m.MilkSalesPage })));
const HerdFeedingPage = lazy(() => herdPages().then((m) => ({ default: m.FeedingPage })));
const HerdHealthPage = lazy(() => herdPages().then((m) => ({ default: m.HealthPage })));
const HerdFatteningPage = lazy(() => herdPages().then((m) => ({ default: m.FatteningPage })));
const MillDailyListPage = lazy(() => millPages().then((m) => ({ default: m.DailyListPage })));
const MillDailyPage = lazy(() => millPages().then((m) => ({ default: m.DailyPage })));
const MillIntakesPage = lazy(() => millPages().then((m) => ({ default: m.IntakesPage })));
const MillSuppliersPage = lazy(() => millPages().then((m) => ({ default: m.SuppliersPage })));
const MillPricesPage = lazy(() => millPages().then((m) => ({ default: m.PricesPage })));
const MillPerformancePage = lazy(() => millPages().then((m) => ({ default: m.PerformancePage })));
const MillTanksPage = lazy(() => millPages().then((m) => ({ default: m.TanksPage })));
const PlantBlocksPage = lazy(() => plantationPages().then((m) => ({ default: m.BlocksPage })));
const PlantBlockPage = lazy(() => plantationPages().then((m) => ({ default: m.BlockPage })));
const PlantBkmListPage = lazy(() => plantationPages().then((m) => ({ default: m.BkmListPage })));
const PlantBkmPage = lazy(() => plantationPages().then((m) => ({ default: m.BkmPage })));
const PlantDispatchesPage = lazy(() => plantationPages().then((m) => ({ default: m.DispatchesPage })));
const PlantDispatchPage = lazy(() => plantationPages().then((m) => ({ default: m.DispatchPage })));
const PlantProductionPage = lazy(() => plantationPages().then((m) => ({ default: m.ProductionPage })));
const PlantCheckrollPage = lazy(() => plantationPages().then((m) => ({ default: m.CheckrollPage })));
const WastePage = lazy(() => wastePages().then((m) => ({ default: m.WastePage })));
const SiinasPage = lazy(() => wastePages().then((m) => ({ default: m.SiinasPage })));
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
            <Route path="manufacturing/subcontracting" element={<SubcontractingPage />} />
            <Route path="maintenance/orders" element={<MaintenanceOrdersPage />} />
            <Route path="maintenance/plans" element={<MaintenancePlansPage />} />
            <Route path="maintenance/oee" element={<OeePage />} />
            <Route path="farm/cycles" element={<CyclesPage />} />
            <Route path="farm/cycles/:id" element={<CyclePage />} />
            <Route path="farm/contracts" element={<ContractsPage />} />
            <Route path="farm/partnership-report" element={<PartnershipReportPage />} />
            <Route path="plantation/blocks" element={<PlantBlocksPage />} />
            <Route path="plantation/blocks/:id" element={<PlantBlockPage />} />
            <Route path="plantation/bkm" element={<PlantBkmListPage />} />
            <Route path="plantation/bkm/:id" element={<PlantBkmPage />} />
            <Route path="plantation/dispatches" element={<PlantDispatchesPage />} />
            <Route path="plantation/dispatches/:id" element={<PlantDispatchPage />} />
            <Route path="plantation/production" element={<PlantProductionPage />} />
            <Route path="plantation/checkroll" element={<PlantCheckrollPage />} />
            <Route path="mill/daily" element={<MillDailyListPage />} />
            <Route path="mill/daily/:id" element={<MillDailyPage />} />
            <Route path="mill/intakes" element={<MillIntakesPage />} />
            <Route path="mill/suppliers" element={<MillSuppliersPage />} />
            <Route path="mill/prices" element={<MillPricesPage />} />
            <Route path="mill/performance" element={<MillPerformancePage />} />
            <Route path="mill/tanks" element={<MillTanksPage />} />
            <Route path="herd" element={<HerdHerdOverviewPage />} />
            <Route path="herd/animals" element={<HerdAnimalsPage />} />
            <Route path="herd/animals/:id" element={<HerdAnimalPage />} />
            <Route path="herd/milk" element={<HerdMilkPage />} />
            <Route path="herd/milk-sales" element={<HerdMilkSalesPage />} />
            <Route path="herd/feeding" element={<HerdFeedingPage />} />
            <Route path="herd/health" element={<HerdHealthPage />} />
            <Route path="herd/fattening" element={<HerdFatteningPage />} />
            <Route path="commodity/contracts" element={<CommContractsPage />} />
            <Route path="commodity/contracts/:id" element={<CommContractPage />} />
            <Route path="commodity/shipments" element={<CommShipmentsPage />} />
            <Route path="commodity/shipments/:id" element={<CommShipmentPage />} />
            <Route path="commodity/register" element={<CommRegisterPage />} />
            <Route path="commodity/references" element={<CommReferencesPage />} />
            <Route path="garment/styles" element={<GarmentStylesPage />} />
            <Route path="garment/orders" element={<GarmentOrdersPage />} />
            <Route path="garment/orders/:id" element={<GarmentOrderPage />} />
            <Route path="garment/efficiency" element={<GarmentEfficiencyPage />} />
            <Route path="bonded/documents" element={<BondedDocumentsPage />} />
            <Route path="bonded/documents/:id" element={<BondedDocumentPage />} />
            <Route path="bonded/reports" element={<BondedReportsPage />} />
            <Route path="bonded/quota" element={<BondedQuotaPage />} />
            <Route path="bonded/kite" element={<BondedKitePage />} />
            <Route path="compliance" element={<ComplianceOverviewPage />} />
            <Route path="compliance/certificates" element={<CertificatesPage />} />
            <Route path="compliance/tkdn" element={<TkdnListPage />} />
            <Route path="compliance/tkdn/:id" element={<TkdnEditorPage />} />
            <Route path="compliance/waste" element={<WastePage />} />
            <Route path="compliance/siinas" element={<SiinasPage />} />
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
