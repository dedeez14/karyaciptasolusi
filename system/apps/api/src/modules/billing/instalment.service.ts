import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { JournalService } from '../accounting/journal.service';
import { DocumentService } from '../documents/document.service';
import { buildSchedule, daysLate, lateFee, waterfall } from './instalment-calc';

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });
const CLAIM = '00000000-0000-0000-0000-000000000001';
const DAY = 86_400_000;

const rowSchema = z.object({ seq: z.coerce.number().int().min(0).max(600), dueDate: z.coerce.date(), amount: z.coerce.number().positive().max(1e15) });
export const planSchema = z.object({
  name: z.string().trim().min(1).max(200),
  customerId: z.uuid(),
  projectId: optUuid,
  kind: z.enum(['BILLING', 'SALE']),
  productId: optUuid,
  taxId: optUuid,
  saleInvoiceId: optUuid,
  totalAmount: z.coerce.number().positive().max(1e15).optional(),
  downPayment: z.coerce.number().min(0).max(1e15).default(0),
  downPaymentDate: z.coerce.date().optional(),
  count: z.coerce.number().int().min(1).max(600),
  intervalMonths: z.coerce.number().int().min(1).max(12).default(1),
  firstDueDate: z.coerce.date(),
  leadDays: z.coerce.number().int().min(0).max(60).default(0),
  autoConfirm: z.boolean().default(true),
  lateFeePct: z.coerce.number().min(0).max(10).default(0),
  lateFeeCapPct: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(100).nullable().optional()),
  graceDays: z.coerce.number().int().min(0).max(90).default(0),
  rows: z.array(rowSchema).max(601).optional(),
  notes: optText(2000),
});
export const scheduleSchema = z.object({ rows: z.array(rowSchema).min(1).max(601) });

type PlanFull = Prisma.InstalmentPlanGetPayload<{ include: { lines: true } }>;

/**
 * Instalment plans. BILLING: each instalment becomes an invoice when due (its PPN with it, PP 1/2012 Art. 17 for
 * services and termin; exempt education services under PP 49/2022). SALE: goods or property delivered on one invoice
 * (PPN due in full at delivery, UU PPN Art. 1A explanation), its payments followed against the schedule. Late fees are
 * invoiced apart, without PPN by default (S-380/PJ.32/1990). No interest is charged: a seller's own credit with a
 * financing charge may be a licensed financing activity (UU 4/2023, POJK 32/2025).
 */
@Injectable()
export class InstalmentService {
  private readonly logger = new Logger('InstalmentService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly docs: DocumentService,
  ) {}

