import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Ticket } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { paged } from '../../common/utils/query';
import { MailService } from '../integrations/mail.service';

const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());

export const ticketSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(250),
  description: optText(20000),
  customerId: optUuid,
  contactName: optText(150),
  contactEmail: z.preprocess((v) => (v === '' ? null : v), z.email('Invalid e-mail').max(150).nullable().optional()),
  contactPhone: optText(50),
  projectId: optUuid,
  categoryCode: optText(50),
  priorityCode: z.string().trim().min(1).max(50),
  statusCode: z.string().trim().min(1).max(50).optional(),
  channelCode: optText(50),
  assigneeId: optUuid,
});
/** new tickets default to MEDIUM priority (no defaults on the update schema: zod applies them inside partial()) */
const createSchema = ticketSchema.extend({ priorityCode: z.string().trim().min(1).max(50).default('MEDIUM') });

export const messageSchema = z.object({
  body: z.string().trim().min(1, 'Message is empty').max(20000),
  isInternal: z.boolean().default(false),
  /** staff records a message received from the customer (phone, WhatsApp, e-mail) */
  fromCustomer: z.boolean().default(false),
});

export interface TicketQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  priority?: string;
  category?: string;
  assignee?: string;
  customerId?: string;
  open?: string;
  sla?: 'breached';
  sort?: string;
  order?: 'asc' | 'desc';
}

const CLOSED = ['RESOLVED', 'CLOSED'];
export type SlaState = 'none' | 'on_track' | 'at_risk' | 'breached' | 'met';

/** SLA indicator: met / breached once resolved, otherwise on track / at risk (last 25% of the window) / breached */
export function slaState(t: Pick<Ticket, 'dueAt' | 'createdAt' | 'resolvedAt'>, now = Date.now()): SlaState {
  if (!t.dueAt) return 'none';
  const due = t.dueAt.getTime();
  if (t.resolvedAt) return t.resolvedAt.getTime() <= due ? 'met' : 'breached';
  if (now > due) return 'breached';
  const window = due - t.createdAt.getTime();
  return due - now < window * 0.25 ? 'at_risk' : 'on_track';
}

/**
 * Helpdesk tickets with SLA (resolution target per priority from settings helpdesk.slaHours*),
 * conversation thread with internal notes, kanban board by TICKET_STATUS.
 * Visibility: support.ticket.manage or COMPANY/ALL scope -> all tickets, otherwise tickets created by or assigned to the user.
 */
