import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { AuthUser } from '../../common/context/request-context';
import { ApprovalService } from '../approvals/approval.service';

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
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService, private readonly approvals: ApprovalService) {}

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
    if (can(u, 'crm.lead.read') && (await on('websiteEnquiries'))) {
      const n = await this.prisma.lead.count({ where: { companyId: c, sourceCode: 'WEBSITE', statusCode: 'NEW', deletedAt: null } });
      if (n) items.push({ key: 'website', title: 'New website enquiries', message: `${n} message${n > 1 ? 's' : ''} from the website contact form`, count: n, severity: 'info', icon: 'inbox', link: '/r/leads?f.sourceCode=WEBSITE&f.statusCode=NEW' });
    }
    if (can(u, 'crm.emailcampaign.read') && (await on('emailReplies'))) {
      const n = await this.prisma.emailReply.count({ where: { companyId: c, kindCode: 'REPLY', handledAt: null } });
      if (n) items.push({ key: 'email-replies', title: 'Replies to e-mail campaigns', message: `${n} repl${n > 1 ? 'ies are' : 'y is'} waiting for an answer`, count: n, severity: 'info', icon: 'mail-check', link: '/crm/email-campaigns?tab=replies' });
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
    if (can(u, 'approval.request.decide') && (await on('approvals'))) {
      const n = await this.prisma.approvalRequest.count({ where: await this.approvals.waitingWhere(u) });
      if (n) items.push({ key: 'approvals', title: 'Approvals waiting for you', message: n > 1 ? `${n} requests are waiting for your decision` : 'One request is waiting for your decision', count: n, severity: 'warning', icon: 'stamp', link: '/approvals' });
    }
    if (can(u, 'support.ticket.read') && (await on('tickets'))) {
      const open = { companyId: c, deletedAt: null, statusCode: { notIn: ['RESOLVED', 'CLOSED'] } };
      const [mine, late] = await Promise.all([
        this.prisma.ticket.count({ where: { ...open, assigneeId: u.id } }),
        this.prisma.ticket.count({ where: { ...open, assigneeId: u.id, dueAt: { lt: new Date() } } }),
      ]);
      if (mine) items.push({ key: 'tickets', title: 'My open tickets', message: late ? `${mine} open, ${late} past the SLA target` : `${mine} ticket${mine > 1 ? 's are' : ' is'} assigned to you`, count: mine, severity: late ? 'danger' : 'info', icon: 'life-buoy', link: '/helpdesk/tickets?f.assignee=me' });
      if (can(u, 'support.ticket.manage')) {
        const n = await this.prisma.ticket.count({ where: { ...open, assigneeId: null } });
        if (n) items.push({ key: 'ticketsUnassigned', title: 'Unassigned tickets', message: n > 1 ? `${n} open tickets have no assignee` : 'One open ticket has no assignee', count: n, severity: 'warning', icon: 'ticket', link: '/helpdesk/tickets?f.assignee=none' });
      }
    }
    if (await on('expenses')) {
      if (can(u, 'hris.expense.approve')) {
        // claims routed through approval rules are counted under "Approvals waiting for you"
        const [submitted, routed] = await Promise.all([
          this.prisma.expenseClaim.count({ where: { companyId: c, deletedAt: null, statusCode: 'SUBMITTED', ...(branch() as Prisma.ExpenseClaimWhereInput) } }),
          this.prisma.approvalRequest.count({ where: { companyId: c, docType: 'EXPENSE', statusCode: 'PENDING' } }),
        ]);
        const n = Math.max(0, submitted - routed);
        if (n) items.push({ key: 'expenseApprove', title: 'Expense claims to approve', message: n > 1 ? `${n} claims are waiting for approval` : 'One claim is waiting for approval', count: n, severity: 'warning', icon: 'receipt-text', link: '/expenses?f.status=SUBMITTED' });
      }
      if (can(u, 'hris.expense.pay')) {
        const n = await this.prisma.expenseClaim.count({ where: { companyId: c, deletedAt: null, statusCode: 'APPROVED', ...(branch() as Prisma.ExpenseClaimWhereInput) } });
        if (n) items.push({ key: 'expensePay', title: 'Expense claims to pay', message: n > 1 ? `${n} approved claims are waiting for reimbursement` : 'One approved claim is waiting for reimbursement', count: n, severity: 'info', icon: 'wallet', link: '/expenses?f.status=APPROVED' });
      }
    }
    if (await on('draftDocuments')) {
      const n = await this.prisma.tradeDocument.count({ where: { companyId: c, createdById: u.id, status: 'DRAFT', deletedAt: null, createdAt: { lt: new Date(Date.now() - 3 * 86_400_000) } } });
      if (n) items.push({ key: 'drafts', title: 'Unfinished drafts', message: n > 1 ? `${n} of your draft documents are older than 3 days` : 'One of your draft documents is older than 3 days', count: n, severity: 'info', icon: 'file-pen', link: '/' });
    }
    return { ...base, total: items.reduce((a, i) => a + i.count, 0), items };
  }
}