  // ------------------------------------------------------------------ reading
  /** schedule with what is paid and open per instalment (BILLING: its invoice; SALE: payments of the invoice, oldest due first) */
  private async view(p: PlanFull, asOf = new Date(localIso())) {
    const lines = [...p.lines].sort((a, b) => a.seq - b.seq);
    const invIds = [...new Set([...lines.map((l) => l.invoiceId!), p.saleInvoiceId!].filter((x) => x && x !== CLAIM))];
    const invs = new Map((await this.prisma.tradeDocument.findMany({ where: { id: { in: invIds } }, select: { id: true, number: true, status: true, grandTotal: true, paidAmount: true, deletedAt: true } })).map((d) => [d.id, d]));
    let paidOpen: { paid: number; open: number }[];
    if (p.kind === 'SALE') {
      const inv = p.saleInvoiceId ? invs.get(p.saleInvoiceId) : undefined;
      paidOpen = waterfall(
        lines.map((l) => ({ amount: n(l.amount) })),
        n(inv?.paidAmount),
      );
    } else {
      paidOpen = lines.map((l) => {
        const inv = l.invoiceId ? invs.get(l.invoiceId) : undefined;
        if (!inv || inv.deletedAt || inv.status === 'CANCELLED' || inv.status === 'DRAFT') return { paid: 0, open: n(l.amount) };
        // the invoice may carry PPN: what is open of the instalment is in proportion to the invoice
        const total = n(inv.grandTotal);
        const share = total > 0 ? n(inv.paidAmount) / total : 0;
        const paid = r2(Math.min(1, share) * n(l.amount));
        return { paid, open: r2(n(l.amount) - paid) };
      });
    }
    const rows = lines.map((l, i) => {
      const inv = l.invoiceId && l.invoiceId !== CLAIM ? invs.get(l.invoiceId) : undefined;
      const late = paidOpen[i].open > 0 ? daysLate(l.dueDate, asOf, 0) : 0;
      return {
        id: l.id,
        seq: l.seq,
        dueDate: iso(l.dueDate),
        amount: n(l.amount),
        paid: paidOpen[i].paid,
        open: paidOpen[i].open,
        daysLate: late,
        lateFeeCharged: n(l.lateFeeCharged),
        invoice: inv && !inv.deletedAt ? { id: inv.id, number: inv.number, status: inv.status, total: n(inv.grandTotal), paid: n(inv.paidAmount) } : null,
        state: paidOpen[i].open <= 0 ? 'PAID' : late > 0 ? 'OVERDUE' : paidOpen[i].paid > 0 ? 'PART' : 'DUE',
      };
    });
    const sale = p.saleInvoiceId ? invs.get(p.saleInvoiceId) : undefined;
    const total = r2(rows.reduce((a, r) => a + r.amount, 0));
    const paid = r2(rows.reduce((a, r) => a + r.paid, 0));
    const overdue = r2(rows.filter((r) => r.state === 'OVERDUE').reduce((a, r) => a + r.open, 0));
    const next = rows.find((r) => r.open > 0);
    return {
      rows,
      sale: sale && !sale.deletedAt ? { id: sale.id, number: sale.number, status: sale.status, total: n(sale.grandTotal), paid: n(sale.paidAmount) } : null,
      totals: { total, paid, open: r2(total - paid), overdue, invoiced: rows.filter((r) => r.invoice).length, next: next ? { dueDate: next.dueDate, open: next.open, seq: next.seq } : null, paidUp: total > 0 && paid >= total - 0.005 },
    };
  }

  private shape(p: Prisma.InstalmentPlanGetPayload<object>) {
    return { ...p, totalAmount: n(p.totalAmount), downPayment: n(p.downPayment), firstDueDate: iso(p.firstDueDate), lateFeePct: n(p.lateFeePct), lateFeeCapPct: nn(p.lateFeeCapPct) };
  }

