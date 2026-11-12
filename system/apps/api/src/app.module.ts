import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './config/env';
import { CommonModule } from './common/common.module';
import { AuthGuard } from './common/guards/auth.guard';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ActivityInterceptor } from './common/interceptors/activity.interceptor';
import { ExportService } from './common/export/export.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { MenuService } from './modules/system/menu.service';
import { CompanyBootstrapService } from './modules/system/company-bootstrap.service';
import { UsersController } from './modules/system/users.controller';
import { LogsController, MenusController, RolesController, SettingsController } from './modules/system/system.controller';
import { ResourceController } from './modules/resources/resource.controller';
import { ResourceService } from './modules/resources/resource.service';
import { ResourceHooks } from './modules/resources/resource.hooks';
import { DocumentController } from './modules/documents/document.controller';
import { DocumentService } from './modules/documents/document.service';
import { LotService } from './modules/documents/lot.service';
import { InventoryService } from './modules/documents/inventory.service';
import { PaymentController } from './modules/payments/payment.controller';
import { PaymentService } from './modules/payments/payment.service';
import { JournalController } from './modules/accounting/journal.controller';
import { JournalService } from './modules/accounting/journal.service';
import { HrisController } from './modules/hris/hris.controller';
import { HrisService } from './modules/hris/hris.service';
import { CrmController } from './modules/crm/crm.controller';
import { ReportController } from './modules/reports/report.controller';
import { CoretaxController } from './modules/reports/coretax.controller';
import { DashboardController } from './modules/dashboard/dashboard.controller';
import { FilesController } from './modules/files/files.controller';
import { FilesService } from './modules/files/files.service';
import { StorageService } from './modules/files/storage.service';
import { FileOutputService } from './modules/files/file-output.service';
import { PdfService } from './modules/print/pdf.service';
import { DocumentPrintService } from './modules/print/document-print.service';
import { MailService } from './modules/integrations/mail.service';
import { HostingerController } from './modules/integrations/hostinger.controller';
import { HealthController } from './modules/system/health.controller';
import { ResourceImportService } from './modules/resources/resource.import';
import { CashController } from './modules/cash/cash.controller';
import { CashService } from './modules/cash/cash.service';
import { NotificationController } from './modules/notifications/notification.controller';
import { NotificationService } from './modules/notifications/notification.service';
import { TaskController } from './modules/tasks/task.controller';
import { TaskService } from './modules/tasks/task.service';
import { SecurityController } from './modules/security/security.controller';
import { SigningService } from './modules/security/signing.service';
import { TransportService } from './modules/security/transport.service';
import { TransportInterceptor } from './modules/security/transport.interceptor';
import { WatermarkService } from './modules/security/watermark.service';
import { ScheduleModule } from '@nestjs/schedule';
import { BILLING_CONTROLLERS, BILLING_PROVIDERS } from './modules/billing';
import { ASSETS_CONTROLLERS, ASSETS_PROVIDERS } from './modules/assets';
import { BUDGET_CONTROLLERS, BUDGET_PROVIDERS } from './modules/budget';
import { APPROVALS_CONTROLLERS, APPROVALS_PROVIDERS } from './modules/approvals';
import { EXPENSES_CONTROLLERS, EXPENSES_PROVIDERS } from './modules/expenses';
import { HELPDESK_CONTROLLERS, HELPDESK_PROVIDERS } from './modules/helpdesk';
import { PRIVACY_CONTROLLERS, PRIVACY_PROVIDERS } from './modules/privacy';
import { INVENTORY_CONTROLLERS, INVENTORY_PROVIDERS } from './modules/inventory';
import { MANUFACTURING_CONTROLLERS, MANUFACTURING_PROVIDERS } from './modules/manufacturing';
import { POS_CONTROLLERS, POS_PROVIDERS } from './modules/pos';
import { QUALITY_CONTROLLERS, QUALITY_PROVIDERS } from './modules/quality';
import { COMPLIANCE_CONTROLLERS, COMPLIANCE_PROVIDERS } from './modules/compliance';
import { INSIGHTS_CONTROLLERS, INSIGHTS_PROVIDERS } from './modules/insights';
import { OPENING_CONTROLLERS, OPENING_PROVIDERS } from './modules/opening';
import { BANKREC_CONTROLLERS, BANKREC_PROVIDERS } from './modules/bankrec';
import { CLOSING_CONTROLLERS, CLOSING_PROVIDERS } from './modules/closing';
import { TIMEBILLING_CONTROLLERS, TIMEBILLING_PROVIDERS } from './modules/timebilling';
import { LEADFINDER_CONTROLLERS, LEADFINDER_PROVIDERS } from './modules/leadfinder';
import { WEBSITE_CONTROLLERS, WEBSITE_PROVIDERS } from './modules/website';
import { AnnouncementController } from './modules/announcements/announcement.controller';
import { LetterController } from './modules/letters/letter.controller';
import { SignatureController } from './modules/letters/signature.controller';
import { MilestoneController } from './modules/projects/milestone.controller';
import { CashflowController } from './modules/director/cashflow.controller';
import { ObligationsController } from './modules/director/obligations.controller';
import { DealProjectController } from './modules/director/deal-project.controller';
import { EMAILCAMPAIGN_CONTROLLERS, EMAILCAMPAIGN_PROVIDERS } from './modules/emailcampaign';
import { AttendanceController } from './modules/hris/attendance.controller';
import { AttendanceService } from './modules/hris/attendance.service';

