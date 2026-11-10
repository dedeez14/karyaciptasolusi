import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { AuthUser } from '../../common/context/request-context';

export interface NotificationItem {
  key: string;
  title: string;
  message: string;
  count: number;
  severity: 'info' | 'warning' | 'danger';
  icon: string;
  link: string;
}

export interface NotificationSummary {
  enabled: boolean;
  refreshSeconds: number;
  desktop: boolean;
  sound: boolean;
  total: number;
  items: NotificationItem[];
  at: string;
}

const can = (u: AuthUser, p: string) => u.isSuperAdmin || u.permissions.has(p);

/**
 * Computes the actionable items for one user. Takes the user explicitly (no request context),
 * because it also runs inside long-lived real-time streams.
 */
@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  async summary(u: AuthUser): Promise<NotificationSummary> {
    const c = u.companyId;
    const on = (k: string) => this.settings.bool(`notifications.${k}`, c, true);
    const base = {
      enabled: await on('enabled'),
      refreshSeconds: Math.max(10, await this.settings.num('notifications.refreshSeconds', c, 30)),
      desktop: await this.settings.bool('notifications.desktop', c, true),
      sound: await this.settings.bool('notifications.sound', c, false),
      at: new Date().toISOString(),
    };
    if (!base.enabled) return { ...base, total: 0, items: [] };

    const items: NotificationItem[] = [];
    const today = new Date();
    const dayStart = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const branch = (field = 'branchId') => (u.branchIds && !u.isSuperAdmin && u.dataScope === 'BRANCH' ? { OR: [{ [field]: { in: u.branchIds } }, { [field]: null }] } : {});

    if (can(u, 'hris.leave.approve') && (await on('leaveApprovals'))) {
      const n = await this.prisma.leaveRequest.count({ where: { companyId: c, status: 'PENDING', deletedAt: null, ...(branch() as Prisma.LeaveRequestWhereInput) } });
      if (n) items.push({ key: 'leave', title: 'Leave requests to approve', message: `${n} request${n > 1 ? 's are' : ' is'} waiting for approval`, count: n, severity: 'warning', icon: 'plane', link: '/r/leave-requests?f.status=PENDING' });
    }
    if (can(u, 'sales.invoice.read') && (await on('overdueInvoices'))) {
      const agg = await this.prisma.tradeDocument.aggregate({
        where: { companyId: c, docType: 'SI', deletedAt: null, status: { in: ['CONFIRMED', 'PARTIAL'] }, dueDate: { lt: dayStart } },
        _count: { _all: true },
        _sum: { grandTotal: true, paidAmount: true },
      });
      const n = agg._count._all;
      if (n) {
        const due = Number(agg._sum.grandTotal ?? 0) - Number(agg._sum.paidAmount ?? 0);
        items.push({ key: 'overdue', title: 'Overdue customer invoices', message: `${n} invoice${n > 1 ? 's' : ''} overdue, ${due.toLocaleString('en-US', { maximumFractionDigits: 0 })} outstanding`, count: n, severity: 'danger', icon: 'receipt', link: '/documents/SI?unpaid=1' });
      }
    }
    if (can(u, 'purchase.invoice.read') && (await on('billsDue'))) {
      const days = await this.settings.num('notifications.billsDueDays', c, 7);
      const n = await this.prisma.tradeDocument.count({
        where: { companyId: c, docType: 'PI', deletedAt: null, status: { in: ['CONFIRMED', 'PARTIAL'] }, dueDate: { lte: new Date(dayStart.getTime() + days * 86_400_000) } },
      });
      if (n) items.push({ key: 'bills', title: 'Supplier bills due', message: `${n} bill${n > 1 ? 's' : ''} due within ${days} days or overdue`, count: n, severity: 'warning', icon: 'banknote', link: '/documents/PI?unpaid=1' });
    }
    if (can(u, 'inventory.stock.read') && (await on('lowStock'))) {
      const [row] = await this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM (SELECT pr.id FROM products pr LEFT JOIN stock_balances b ON b."productId" = pr.id
        WHERE pr."companyId" = ${c}::uuid AND pr.type = 'STOCK' AND pr."isActive" AND pr."deletedAt" IS NULL AND pr."minStock" > 0
        GROUP BY pr.id HAVING COALESCE(SUM(b.qty),0) <= pr."minStock") x`;
      const n = Number(row?.n ?? 0);
      if (n) items.push({ key: 'stock', title: 'Low stock', message: `${n} product${n > 1 ? 's are' : ' is'} at or below minimum stock`, count: n, severity: 'warning', icon: 'package-x', link: '/reports/low-stock' });
    }
    if (can(u, 'crm.activity.read') && (await on('crmActivities'))) {
      const n = await this.prisma.crmActivity.count({ where: { companyId: c, deletedAt: null, isDone: false, OR: [{ ownerId: u.id }, { ownerId: null, createdById: u.id }], dueDate: { lt: new Date(dayStart.getTime() + 86_400_000) } } });
      if (n) items.push({ key: 'crm', title: 'CRM activities due', message: n > 1 ? `${n} of your activities are due today or overdue` : 'One of your activities is due today or overdue', count: n, severity: 'info', icon: 'calendar-check', link: '/r/crm-activities?f.isDone=false' });
    }
    if (can(u, 'task.task.read') && (await on('tasks'))) {
      const n = await this.prisma.task.count({ where: { companyId: c, deletedAt: null, assigneeId: u.id, completedAt: null, dueDate: { lt: new Date(dayStart.getTime() + 86_400_000) } } });
      if (n) items.push({ key: 'tasks', title: 'My tasks due', message: n > 1 ? `${n} of your tasks are due today or overdue` : 'One of your tasks is due today or overdue', count: n, severity: 'warning', icon: 'list-todo', link: '/tasks/my' });
    }
    if (await on('draftDocuments')) {
      const n = await this.prisma.tradeDocument.count({ where: { companyId: c, createdById: u.id, status: 'DRAFT', deletedAt: null, createdAt: { lt: new Date(Date.now() - 3 * 86_400_000) } } });
      if (n) items.push({ key: 'drafts', title: 'Unfinished drafts', message: n > 1 ? `${n} of your draft documents are older than 3 days` : 'One of your draft documents is older than 3 days', count: n, severity: 'info', icon: 'file-pen', link: '/' });
    }
    return { ...base, total: items.reduce((a, i) => a + i.count, 0), items };
  }
}