  async list(f: { status?: string; customerId?: string }) {
    RequestCtx.assert('sales.instalment.read');
    const companyId = RequestCtx.companyId();
    const plans = await this.prisma.instalmentPlan.findMany({ where: { companyId, ...(f.status ? { status: f.status } : {}), ...(f.customerId ? { customerId: f.customerId } : {}) }, include: { lines: true }, orderBy: { createdAt: 'desc' }, take: 300 });
    const customers = new Map((await this.prisma.customer.findMany({ where: { id: { in: plans.map((p) => p.customerId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    return Promise.all(plans.map(async (p) => ({ ...this.shape(p), customer: customers.get(p.customerId) ?? null, ...(await this.view(p)).totals })));
  }

  async get(id: string) {
    RequestCtx.assert('sales.instalment.read');
    const p = await this.prisma.instalmentPlan.findFirst({ where: { id, companyId: RequestCtx.companyId() }, include: { lines: true } });
    if (!p) throw new NotFoundException('Instalment plan not found');
    const [customer, product, tax, project] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: p.customerId }, select: { id: true, code: true, name: true } }),
      p.productId ? this.prisma.product.findUnique({ where: { id: p.productId }, select: { id: true, code: true, name: true } }) : null,
      p.taxId ? this.prisma.tax.findUnique({ where: { id: p.taxId }, select: { id: true, name: true } }) : null,
      p.projectId ? this.prisma.project.findUnique({ where: { id: p.projectId }, select: { id: true, code: true, name: true } }) : null,
    ]);
    return { ...this.shape(p), customer, product, tax, project, ...(await this.view(p)) };
  }

  // ------------------------------------------------------------------ writing
  private checkRows(rows: { seq: number; amount: number }[], total: number) {
    const sum = r2(rows.reduce((a, r) => a + r.amount, 0));
    if (Math.abs(sum - total) > 0.005) throw invalid({ rows: `The instalments add up to ${sum}, not ${total}` });
    if (new Set(rows.map((r) => r.seq)).size !== rows.length) throw invalid({ rows: 'Each instalment number once' });
  }

  async create(input: z.infer<typeof planSchema>) {
    RequestCtx.assert('sales.instalment.manage');
    const u = RequestCtx.user();
    const customer = await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: u.companyId, deletedAt: null } });
    if (!customer) throw invalid({ customerId: 'Customer not found' });
    let total: number;
    let taxId: string | null = null;
    if (input.kind === 'SALE') {
      if (!input.saleInvoiceId) throw invalid({ saleInvoiceId: 'Choose the sales invoice of the goods / property' });
      const inv = await this.prisma.tradeDocument.findFirst({ where: { id: input.saleInvoiceId, companyId: u.companyId, docType: 'SI', deletedAt: null } });
      if (!inv) throw invalid({ saleInvoiceId: 'Sales invoice not found' });
      if (!['CONFIRMED', 'PARTIAL'].includes(inv.status)) throw invalid({ saleInvoiceId: 'Confirm the invoice first (an open invoice)' });
      if (inv.customerId !== input.customerId) throw invalid({ saleInvoiceId: 'The invoice is of another customer' });
      if (await this.prisma.instalmentPlan.findFirst({ where: { saleInvoiceId: inv.id, status: 'ACTIVE' } })) throw invalid({ saleInvoiceId: 'The invoice already has an instalment plan' });
      total = r2(n(inv.grandTotal));
    } else {
      if (!input.productId) throw invalid({ productId: 'Choose the product / service the instalments are for' });
      const product = await this.prisma.product.findFirst({ where: { id: input.productId, companyId: u.companyId, deletedAt: null } });
      if (!product) throw invalid({ productId: 'Product not found' });
      if (!input.totalAmount) throw invalid({ totalAmount: 'Enter the amount of the plan (before tax)' });
      total = r2(input.totalAmount);
      const vat = await this.settings.bool('sales.vatPayer', u.companyId, true);
      taxId = vat ? (input.taxId === undefined ? product.saleTaxId : (input.taxId ?? null)) : null;
      if (taxId && !(await this.prisma.tax.findFirst({ where: { id: taxId, companyId: u.companyId, kind: 'VAT' } }))) throw invalid({ taxId: 'Choose a VAT (PPN)' });
    }
    if (input.downPayment >= total) throw invalid({ downPayment: 'The down payment is less than the total' });
    const rows = input.rows?.length ? input.rows.map((r) => ({ ...r, amount: r2(r.amount) })) : buildSchedule(total, input.downPayment, input.count, input.firstDueDate, input.intervalMonths, input.downPaymentDate);
    this.checkRows(rows, total);
    const plan = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequence.next('INSTALMENT', u.companyId, new Date(), tx);
      return tx.instalmentPlan.create({
        data: {
          companyId: u.companyId,
          branchId: u.branchId ?? null,
          number,
          name: input.name,
          customerId: input.customerId,
          projectId: input.projectId ?? null,
          kind: input.kind,
          productId: input.kind === 'BILLING' ? input.productId! : null,
          taxId,
          saleInvoiceId: input.kind === 'SALE' ? input.saleInvoiceId! : null,
          totalAmount: D(total),
          downPayment: D(input.downPayment),
          count: input.count,
          intervalMonths: input.intervalMonths,
          firstDueDate: input.firstDueDate,
          leadDays: input.leadDays,
          autoConfirm: input.autoConfirm,
          lateFeePct: D(input.lateFeePct),
          lateFeeCapPct: input.lateFeeCapPct === null || input.lateFeeCapPct === undefined ? null : D(input.lateFeeCapPct),
          graceDays: input.graceDays,
          notes: input.notes ?? null,
          createdById: u.id,
          updatedById: u.id,
          lines: { create: rows.map((r) => ({ seq: r.seq, dueDate: r.dueDate, amount: D(r.amount) })) },
        },
      });
    });
    await this.audit.record('Instalment Plan', plan.id, 'CREATE', null, { number: plan.number, kind: plan.kind, total });
    return this.get(plan.id);
  }

  /** change dates / amounts of instalments not invoiced yet; the plan still adds up to its total */
  async reschedule(id: string, input: z.infer<typeof scheduleSchema>) {
    RequestCtx.assert('sales.instalment.manage');
    const p = await this.prisma.instalmentPlan.findFirst({ where: { id, companyId: RequestCtx.companyId() }, include: { lines: true } });
    if (!p) throw new NotFoundException('Instalment plan not found');
    if (p.status !== 'ACTIVE') throw new ConflictException('The plan is cancelled');
    const fixed = p.lines.filter((l) => l.invoiceId);
    const free = input.rows.filter((r) => !fixed.some((f) => f.seq === r.seq));
    const rows = [...fixed.map((f) => ({ seq: f.seq, dueDate: f.dueDate, amount: n(f.amount) })), ...free.map((r) => ({ ...r, amount: r2(r.amount) }))];
    this.checkRows(rows, n(p.totalAmount));
    await this.prisma.$transaction([this.prisma.instalmentLine.deleteMany({ where: { planId: id, invoiceId: null } }), this.prisma.instalmentLine.createMany({ data: free.map((r) => ({ planId: id, seq: r.seq, dueDate: r.dueDate, amount: D(r2(r.amount)) })) })]);
    await this.audit.record('Instalment Plan', id, 'RESCHEDULE', p.lines.map((l) => ({ seq: l.seq, due: iso(l.dueDate), amount: n(l.amount) })), rows.map((r) => ({ seq: r.seq, due: iso(r.dueDate), amount: r.amount })));
    return this.get(id);
  }

  async cancel(id: string) {
    RequestCtx.assert('sales.instalment.manage');
    const p = await this.prisma.instalmentPlan.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!p) throw new NotFoundException('Instalment plan not found');
    if (p.status !== 'ACTIVE') throw new ConflictException('Already cancelled');
    await this.prisma.instalmentPlan.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
    await this.audit.record('Instalment Plan', id, 'CANCEL', { status: 'ACTIVE' }, { status: 'CANCELLED' });
    return this.get(id);
  }

  // ------------------------------------------------------------------ invoicing (BILLING)
  /** invoice one instalment (claimed first so two runs never bill it twice) */
  private async invoiceLine(p: Prisma.InstalmentPlanGetPayload<object>, l: { id: string; seq: number; dueDate: Date; amount: Prisma.Decimal }, count: number) {
    const claimed = await this.prisma.instalmentLine.updateMany({ where: { id: l.id, invoiceId: null }, data: { invoiceId: CLAIM } });
    if (!claimed.count) return null;
    const today = new Date(localIso());
    try {
      const doc = await this.docs.create(
        'SI',
        {
          date: localIso(l.dueDate < today ? l.dueDate : today),
          dueDate: localIso(l.dueDate < today ? today : l.dueDate),
          customerId: p.customerId,
          projectId: p.projectId,
          reference: p.number,
          notes: `${p.name}: ${l.seq === 0 ? 'down payment' : `instalment ${l.seq} of ${count}`}, due ${iso(l.dueDate)}`,
          lines: [{ productId: p.productId, description: `${p.name} - ${l.seq === 0 ? 'down payment' : `instalment ${l.seq} of ${count}`}`, qty: 1, unitPrice: n(l.amount), taxId: p.taxId }],
        },
        undefined,
        { skipPermission: true },
      );
      await this.prisma.instalmentLine.update({ where: { id: l.id }, data: { invoiceId: doc.id } });
      if (p.autoConfirm) {
        try {
          await this.docs.confirm('SI', doc.id);
        } catch (e) {
          this.logger.warn(`${p.number} instalment ${l.seq}: invoice left as draft - ${(e as Error).message}`);
        }
      }
      await this.audit.record('Instalment Plan', p.id, 'INVOICE', null, { seq: l.seq, invoice: doc.number });
      return { id: doc.id, number: doc.number };
    } catch (e) {
      await this.prisma.instalmentLine.updateMany({ where: { id: l.id, invoiceId: CLAIM }, data: { invoiceId: null } });
      throw e;
    }
  }

  /** invoices every instalment of active BILLING plans that is due (within its lead days); run daily by the scheduler */
  async runDue(asOf = new Date(localIso())) {
    const companyId = RequestCtx.companyId();
    const plans = await this.prisma.instalmentPlan.findMany({ where: { companyId, kind: 'BILLING', status: 'ACTIVE' }, include: { lines: { where: { invoiceId: null }, orderBy: { seq: 'asc' } } } });
    let created = 0;
    let failed = 0;
    for (const p of plans) {
      const count = await this.prisma.instalmentLine.count({ where: { planId: p.id, seq: { gt: 0 } } });
      for (const l of p.lines) {
        if (l.dueDate.getTime() - p.leadDays * DAY > asOf.getTime()) continue;
        try {
          if (await this.invoiceLine(p, l, count)) created++;
        } catch (e) {
          failed++;
          this.logger.warn(`${p.number}: ${(e as Error).message}`);
        }
      }
    }
    return { created, failed };
  }

  async runNow() {
    RequestCtx.assert('sales.instalment.manage');
    return this.runDue();
  }

  /** invoice one instalment ahead of time (BILLING) */
  async billLine(id: string, lineId: string) {
    RequestCtx.assert('sales.instalment.manage');
    const p = await this.prisma.instalmentPlan.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!p) throw new NotFoundException('Instalment plan not found');
    if (p.kind !== 'BILLING' || p.status !== 'ACTIVE') throw new ConflictException('Only instalments of an active billing plan are invoiced');
    const l = await this.prisma.instalmentLine.findFirst({ where: { id: lineId, planId: id } });
    if (!l) throw new NotFoundException('Instalment not found');
    if (l.invoiceId) throw new ConflictException('Already invoiced');
    const count = await this.prisma.instalmentLine.count({ where: { planId: id, seq: { gt: 0 } } });
    await this.invoiceLine(p, l, count);
    return this.get(id);
  }

  // ------------------------------------------------------------------ late fees
  /** late fee item: income to Late Payment Fees, no PPN unless the setting says so */
  private async lateFeeProduct(companyId: string) {
    const found = await this.prisma.product.findFirst({ where: { companyId, code: 'LATE-FEE', deletedAt: null }, select: { id: true } });
    if (found) return found.id;
    const income = await this.prisma.$transaction((tx) => this.journal.mapping(tx, companyId, 'LATE_FEE_INCOME'));
    const p = await this.prisma.product.create({ data: { companyId, code: 'LATE-FEE', name: 'Late payment fee', type: 'SERVICE', incomeAccountId: income, isPurchasable: false, description: 'Made by instalment plans: late payment fees (denda keterlambatan)', createdById: RequestCtx.user().id } });
    return p.id;
  }

  /** what late fees are owed on the date, per overdue instalment (less what was already invoiced) */
  async lateFees(id: string, asOfIso?: string) {
    RequestCtx.assert('sales.instalment.read');
    const p = await this.prisma.instalmentPlan.findFirst({ where: { id, companyId: RequestCtx.companyId() }, include: { lines: true } });
    if (!p) throw new NotFoundException('Instalment plan not found');
    const asOf = new Date(asOfIso ?? localIso());
    const v = await this.view(p, asOf);
    const rows = v.rows
      .map((r) => {
        const days = daysLate(new Date(r.dueDate!), asOf, p.graceDays);
        return { lineId: r.id, seq: r.seq, dueDate: r.dueDate, open: r.open, days, charged: r.lateFeeCharged, fee: lateFee(r.open, days, n(p.lateFeePct), r.lateFeeCharged, nn(p.lateFeeCapPct)) };
      })
      .filter((r) => r.fee > 0);
    return { asOf: iso(asOf), pctPerMonth: n(p.lateFeePct), graceDays: p.graceDays, capPct: nn(p.lateFeeCapPct), rows, total: rows.reduce((a, r) => a + r.fee, 0) };
  }

  /** invoice the late fees owed (draft, to review) */
  async chargeLateFees(id: string, asOfIso?: string) {
    RequestCtx.assert('sales.instalment.manage');
    const u = RequestCtx.user();
    const p = await this.prisma.instalmentPlan.findFirst({ where: { id, companyId: u.companyId } });
    if (!p) throw new NotFoundException('Instalment plan not found');
    const lf = await this.lateFees(id, asOfIso);
    if (!lf.rows.length) throw new ConflictException('No late fees owed');
    const productId = await this.lateFeeProduct(u.companyId);
    const taxable = await this.settings.bool('sales.lateFeeVat', u.companyId, false);
    const vat = taxable && (await this.settings.bool('sales.vatPayer', u.companyId, true));
    const ppn = vat ? await this.prisma.tax.findFirst({ where: { companyId: u.companyId, kind: 'VAT', isActive: true, deletedAt: null, rate: 12, baseNumerator: 11, baseDenominator: 12 } }) : null;
    const doc = await this.docs.create(
      'SI',
      {
        date: localIso(),
        customerId: p.customerId,
        reference: p.number,
        notes: `Late payment fees of ${p.name} to ${lf.asOf}: ${lf.pctPerMonth}% per month of the overdue amount after ${lf.graceDays} days' grace`,
        lines: lf.rows.map((r) => ({ productId, description: `Late fee, ${r.seq === 0 ? 'down payment' : `instalment ${r.seq}`} due ${r.dueDate}: ${r.days} days on ${r.open}`, qty: 1, unitPrice: r.fee, taxId: ppn?.id ?? null })),
      },
      undefined,
      { skipPermission: true },
    );
    await this.prisma.$transaction(lf.rows.map((r) => this.prisma.instalmentLine.update({ where: { id: r.lineId }, data: { lateFeeCharged: { increment: D(r.fee) } } })));
    await this.audit.record('Instalment Plan', id, 'LATE_FEES', null, { invoice: doc.number, total: lf.total });
    return { invoiceId: doc.id, number: doc.number, total: lf.total };
  }

  /** open instalments of every active plan: what falls due and what is overdue */
  async overview(asOfIso?: string) {
    RequestCtx.assert('sales.instalment.read');
    const companyId = RequestCtx.companyId();
    const asOf = new Date(asOfIso ?? localIso());
    const plans = await this.prisma.instalmentPlan.findMany({ where: { companyId, status: 'ACTIVE' }, include: { lines: true } });
    const customers = new Map((await this.prisma.customer.findMany({ where: { id: { in: plans.map((p) => p.customerId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const buckets = [0, 0, 0, 0, 0];
    const rows: { planId: string; number: string; name: string; customer: string | null; seq: number; dueDate: string; open: number; daysLate: number }[] = [];
    for (const p of plans) {
      const v = await this.view(p, asOf);
      for (const r of v.rows) {
        if (r.open <= 0) continue;
        const d = r.daysLate;
        buckets[d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4] += r.open;
        rows.push({ planId: p.id, number: p.number, name: p.name, customer: customers.get(p.customerId) ?? null, seq: r.seq, dueDate: r.dueDate!, open: r.open, daysLate: d });
      }
    }
    return { asOf: iso(asOf), buckets: buckets.map(r2), overdue: rows.filter((r) => r.daysLate > 0).sort((a, b) => b.daysLate - a.daysLate).slice(0, 200), upcoming: rows.filter((r) => r.daysLate <= 0 && new Date(r.dueDate).getTime() <= asOf.getTime() + 31 * DAY).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 200) };
  }
}
