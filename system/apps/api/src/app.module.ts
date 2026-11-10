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
import { InventoryService } from './modules/documents/inventory.service';
import { PaymentController } from './modules/payments/payment.controller';
import { PaymentService } from './modules/payments/payment.service';
import { JournalController } from './modules/accounting/journal.controller';
import { JournalService } from './modules/accounting/journal.service';
import { HrisController } from './modules/hris/hris.controller';
import { HrisService } from './modules/hris/hris.service';
import { CrmController } from './modules/crm/crm.controller';
import { ReportController } from './modules/reports/report.controller';
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

const webDist = join(__dirname, '..', '..', 'web', 'dist');

@Module({
  imports: [
    CommonModule,
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
    DashboardController,
    FilesController,
    HostingerController,
    CashController,
    NotificationController,
    TaskController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ActivityInterceptor },
    AuthService,
    MenuService,
    CompanyBootstrapService,
    ResourceService,
    ResourceHooks,
    DocumentService,
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
  ],
})
export class AppModule {}