const webDist = join(__dirname, '..', '..', 'web', 'dist');

@Module({
  imports: [
    CommonModule,
    ScheduleModule.forRoot(),
    JwtModule.register({ global: true, secret: Buffer.from(env.JWT_ACCESS_SECRET, 'base64').toString('hex'), signOptions: { algorithm: 'HS256', issuer: 'kcs-erp' }, verifyOptions: { algorithms: ['HS256'], issuer: 'kcs-erp' } }),
    // Layer: rate limiting (per IP). Login has a stricter limit on its route.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 600 }]),
    // Production: the API also serves the built PWA (single port, single process)
    ...(existsSync(webDist)
      ? [
          ServeStaticModule.forRoot({
            rootPath: webDist,
            exclude: ['/api/{*path}'],
            serveStaticOptions: {
              index: 'index.html',
              // hashed bundles never change -> cache forever; the HTML shell, service worker and manifest
              // must always be revalidated so a new build is picked up immediately (no stale/unstyled pages)
              setHeaders: (res, filePath) => {
                const f = filePath.split('\\').join('/');
                if (/\/assets\//.test(f)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                else res.setHeader('Cache-Control', 'no-cache');
              },
            },
          }),
        ]
      : []),
  ],
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    RolesController,
    MenusController,
    SettingsController,
    LogsController,
    ResourceController,
    DocumentController,
    PaymentController,
    JournalController,
    HrisController,
    CrmController,
    ReportController,
    CoretaxController,
    DashboardController,
    FilesController,
    HostingerController,
    CashController,
    NotificationController,
    TaskController,
    SecurityController,
    ...BILLING_CONTROLLERS,
    ...ASSETS_CONTROLLERS,
    ...BUDGET_CONTROLLERS,
    ...APPROVALS_CONTROLLERS,
    ...PRIVACY_CONTROLLERS,
    ...INVENTORY_CONTROLLERS,
    ...MANUFACTURING_CONTROLLERS,
    ...QUALITY_CONTROLLERS,
    ...COMPLIANCE_CONTROLLERS,
    ...POS_CONTROLLERS,
    ...EXPENSES_CONTROLLERS,
    ...HELPDESK_CONTROLLERS,
    ...INSIGHTS_CONTROLLERS,
    ...OPENING_CONTROLLERS,
    ...BANKREC_CONTROLLERS,
    ...CLOSING_CONTROLLERS,
    ...TIMEBILLING_CONTROLLERS,
    ...LEADFINDER_CONTROLLERS,
    ...WEBSITE_CONTROLLERS,
    AnnouncementController,
    LetterController,
    SignatureController,
    MilestoneController,
    CashflowController,
    ObligationsController,
    DealProjectController,
    ...EMAILCAMPAIGN_CONTROLLERS,
    AttendanceController,
  ],
  providers: [
    MilestoneController,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransportInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ActivityInterceptor },
    AuthService,
    MenuService,
    CompanyBootstrapService,
    ResourceService,
    ResourceHooks,
    DocumentService,
    LotService,
    InventoryService,
    PaymentService,
    JournalService,
    HrisService,
    FilesService,
    StorageService,
    FileOutputService,
    ExportService,
    PdfService,
    DocumentPrintService,
    MailService,
    ResourceImportService,
    CashService,
    NotificationService,
    TaskService,
    SigningService,
    TransportService,
    WatermarkService,
    ...BILLING_PROVIDERS,
    ...ASSETS_PROVIDERS,
    ...BUDGET_PROVIDERS,
    ...APPROVALS_PROVIDERS,
    ...PRIVACY_PROVIDERS,
    ...INVENTORY_PROVIDERS,
    ...MANUFACTURING_PROVIDERS,
    ...QUALITY_PROVIDERS,
    ...COMPLIANCE_PROVIDERS,
    ...POS_PROVIDERS,
    ...EXPENSES_PROVIDERS,
    ...HELPDESK_PROVIDERS,
    ...INSIGHTS_PROVIDERS,
    ...OPENING_PROVIDERS,
    ...BANKREC_PROVIDERS,
    ...CLOSING_PROVIDERS,
    ...TIMEBILLING_PROVIDERS,
    ...LEADFINDER_PROVIDERS,
    ...WEBSITE_PROVIDERS,
    ...EMAILCAMPAIGN_PROVIDERS,
    AttendanceService,
  ],
})
export class AppModule {}