@Injectable()
export class TicketService {
  private readonly log = new Logger('Helpdesk');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
  ) {}

  private seesAll() {
    const u = RequestCtx.user();
    return u.isSuperAdmin || RequestCtx.can('support.ticket.manage') || u.dataScope === 'ALL' || u.dataScope === 'COMPANY';
  }

  private visibility(): Prisma.TicketWhereInput {
    const u = RequestCtx.user();
    const where: Prisma.TicketWhereInput = { companyId: u.companyId, deletedAt: null };
    if (!this.seesAll()) {
      const or: Prisma.TicketWhereInput[] = [{ createdById: u.id }, { assigneeId: u.id }];
      if (u.dataScope === 'BRANCH' && u.branchIds) or.push({ branchId: { in: u.branchIds } });
      where.OR = or;
    }
    return where;
  }

  private canEdit(t: { assigneeId: string | null; createdById: string | null }) {
    const u = RequestCtx.user();
    return RequestCtx.can('support.ticket.update') && (this.seesAll() || [t.assigneeId, t.createdById].includes(u.id));
  }

  /** Resolution target from the priority's SLA setting */
  private async dueAt(companyId: string, priorityCode: string, from: Date) {
    const key = `helpdesk.slaHours${priorityCode.charAt(0)}${priorityCode.slice(1).toLowerCase()}`;
    const hours = await this.settings.num(key, companyId, 24);
    return hours > 0 ? new Date(from.getTime() + hours * 3_600_000) : null;
  }

  private async decorate<T extends Ticket>(rows: T[]) {
    const ids = (k: 'customerId' | 'projectId' | 'assigneeId' | 'createdById') => [...new Set(rows.map((r) => r[k]).filter(Boolean) as string[])];
    const [customers, projects, users, counts] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: ids('customerId') } }, select: { id: true, name: true } }),
      this.prisma.project.findMany({ where: { id: { in: ids('projectId') } }, select: { id: true, code: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...ids('assigneeId'), ...ids('createdById')] } }, select: { id: true, fullName: true } }),
      this.prisma.ticketMessage.groupBy({ by: ['ticketId'], where: { ticketId: { in: rows.map((r) => r.id) } }, _count: { _all: true } }),
    ]);
    const cn = new Map(customers.map((x) => [x.id, x.name]));
    const pn = new Map(projects.map((x) => [x.id, `${x.code} - ${x.name}`]));
    const un = new Map(users.map((x) => [x.id, x.fullName]));
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      customerName: r.customerId ? cn.get(r.customerId) ?? null : null,
      projectName: r.projectId ? pn.get(r.projectId) ?? null : null,
      assigneeName: r.assigneeId ? un.get(r.assigneeId) ?? null : null,
      createdByName: r.createdById ? un.get(r.createdById) ?? null : null,
      messageCount: counts.find((c) => c.ticketId === r.id)?._count._all ?? 0,
      sla: slaState(r, now),
    }));
  }

  async list(q: TicketQuery) {
    RequestCtx.assert('support.ticket.read');
    const u = RequestCtx.user();
    const where = this.visibility();
    const and: Prisma.TicketWhereInput[] = [];
    if (q.search) and.push({ OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { subject: { contains: q.search, mode: 'insensitive' } }, { contactName: { contains: q.search, mode: 'insensitive' } }, { contactEmail: { contains: q.search, mode: 'insensitive' } }] });
    if (q.status) where.statusCode = { in: q.status.split(',') };
    if (q.priority) where.priorityCode = q.priority;
    if (q.category) where.categoryCode = q.category;
    if (q.customerId) where.customerId = q.customerId;
    if (q.assignee === 'me') where.assigneeId = u.id;
    else if (q.assignee === 'none') where.assigneeId = null;
    else if (q.assignee) where.assigneeId = q.assignee;
    if (q.open === '1') and.push({ statusCode: { notIn: CLOSED } });
    if (q.sla === 'breached') and.push({ resolvedAt: null, dueAt: { lt: new Date() } });
    if (and.length) where.AND = and;
    const sortField = ['createdAt', 'updatedAt', 'dueAt', 'code', 'subject', 'priorityCode'].includes(q.sort ?? '') ? q.sort! : 'createdAt';
    const [rows, total] = await Promise.all([
      this.prisma.ticket.findMany({ where, orderBy: [sortField === 'dueAt' ? { dueAt: { sort: q.order ?? 'desc', nulls: 'last' } } : { [sortField]: q.order ?? 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.ticket.count({ where }),
    ]);
    return paged(await this.decorate(rows), total, q);
  }

  async summary() {
    RequestCtx.assert('support.ticket.read');
    const u = RequestCtx.user();
    const base = this.visibility();
    const open: Prisma.TicketWhereInput = { ...base, statusCode: { notIn: CLOSED } };
    const now = new Date();
    const [openN, unassigned, breached, mine, resolvedWeek, responded] = await Promise.all([
      this.prisma.ticket.count({ where: open }),
      this.prisma.ticket.count({ where: { ...open, assigneeId: null } }),
      this.prisma.ticket.count({ where: { ...open, resolvedAt: null, dueAt: { lt: now } } }),
      this.prisma.ticket.count({ where: { ...open, assigneeId: u.id } }),
      this.prisma.ticket.count({ where: { ...base, resolvedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } }),
      this.prisma.ticket.findMany({ where: { ...base, firstResponseAt: { not: null }, createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }, select: { createdAt: true, firstResponseAt: true }, take: 2000 }),
    ]);
    const avg = responded.length ? responded.reduce((a, t) => a + (t.firstResponseAt!.getTime() - t.createdAt.getTime()), 0) / responded.length / 3_600_000 : null;
    return { open: openN, unassigned, breached, mine, resolvedWeek, avgFirstResponseHours: avg === null ? null : Math.round(avg * 10) / 10 };
  }

  private async own(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Ticket not found');
    const t = await this.prisma.ticket.findFirst({ where: { ...this.visibility(), id } });
    if (!t) throw new NotFoundException('Ticket not found');
    return t;
  }

  async get(id: string) {
    RequestCtx.assert('support.ticket.read');
    const t = await this.own(id);
    const [decorated] = await this.decorate([t]);
    const [messages, files] = await Promise.all([
      this.prisma.ticketMessage.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.storedFile.findMany({ where: { entityType: 'TICKET', entityId: id, deletedAt: null, companyId: t.companyId }, select: { id: true, name: true, size: true, mimeType: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(messages.map((m) => m.userId).filter(Boolean) as string[])] } }, select: { id: true, fullName: true } });
    const un = new Map(users.map((x) => [x.id, x.fullName]));
    const me = RequestCtx.user().id;
    return {
      ...decorated,
      canEdit: this.canEdit(t),
      canDelete: RequestCtx.can('support.ticket.delete'),
      messages: messages.map((m) => ({ ...m, authorName: m.userId ? un.get(m.userId) ?? m.authorName ?? 'Unknown' : m.authorName ?? t.contactName ?? 'Customer', fromCustomer: !m.userId, mine: m.userId === me })),
      files,
    };
  }

  private async refs(data: Partial<z.infer<typeof ticketSchema>>) {
    const companyId = RequestCtx.companyId();
    const err = (field: string, msg: string) => new BadRequestException({ message: 'Validation failed', errors: { [field]: msg } });
    const check = async (model: 'customer' | 'project', id: string | null | undefined, field: string) => {
      if (id && !(await (this.prisma as any)[model].findFirst({ where: { id, companyId, deletedAt: null } }))) throw err(field, 'Not found');
    };
    await check('customer', data.customerId, 'customerId');
    await check('project', data.projectId, 'projectId');
    if (data.assigneeId && !(await this.prisma.user.findFirst({ where: { id: data.assigneeId, deletedAt: null, isActive: true, OR: [{ isSuperAdmin: true }, { assignments: { some: { companyId } } }] } }))) {
      throw err('assigneeId', 'User has no access to this company');
    }
    const lookups: [keyof typeof data, string][] = [
      ['priorityCode', 'TICKET_PRIORITY'],
      ['statusCode', 'TICKET_STATUS'],
      ['categoryCode', 'TICKET_CATEGORY'],
      ['channelCode', 'TICKET_CHANNEL'],
    ];
    for (const [field, category] of lookups) {
      const v = data[field] as string | null | undefined;
      if (v && !(await this.prisma.lookupValue.findFirst({ where: { category, code: v, deletedAt: null } }))) throw err(field, 'Invalid value');
    }
  }

  /** resolvedAt / closedAt follow the status */
  private statusDates(statusCode: string, t?: Pick<Ticket, 'resolvedAt' | 'closedAt'>) {
    const now = new Date();
    if (statusCode === 'RESOLVED') return { resolvedAt: t?.resolvedAt ?? now, closedAt: null };
    if (statusCode === 'CLOSED') return { resolvedAt: t?.resolvedAt ?? now, closedAt: t?.closedAt ?? now };
    return { resolvedAt: null, closedAt: null };
  }

  async create(body: unknown) {
    RequestCtx.assert('support.ticket.create');
    const input = createSchema.parse(body);
    await this.refs(input);
    const u = RequestCtx.user();
    // people without update rights cannot assign or set the status of new tickets
    const staff = RequestCtx.can('support.ticket.update');
    const status = staff ? input.statusCode ?? 'OPEN' : 'OPEN';
    let contact = { name: input.contactName ?? null, email: input.contactEmail ?? null, phone: input.contactPhone ?? null };
    if (input.customerId && !contact.name && !contact.email) {
      const c = await this.prisma.customer.findUnique({ where: { id: input.customerId }, select: { contactPerson: true, email: true, phone: true } });
      contact = { name: c?.contactPerson ?? null, email: c?.email ?? null, phone: contact.phone ?? c?.phone ?? null };
    }
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.create({
        data: {
          companyId: u.companyId,
          branchId: u.branchId,
          code: await this.sequence.next('TICKET', u.companyId, now, tx),
          subject: input.subject,
          description: input.description ?? null,
          customerId: input.customerId ?? null,
          contactName: contact.name,
          contactEmail: contact.email,
          contactPhone: contact.phone,
          projectId: input.projectId ?? null,
          categoryCode: input.categoryCode ?? null,
          priorityCode: input.priorityCode,
          statusCode: status,
          channelCode: input.channelCode ?? null,
          assigneeId: staff ? input.assigneeId ?? null : null,
          dueAt: await this.dueAt(u.companyId, input.priorityCode, now),
          ...this.statusDates(status),
          createdById: u.id,
        },
      });
      await this.audit.record('Ticket', t.id, 'CREATE', undefined, t, tx);
      return t;
    });
  }

  async update(id: string, body: unknown) {
    RequestCtx.assert('support.ticket.update');
    const before = await this.own(id);
    if (!this.canEdit(before)) throw new ForbiddenException('You can only update tickets assigned to or created by you');
    const input = ticketSchema.partial().parse(body);
    await this.refs(input);
    const data: Prisma.TicketUncheckedUpdateInput = { ...input, updatedById: RequestCtx.user().id };
    if (input.priorityCode && input.priorityCode !== before.priorityCode) data.dueAt = await this.dueAt(before.companyId, input.priorityCode, before.createdAt);
    if (input.statusCode && input.statusCode !== before.statusCode) Object.assign(data, this.statusDates(input.statusCode, before));
    const t = await this.prisma.ticket.update({ where: { id }, data });
    await this.audit.record('Ticket', id, 'UPDATE', before, t);
    return t;
  }

  /** Board drag & drop */
  async move(id: string, statusCode: string) {
    return this.update(id, { statusCode });
  }

  async rate(id: string, satisfaction: number) {
    const before = await this.own(id);
    if (!this.canEdit(before) && before.createdById !== RequestCtx.user().id) throw new ForbiddenException();
    const t = await this.prisma.ticket.update({ where: { id }, data: { satisfaction } });
    await this.audit.record('Ticket', id, 'RATE', { satisfaction: before.satisfaction }, { satisfaction });
    return t;
  }

  async remove(id: string) {
    RequestCtx.assert('support.ticket.delete');
    const before = await this.own(id);
    await this.prisma.ticket.update({ where: { id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
    await this.audit.record('Ticket', id, 'DELETE', before);
    return { success: true };
  }

  // ---------------------------------------------------------------- conversation
  async addMessage(id: string, body: unknown) {
    RequestCtx.assert('support.ticket.read');
    const input = messageSchema.parse(body);
    const t = await this.own(id);
    const u = RequestCtx.user();
    const staff = this.canEdit(t);
    if ((input.isInternal || input.fromCustomer) && !staff) throw new ForbiddenException('Only support staff can add internal notes or log customer messages');
    const fromCustomer = input.fromCustomer && !input.isInternal;
    const m = await this.prisma.$transaction(async (tx) => {
      const m = await tx.ticketMessage.create({
        data: { ticketId: id, userId: fromCustomer ? null : u.id, authorName: fromCustomer ? t.contactName ?? 'Customer' : u.fullName, body: input.body, isInternal: input.isInternal },
      });
      const data: Prisma.TicketUncheckedUpdateInput = { updatedAt: new Date() };
      if (!fromCustomer && !input.isInternal && staff) {
        // first public answer of the support team
        if (!t.firstResponseAt) data.firstResponseAt = new Date();
        if (t.statusCode === 'OPEN') data.statusCode = 'IN_PROGRESS';
      }
      if (fromCustomer && ['WAITING', 'RESOLVED'].includes(t.statusCode)) Object.assign(data, { statusCode: 'IN_PROGRESS', ...this.statusDates('IN_PROGRESS') });
      await tx.ticket.update({ where: { id }, data });
      return m;
    });
    // public staff replies are e-mailed to the ticket contact (never internal notes or logged customer messages)
    const emailedTo = !fromCustomer && !input.isInternal && staff ? await this.emailReply(t, input.body, u.fullName) : null;
    return { ...m, emailedTo };
  }

  /** Sends a reply to the contact in the background; returns the address when it was queued, null when skipped */
  private async emailReply(t: Ticket, body: string, author: string) {
    if (!t.contactEmail || !(await this.settings.bool('helpdesk.emailCustomer', t.companyId, true))) return null;
    const [host, user, pass] = await Promise.all(['mail.host', 'mail.username', 'mail.password'].map((k) => this.settings.str(k, t.companyId)));
    if (!host || !user || !pass) return null; // SMTP not configured: skip silently
    const company = await this.prisma.company.findUnique({ where: { id: t.companyId }, select: { name: true } });
    const text = [`Hello${t.contactName ? ' ' + t.contactName : ''},`, '', body, '', `-- ${author}`, `${company?.name ?? ''} Support · Ticket ${t.code}`].join('\n');
    this.mail.send({ to: t.contactEmail, subject: `[${t.code}] ${t.subject}`, text }).catch((e) => this.log.warn(`Reply e-mail for ${t.code} failed: ${e?.message ?? e}`));
    return t.contactEmail;
  }

  async removeMessage(id: string, messageId: string) {
    const t = await this.own(id);
    const m = await this.prisma.ticketMessage.findFirst({ where: { id: messageId, ticketId: id } });
    if (!m) throw new NotFoundException('Message not found');
    const u = RequestCtx.user();
    if (m.userId !== u.id && !(RequestCtx.can('support.ticket.manage') || u.isSuperAdmin) && !(m.userId === null && this.canEdit(t))) throw new ForbiddenException('You can only delete your own messages');
    await this.prisma.ticketMessage.delete({ where: { id: messageId } });
    await this.audit.record('Ticket', id, 'DELETE_MESSAGE', { body: m.body.slice(0, 500) });
    return { success: true };
  }
}
