import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const DAY = 86_400_000;
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });
const LIVE = ['CONFIRMED', 'PARTIAL', 'COMPLETED'];

/** PP 9/2022 Art. 3: PPh final rates on construction income by the kind of service and the provider's certificate */
export const PPH_RATES: Record<string, Record<string, number>> = {
  WORK: { SMALL: 1.75, OTHER: 2.65, NONE: 4 },
  INTEGRATED: { SMALL: 2.65, OTHER: 2.65, NONE: 4 },
  CONSULTANCY: { SMALL: 3.5, OTHER: 3.5, NONE: 6 },
};
export const pphRate = (kind: string, qual: string) => PPH_RATES[kind]?.[qual] ?? 4;

export const contractSchema = z.object({
  projectId: z.uuid(),
  customerId: z.uuid(),
  contractNo: z.string().trim().min(1).max(60),
  contractDate: z.coerce.date(),
  title: z.string().trim().min(1).max(200),
  vat: z.boolean().default(true),
  govCollector: z.boolean().default(false),
  serviceKind: z.enum(['WORK', 'INTEGRATED', 'CONSULTANCY']).default('WORK'),
  qualification: z.enum(['SMALL', 'OTHER', 'NONE']).default('SMALL'),
  advancePct: z.coerce.number().min(0).max(100).default(0),
  retentionPct: z.coerce.number().min(0).max(20).default(5),
  maintenanceDays: z.coerce.number().int().min(0).max(3650).default(180),
  startDate: optDate,
  finishDate: optDate,
  notes: optText(4000),
  boq: z
    .array(
      z.object({
        id: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
        code: z.string().trim().min(1).max(30),
        description: z.string().trim().min(1).max(300),
        unit: z.string().trim().min(1).max(20),
        qty: z.coerce.number().positive().max(1e12),
        unitPrice: z.coerce.number().min(0).max(1e13),
        budgetUnitCost: z.coerce.number().min(0).max(1e13).default(0),
        costType: z.enum(['MATERIAL', 'LABOUR', 'EQUIPMENT', 'SUBCON', 'OVERHEAD', 'MIXED']).default('MIXED'),
      }),
    )
    .min(1, 'Add the BoQ items')
    .max(2000),
});
export const certificateSchema = z.object({
  date: z.coerce.date(),
  periodTo: z.coerce.date(),
  clientRef: optText(80),
  notes: optText(2000),
  lines: z.array(z.object({ boqItemId: z.uuid(), cumQty: z.coerce.number().min(0).max(1e12) })).max(2000),
});
export const subcontractSchema = z.object({
  contractId: z.uuid(),
  supplierId: z.uuid(),
  scope: z.string().trim().min(1).max(300),
  value: z.coerce.number().positive().max(1e14),
  retentionPct: z.coerce.number().min(0).max(20).default(5),
  vat: z.boolean().default(true),
  pphRate: z.coerce.number().min(0).max(10).default(1.75),
  notes: optText(2000),
});
export const claimSchema = z.object({ date: z.coerce.date(), cumPct: z.coerce.number().positive().max(100), supplierRef: optText(80) });

type Tx = Prisma.TransactionClient;

/**
 * Construction contracts (UU 2/2017 jo UU 6/2023): BoQ priced and budgeted, advance invoiced and recovered pro rata from
 * each progress certificate, retention held from each certificate; PPN on what is paid as it is paid (advance, termin)
 * and on the whole service at the provisional handover (BAST 1): the retention is invoiced with its PPN then, payable at
 * the end of maintenance (DJP, Aspek Perpajakan Usaha Jasa Konstruksi, 2026). PPh final 4(2) (PP 9/2022) on each payment
 * received, withheld by the client or paid by us; on subcontractors we withhold it.
 */
@Injectable()
export class ConstructionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly docs: DocumentService,
  ) {}

  // ------------------------------------------------------------------ helpers
  private async product(companyId: string, code: string, name: string, key: string, side: 'income' | 'expense') {
    const found = await this.prisma.product.findFirst({ where: { companyId, code, deletedAt: null }, select: { id: true } });
    if (found) return found.id;
    const account = await this.prisma.$transaction((tx) => this.journal.mapping(tx, companyId, key));
    const p = await this.prisma.product.create({
      data: {
        companyId,
        code,
        name,
        type: 'SERVICE',
        ...(side === 'income' ? { incomeAccountId: account, isPurchasable: false } : { expenseAccountId: account, isSellable: false }),
        description: 'Made by the construction module',
        createdById: RequestCtx.user().id,
      },
    });
    return p.id;
  }

  private async ppnTax(companyId: string) {
    const t = await this.prisma.tax.findFirst({ where: { companyId, code: 'PPN12', kind: 'VAT', isActive: true, deletedAt: null }, select: { id: true } });
    if (!t) throw new BadRequestException('Tax PPN12 (PPN 12% x DPP 11/12) is missing: add it in Master > Taxes');
    return t.id;
  }

  /** creates and confirms a sales / purchase invoice; a draft that cannot be confirmed is dropped (SI) or kept for approval (PI) */
  private async invoice(type: 'SI' | 'PI', body: Record<string, unknown>) {
    const doc = (await this.docs.create(type, body, undefined, { skipPermission: true })) as { id: string; number: string };
    try {
      await this.docs.confirm(type, doc.id, { skipPermission: true });
      return { ...doc, confirmed: true };
    } catch (e) {
      if (type === 'PI') return { ...doc, confirmed: false, reason: (e as Error).message };
      await this.prisma.tradeDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
      throw e;
    }
  }

  private async contractOf(id: string, companyId: string) {
    const c = await this.prisma.constructionContract.findFirst({ where: { id, companyId }, include: { boq: { orderBy: [{ sortOrder: 'asc' }] } } });
    if (!c) throw new NotFoundException('Contract not found');
    return c;
  }

  private async liveInvoice(id: string | null) {
    if (!id) return null;
    const d = await this.prisma.tradeDocument.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, number: true, status: true, grandTotal: true, paidAmount: true, taxTotal: true, date: true, dueDate: true },
    });
    return d && d.status !== 'CANCELLED' ? d : null;
  }

  private shapeContract(c: Prisma.ConstructionContractGetPayload<{ include: { boq: true } }>) {
    return {
      ...c,
      contractDate: iso(c.contractDate),
      startDate: iso(c.startDate),
      finishDate: iso(c.finishDate),
      phoDate: iso(c.phoDate),
      fhoDate: iso(c.fhoDate),
      contractValue: n(c.contractValue),
      pphRate: n(c.pphRate),
      advancePct: n(c.advancePct),
      advanceAmount: n(c.advanceAmount),
      retentionPct: n(c.retentionPct),
      boq: c.boq.map((b) => ({
        ...b,
        qty: n(b.qty),
        unitPrice: n(b.unitPrice),
        budgetUnitCost: n(b.budgetUnitCost),
        certifiedQty: n(b.certifiedQty),
        value: r2(n(b.qty) * n(b.unitPrice)),
        budget: r2(n(b.qty) * n(b.budgetUnitCost)),
        certifiedValue: r2(n(b.certifiedQty) * n(b.unitPrice)),
      })),
    };
  }

  // ------------------------------------------------------------------ contracts
  async contracts(status?: string) {
    RequestCtx.assert('construction.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.constructionContract.findMany({
      where: { companyId, ...(status ? { status } : { status: { not: 'CANCELLED' } }) },
      orderBy: { contractDate: 'desc' },
      include: { boq: true, certificates: { where: { status: 'APPROVED' }, select: { retention: true, advanceRecovery: true } } },
    });
    const cust = await this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, name: true } });
    const projects = await this.prisma.project.findMany({ where: { id: { in: rows.map((r) => r.projectId) } }, select: { id: true, code: true, name: true } });
    return rows.map(({ certificates, ...c }) => {
      const s = this.shapeContract(c);
      const certified = r2(s.boq.reduce((a, b) => a + b.certifiedValue, 0));
      return {
        ...s,
        boq: undefined,
        items: s.boq.length,
        customer: cust.find((x) => x.id === c.customerId)?.name ?? null,
        project: projects.find((p) => p.id === c.projectId) ?? null,
        certified,
        progressPct: s.contractValue > 0 ? r2((certified / s.contractValue) * 100) : 0,
        retentionHeld: r2(certificates.reduce((a, x) => a + n(x.retention), 0)),
      };
    });
  }

  async contract(id: string) {
    RequestCtx.assert('construction.read');
    const companyId = RequestCtx.companyId();
    const c = await this.contractOf(id, companyId);
    const s = this.shapeContract(c);
    const [customer, project, certs, subs] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: c.customerId }, select: { id: true, code: true, name: true } }),
      this.prisma.project.findUnique({ where: { id: c.projectId }, select: { id: true, code: true, name: true } }),
      this.prisma.progressCertificate.findMany({ where: { contractId: id }, orderBy: { seq: 'asc' } }),
      this.prisma.subcontract.findMany({ where: { contractId: id, status: { not: 'CANCELLED' } } }),
    ]);
    const approved = certs.filter((x) => x.status === 'APPROVED');
    const invoiceIds = [c.advanceInvoiceId, c.retentionInvoiceId, ...approved.map((x) => x.invoiceId)].filter(Boolean) as string[];
    const invoices = await this.prisma.tradeDocument.findMany({
      where: { id: { in: invoiceIds }, deletedAt: null, status: { not: 'CANCELLED' } },
      select: { id: true, number: true, status: true, date: true, dueDate: true, grandTotal: true, paidAmount: true, taxTotal: true },
    });
    // costs booked to the project (expense and cost-of-sales accounts)
    const cost = await this.prisma.$queryRaw<{ v: Prisma.Decimal | null }[]>`
      SELECT SUM(l.debit - l.credit) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId" JOIN accounts a ON a.id = l."accountId"
      WHERE e."companyId" = ${companyId}::uuid AND e.status = 'POSTED' AND l."projectId" = ${c.projectId}::uuid AND a.type = 'EXPENSE'`;
    const actualCost = r2(n(cost[0]?.v));
    const budgetCost = r2(s.boq.reduce((a, b) => a + b.budget, 0));
    const certified = r2(s.boq.reduce((a, b) => a + b.certifiedValue, 0));
    const advanceLive = await this.liveInvoice(c.advanceInvoiceId);
    const recovered = r2(approved.reduce((a, x) => a + n(x.advanceRecovery), 0));
    const retentionHeld = r2(approved.reduce((a, x) => a + n(x.retention), 0));
    const earnedByCost = budgetCost > 0 ? r2(s.contractValue * Math.min(1, actualCost / budgetCost)) : 0;
    return {
      ...s,
      customer,
      project,
      certificates: certs.map((x) => ({
        id: x.id,
        number: x.number,
        seq: x.seq,
        date: iso(x.date),
        periodTo: iso(x.periodTo),
        status: x.status,
        thisValue: n(x.thisValue),
        cumulativeValue: n(x.cumulativeValue),
        advanceRecovery: n(x.advanceRecovery),
        retention: n(x.retention),
        netAmount: n(x.netAmount),
        ppn: n(x.ppn),
        invoice: invoices.find((i) => i.id === x.invoiceId) ?? null,
      })),
      subcontracts: subs.map((x) => ({ id: x.id, supplierId: x.supplierId, scope: x.scope, value: n(x.value), claimedPct: n(x.claimedPct), retentionHeld: n(x.retentionHeld) })),
      advanceInvoice: advanceLive ? (invoices.find((i) => i.id === advanceLive.id) ?? null) : null,
      retentionInvoice: invoices.find((i) => i.id === c.retentionInvoiceId) ?? null,
      summary: {
        budgetCost,
        budgetMargin: r2(s.contractValue - budgetCost),
        certified,
        progressPct: s.contractValue > 0 ? r2((certified / s.contractValue) * 100) : 0,
        actualCost,
        costPct: budgetCost > 0 ? r2((actualCost / budgetCost) * 100) : 0,
        earnedByCost,
        overBilling: r2(certified - earnedByCost),
        advance: advanceLive ? n(c.advanceAmount) : 0,
        advanceRecovered: recovered,
        advanceOutstanding: advanceLive ? r2(n(c.advanceAmount) - recovered) : 0,
        retentionHeld,
        billed: r2(invoices.reduce((a, i) => a + n(i.grandTotal), 0)),
        received: r2(invoices.reduce((a, i) => a + n(i.paidAmount), 0)),
        maintenanceEnds: c.phoDate ? iso(new Date(c.phoDate.getTime() + c.maintenanceDays * DAY)) : null,
      },
    };
  }

  async saveContract(id: string | null, input: z.infer<typeof contractSchema>) {
    RequestCtx.assert('construction.manage');
    const u = RequestCtx.user();
    const project = await this.prisma.project.findFirst({ where: { id: input.projectId, companyId: u.companyId, deletedAt: null } });
    if (!project) throw invalid({ projectId: 'Choose a project of this company' });
    const customer = await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: u.companyId, deletedAt: null } });
    if (!customer) throw invalid({ customerId: 'Choose a customer' });
    const codes = new Set<string>();
    for (const [i, b] of input.boq.entries()) {
      if (codes.has(b.code)) throw invalid({ [`boq.${i}.code`]: `Item ${b.code} is listed twice` });
      codes.add(b.code);
    }
    const value = r2(input.boq.reduce((a, b) => a + r2(b.qty * b.unitPrice), 0));
    if (value <= 0) throw invalid({ boq: 'The BoQ has no value' });
    const saved = await this.prisma.$transaction(async (tx) => {
      const other = await tx.constructionContract.findFirst({ where: { projectId: input.projectId, ...(id ? { id: { not: id } } : {}) } });
      if (other) throw invalid({ projectId: `Project already has contract ${other.contractNo}` });
      const data = {
        projectId: input.projectId,
        customerId: input.customerId,
        contractNo: input.contractNo,
        contractDate: input.contractDate,
        title: input.title,
        contractValue: D(value),
        vat: input.vat,
        govCollector: input.govCollector,
        serviceKind: input.serviceKind,
        qualification: input.qualification,
        pphRate: D(pphRate(input.serviceKind, input.qualification)),
        advancePct: D(input.advancePct),
        retentionPct: D(input.retentionPct),
        maintenanceDays: input.maintenanceDays,
        startDate: input.startDate ?? null,
        finishDate: input.finishDate ?? null,
        notes: input.notes ?? null,
        updatedById: u.id,
      };
      let c;
      if (id) {
        const cur = await tx.constructionContract.findFirst({ where: { id, companyId: u.companyId }, include: { boq: true } });
        if (!cur) throw new NotFoundException('Contract not found');
        if (cur.status !== 'ACTIVE') throw new ConflictException('The contract is handed over or cancelled');
        if (cur.advanceInvoiceId && (await this.liveInvoice(cur.advanceInvoiceId)) && n(cur.advancePct) !== input.advancePct) throw invalid({ advancePct: 'The advance is invoiced already' });
        const draft = await tx.progressCertificate.count({ where: { contractId: id, status: 'DRAFT' } });
        if (draft) throw new ConflictException('Approve or cancel the draft certificate before changing the BoQ');
        // addenda: items certified stay, with at least what is certified
        for (const b of cur.boq) {
          const keep = input.boq.find((x) => x.id === b.id);
          if (!keep && n(b.certifiedQty) > 0) throw invalid({ boq: `${b.code} is certified: it cannot be removed` });
          if (keep && keep.qty < n(b.certifiedQty)) throw invalid({ boq: `${b.code}: ${n(b.certifiedQty)} ${b.unit} certified already` });
          if (keep && n(b.certifiedQty) > 0 && keep.unitPrice !== n(b.unitPrice)) throw invalid({ boq: `${b.code}: the price of a certified item cannot change` });
        }
        c = await tx.constructionContract.update({ where: { id }, data });
        const ids = input.boq.map((b) => b.id).filter(Boolean) as string[];
        await tx.boqItem.deleteMany({ where: { contractId: id, id: { notIn: ids } } });
        for (const [i, b] of input.boq.entries()) {
          const row = { sortOrder: i, code: b.code, description: b.description, unit: b.unit, qty: D(b.qty), unitPrice: D(b.unitPrice), budgetUnitCost: D(b.budgetUnitCost), costType: b.costType };
          if (b.id && cur.boq.some((x) => x.id === b.id)) await tx.boqItem.update({ where: { id: b.id }, data: row });
          else await tx.boqItem.create({ data: { ...row, contractId: id } });
        }
      } else {
        c = await tx.constructionContract.create({ data: { ...data, companyId: u.companyId, branchId: project.branchId ?? null, createdById: u.id } });
        await tx.boqItem.createMany({
          data: input.boq.map((b, i) => ({
            contractId: c!.id,
            sortOrder: i,
            code: b.code,
            description: b.description,
            unit: b.unit,
            qty: D(b.qty),
            unitPrice: D(b.unitPrice),
            budgetUnitCost: D(b.budgetUnitCost),
            costType: b.costType,
          })),
        });
      }
      return c;
    });
    await this.audit.record('Construction Contract', saved.id, id ? 'UPDATE' : 'CREATE', null, { contractNo: saved.contractNo, value });
    return this.contract(saved.id);
  }

  private async vatOn(c: { vat: boolean; companyId: string }) {
    return c.vat && (await this.settings.bool('sales.vatPayer', c.companyId, true));
  }

  private noteFor(c: { pphRate: Prisma.Decimal; govCollector: boolean }, extra: string) {
    return `${extra}\nPPh final 4(2) ${n(c.pphRate)}% of the payment before PPN is withheld by the client or paid by us (PP 9/2022).${c.govCollector ? '\nClient is a PPN collector: faktur code 02, DPP 11/12.' : ''}`;
  }

  /** the advance (uang muka): PPN due when it is paid, recovered from each certificate pro rata */
  async invoiceAdvance(id: string) {
    RequestCtx.assert('construction.manage');
    const u = RequestCtx.user();
    const c = await this.contractOf(id, u.companyId);
    if (c.status !== 'ACTIVE') throw new ConflictException('The contract is handed over or cancelled');
    if (n(c.advancePct) <= 0) throw invalid({ advancePct: 'The contract has no advance' });
    if (await this.liveInvoice(c.advanceInvoiceId)) throw new ConflictException('The advance is invoiced already');
    const certified = await this.prisma.progressCertificate.count({ where: { contractId: id, status: 'APPROVED' } });
    if (certified) throw new ConflictException('Certificates are approved already: the advance comes before the first certificate');
    const amount = r2((n(c.contractValue) * n(c.advancePct)) / 100);
    const vat = await this.vatOn(c);
    const productId = await this.product(u.companyId, 'CONS-ADVANCE', 'Construction advance payment (uang muka)', 'CONSTRUCTION_ADVANCE', 'income');
    const si = await this.invoice('SI', {
      date: new Date(new Date().toISOString().slice(0, 10)),
      customerId: c.customerId,
      projectId: c.projectId,
      reference: c.contractNo,
      notes: this.noteFor(c, `Advance payment ${n(c.advancePct)}% of contract ${c.contractNo} (${c.title}).`),
      lines: [{ productId, description: `Advance payment ${n(c.advancePct)}% - ${c.title}`, qty: 1, unitPrice: amount, taxId: vat ? await this.ppnTax(u.companyId) : null }],
    });
    await this.prisma.constructionContract.update({ where: { id }, data: { advanceAmount: D(amount), advanceInvoiceId: si.id, updatedById: u.id } });
    await this.audit.record('Construction Contract', id, 'ADVANCE', null, { invoice: si.number, amount });
    return this.contract(id);
  }

  // ------------------------------------------------------------------ progress certificates
  async certificates(contractId?: string) {
    RequestCtx.assert('construction.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.progressCertificate.findMany({
      where: { companyId, ...(contractId ? { contractId } : {}) },
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: 300,
      include: { contract: { select: { contractNo: true, title: true, customerId: true, contractValue: true } } },
    });
    const inv = await this.prisma.tradeDocument.findMany({
      where: { id: { in: rows.map((r) => r.invoiceId).filter(Boolean) as string[] } },
      select: { id: true, number: true, status: true, grandTotal: true, paidAmount: true },
    });
    const cust = await this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.contract.customerId) } }, select: { id: true, name: true } });
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      seq: r.seq,
      contractId: r.contractId,
      contractNo: r.contract.contractNo,
      title: r.contract.title,
      customer: cust.find((c) => c.id === r.contract.customerId)?.name ?? null,
      date: iso(r.date),
      periodTo: iso(r.periodTo),
      status: r.status,
      thisValue: n(r.thisValue),
      cumulativeValue: n(r.cumulativeValue),
      progressPct: n(r.contract.contractValue) > 0 ? r2((n(r.cumulativeValue) / n(r.contract.contractValue)) * 100) : 0,
      advanceRecovery: n(r.advanceRecovery),
      retention: n(r.retention),
      netAmount: n(r.netAmount),
      ppn: n(r.ppn),
      invoice: inv.find((i) => i.id === r.invoiceId) ?? null,
    }));
  }

  async certificate(id: string) {
    RequestCtx.assert('construction.read');
    const companyId = RequestCtx.companyId();
    const r = await this.prisma.progressCertificate.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!r) throw new NotFoundException('Certificate not found');
    const c = await this.contractOf(r.contractId, companyId);
    const inv = await this.liveInvoice(r.invoiceId);
    return {
      ...r,
      date: iso(r.date),
      periodTo: iso(r.periodTo),
      cumulativeValue: n(r.cumulativeValue),
      previousValue: n(r.previousValue),
      thisValue: n(r.thisValue),
      advanceRecovery: n(r.advanceRecovery),
      retention: n(r.retention),
      netAmount: n(r.netAmount),
      ppn: n(r.ppn),
      contract: { id: c.id, contractNo: c.contractNo, title: c.title, contractValue: n(c.contractValue), retentionPct: n(c.retentionPct), advancePct: n(c.advancePct), pphRate: n(c.pphRate) },
      invoice: inv ? { id: inv.id, number: inv.number, status: inv.status, grandTotal: n(inv.grandTotal), paidAmount: n(inv.paidAmount) } : null,
      lines: c.boq.map((b) => {
        const l = r.lines.find((x) => x.boqItemId === b.id);
        return {
          boqItemId: b.id,
          code: b.code,
          description: b.description,
          unit: b.unit,
          qty: n(b.qty),
          unitPrice: n(b.unitPrice),
          prevQty: l ? n(l.prevQty) : n(b.certifiedQty),
          cumQty: l ? n(l.cumQty) : n(b.certifiedQty),
          thisQty: l ? n(l.thisQty) : 0,
          thisValue: l ? n(l.thisValue) : 0,
        };
      }),
    };
  }

  /** amounts of a certificate from the cumulative quantities */
  private async compute(tx: Tx, c: Prisma.ConstructionContractGetPayload<{ include: { boq: true } }>, input: z.infer<typeof certificateSchema>) {
    const errors: Record<string, string> = {};
    const lines = c.boq.map((b) => {
      const k = input.lines.findIndex((x) => x.boqItemId === b.id);
      const prev = n(b.certifiedQty);
      const cum = k >= 0 ? r4(input.lines[k].cumQty) : prev;
      if (cum < prev - 1e-9) errors[`lines.${k}.cumQty`] = `${b.code}: ${prev} ${b.unit} certified before; the cumulative quantity cannot go down`;
      if (cum > n(b.qty) + 1e-9) errors[`lines.${k}.cumQty`] = `${b.code}: more than the ${n(b.qty)} ${b.unit} in the BoQ (add it by addendum)`;
      return { boqItemId: b.id, prevQty: prev, cumQty: cum, thisQty: r4(cum - prev), thisValue: r2((cum - prev) * n(b.unitPrice)) };
    });
    if (Object.keys(errors).length) throw invalid(errors);
    const thisValue = r2(lines.reduce((a, l) => a + l.thisValue, 0));
    if (thisValue <= 0) throw invalid({ lines: 'No progress since the last certificate' });
    const previousValue = r2(c.boq.reduce((a, b) => a + r2(n(b.certifiedQty) * n(b.unitPrice)), 0));
    const cumulativeValue = r2(previousValue + thisValue);
    const contractValue = n(c.contractValue);
    // advance recovered pro rata to the work certified; all of what is left on the certificate that completes the contract
    let advanceRecovery = 0;
    if (c.advanceInvoiceId && (await this.liveInvoice(c.advanceInvoiceId))) {
      const recovered = n((await tx.progressCertificate.aggregate({ where: { contractId: c.id, status: 'APPROVED' }, _sum: { advanceRecovery: true } }))._sum.advanceRecovery);
      const left = r2(n(c.advanceAmount) - recovered);
      advanceRecovery = cumulativeValue >= contractValue - 0.004 ? left : Math.min(left, r2((thisValue * n(c.advanceAmount)) / contractValue));
    }
    const retention = r2((thisValue * n(c.retentionPct)) / 100);
    return { lines, thisValue, previousValue, cumulativeValue, advanceRecovery, retention, netAmount: r2(thisValue - advanceRecovery - retention) };
  }

  async saveCertificate(contractId: string, id: string | null, input: z.infer<typeof certificateSchema>) {
    RequestCtx.assert('construction.certify');
    const u = RequestCtx.user();
    const c = await this.contractOf(contractId, u.companyId);
    if (c.status !== 'ACTIVE') throw new ConflictException('The contract is handed over or cancelled: no more certificates');
    if (input.periodTo.getTime() > input.date.getTime()) throw invalid({ periodTo: 'The period ends after the certificate date' });
    const saved = await this.prisma.$transaction(async (tx) => {
      if (id) {
        const cur = await tx.progressCertificate.findFirst({ where: { id, contractId, companyId: u.companyId } });
        if (!cur) throw new NotFoundException('Certificate not found');
        if (cur.status !== 'DRAFT') throw new ConflictException('Only a draft certificate can be changed');
      } else if (await tx.progressCertificate.count({ where: { contractId, status: 'DRAFT' } })) throw new ConflictException('The contract has a draft certificate already');
      const last = await tx.progressCertificate.findFirst({ where: { contractId, status: 'APPROVED' }, orderBy: { seq: 'desc' } });
      if (last && input.periodTo.getTime() < last.periodTo.getTime()) throw invalid({ periodTo: `Certificate ${last.number} runs to ${iso(last.periodTo)}` });
      const k = await this.compute(tx, c, input);
      const data = {
        date: input.date,
        periodTo: input.periodTo,
        clientRef: input.clientRef ?? null,
        notes: input.notes ?? null,
        thisValue: D(k.thisValue),
        previousValue: D(k.previousValue),
        cumulativeValue: D(k.cumulativeValue),
        advanceRecovery: D(k.advanceRecovery),
        retention: D(k.retention),
        netAmount: D(k.netAmount),
        updatedById: u.id,
      };
      const row = id
        ? await tx.progressCertificate.update({ where: { id }, data })
        : await tx.progressCertificate.create({
            data: { ...data, companyId: u.companyId, contractId, number: await this.sequence.next('CONS_CERT', u.companyId, input.date, tx), seq: (last?.seq ?? 0) + 1, createdById: u.id },
          });
      await tx.progressCertificateLine.deleteMany({ where: { certificateId: row.id } });
      await tx.progressCertificateLine.createMany({
        data: k.lines
          .filter((l) => l.thisQty !== 0 || l.cumQty !== 0)
          .map((l) => ({ certificateId: row.id, boqItemId: l.boqItemId, prevQty: D(l.prevQty), cumQty: D(l.cumQty), thisQty: D(l.thisQty), thisValue: D(l.thisValue) })),
      });
      return row;
    });
    await this.audit.record('Progress Certificate', saved.id, id ? 'UPDATE' : 'CREATE', null, { number: saved.number, value: n(saved.thisValue) });
    return this.certificate(saved.id);
  }

  /**
   * Approval (the client's signed certificate): the termin invoice = work certified - advance recovered (both with PPN,
   * the advance having carried its own) - retention (no PPN until the handover).
   */
  async approveCertificate(id: string) {
    RequestCtx.assert('construction.certify');
    const u = RequestCtx.user();
    const cert = await this.prisma.progressCertificate.findFirst({ where: { id, companyId: u.companyId } });
    if (!cert) throw new NotFoundException('Certificate not found');
    if (cert.status !== 'DRAFT') throw new ConflictException('Already approved or cancelled');
    const c = await this.contractOf(cert.contractId, u.companyId);
    if (c.status !== 'ACTIVE') throw new ConflictException('The contract is handed over or cancelled');
    // recompute against the BoQ as it is now
    const lines = await this.prisma.progressCertificateLine.findMany({ where: { certificateId: id } });
    const k = await this.prisma.$transaction((tx) => this.compute(tx, c, { date: cert.date, periodTo: cert.periodTo, lines: lines.map((l) => ({ boqItemId: l.boqItemId, cumQty: n(l.cumQty) })) }));
    const vat = await this.vatOn(c);
    const tax = vat ? await this.ppnTax(u.companyId) : null;
    const work = await this.product(u.companyId, 'CONS-WORK', 'Construction work certified', 'CONSTRUCTION_REVENUE', 'income');
    const adv = await this.product(u.companyId, 'CONS-ADVANCE', 'Construction advance payment (uang muka)', 'CONSTRUCTION_ADVANCE', 'income');
    const ret = await this.product(u.companyId, 'CONS-RETENTION', 'Construction retention', 'RETENTION_RECEIVABLE', 'income');
    const pct = n(c.contractValue) > 0 ? r2((k.cumulativeValue / n(c.contractValue)) * 100) : 0;
    const invLines: Record<string, unknown>[] = [
      { productId: work, description: `Work certified on ${cert.number} (cumulative ${pct}%, period to ${iso(cert.periodTo)})`, qty: 1, unitPrice: k.thisValue, taxId: tax },
    ];
    if (k.advanceRecovery > 0) invLines.push({ productId: adv, description: `Advance recovered (${n(c.advancePct)}% of the work certified)`, qty: -1, unitPrice: k.advanceRecovery, taxId: tax });
    if (k.retention > 0) invLines.push({ productId: ret, description: `Retention ${n(c.retentionPct)}% held until the handover (PPN on it at BAST 1)`, qty: -1, unitPrice: k.retention, taxId: null });
    const si = await this.invoice('SI', {
      date: cert.date,
      customerId: c.customerId,
      projectId: c.projectId,
      reference: cert.clientRef ? `${c.contractNo} / ${cert.clientRef}` : c.contractNo,
      notes: this.noteFor(c, `Progress certificate ${cert.number} of contract ${c.contractNo} (${c.title}).`),
      lines: invLines,
    });
    const doc = await this.prisma.tradeDocument.findUniqueOrThrow({ where: { id: si.id }, select: { taxTotal: true } });
    await this.prisma.$transaction(async (tx) => {
      for (const l of k.lines) if (l.thisQty !== 0) await tx.boqItem.update({ where: { id: l.boqItemId }, data: { certifiedQty: D(l.cumQty) } });
      await tx.progressCertificate.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          invoiceId: si.id,
          thisValue: D(k.thisValue),
          previousValue: D(k.previousValue),
          cumulativeValue: D(k.cumulativeValue),
          advanceRecovery: D(k.advanceRecovery),
          retention: D(k.retention),
          netAmount: D(k.netAmount),
          ppn: doc.taxTotal,
          updatedById: u.id,
        },
      });
    });
    await this.audit.record('Progress Certificate', id, 'APPROVE', null, { number: cert.number, invoice: si.number });
    return this.certificate(id);
  }

  /** only the last certificate, and its invoice only while unpaid */
  async cancelCertificate(id: string) {
    RequestCtx.assert('construction.certify');
    const u = RequestCtx.user();
    const cert = await this.prisma.progressCertificate.findFirst({ where: { id, companyId: u.companyId }, include: { lines: true } });
    if (!cert) throw new NotFoundException('Certificate not found');
    if (cert.status === 'CANCELLED') throw new ConflictException('Already cancelled');
    if (cert.status === 'APPROVED') {
      const c = await this.prisma.constructionContract.findUniqueOrThrow({ where: { id: cert.contractId } });
      if (c.status !== 'ACTIVE') throw new ConflictException('The contract is handed over');
      const later = await this.prisma.progressCertificate.count({ where: { contractId: cert.contractId, status: { in: ['APPROVED', 'DRAFT'] }, seq: { gt: cert.seq } } });
      if (later) throw new ConflictException('Cancel the later certificates first');
      if (cert.invoiceId && (await this.liveInvoice(cert.invoiceId))) await this.docs.cancel('SI', cert.invoiceId, { skipPermission: true });
      await this.prisma.$transaction(async (tx) => {
        for (const l of cert.lines) if (n(l.thisQty) !== 0) await tx.boqItem.update({ where: { id: l.boqItemId }, data: { certifiedQty: l.prevQty } });
      });
    }
    await this.prisma.progressCertificate.update({ where: { id }, data: { status: 'CANCELLED', updatedById: u.id } });
    await this.audit.record('Progress Certificate', id, 'CANCEL', null, { number: cert.number });
    return this.certificate(id);
  }

  // ------------------------------------------------------------------ handover
  /** provisional handover (BAST 1): the whole service is delivered, the retention is invoiced with its PPN, due at the end of maintenance */
  async handover(id: string, input: { date: Date }) {
    RequestCtx.assert('construction.manage');
    const u = RequestCtx.user();
    const c = await this.contractOf(id, u.companyId);
    if (c.status !== 'ACTIVE') throw new ConflictException('The contract is handed over or cancelled');
    if (await this.prisma.progressCertificate.count({ where: { contractId: id, status: 'DRAFT' } })) throw new ConflictException('Approve or cancel the draft certificate first');
    const held = r2(n((await this.prisma.progressCertificate.aggregate({ where: { contractId: id, status: 'APPROVED' }, _sum: { retention: true } }))._sum.retention));
    let invoiceId: string | null = null;
    if (held > 0) {
      const vat = await this.vatOn(c);
      const ret = await this.product(u.companyId, 'CONS-RETENTION', 'Construction retention', 'RETENTION_RECEIVABLE', 'income');
      const due = new Date(input.date.getTime() + c.maintenanceDays * DAY);
      const si = await this.invoice('SI', {
        date: input.date,
        dueDate: due,
        customerId: c.customerId,
        projectId: c.projectId,
        reference: `${c.contractNo} BAST 1`,
        notes: this.noteFor(
          c,
          `Retention of contract ${c.contractNo} (${c.title}), released at the end of the ${c.maintenanceDays}-day maintenance period (${iso(due)}). The service is delivered at the provisional handover (BAST 1), so its PPN is due now (UU PPN Art. 11).`,
        ),
        lines: [{ productId: ret, description: `Retention ${n(c.retentionPct)}% released at the end of maintenance`, qty: 1, unitPrice: held, taxId: vat ? await this.ppnTax(u.companyId) : null }],
      });
      invoiceId = si.id;
    }
    await this.prisma.constructionContract.update({ where: { id }, data: { status: 'PHO', phoDate: input.date, retentionInvoiceId: invoiceId, updatedById: u.id } });
    await this.audit.record('Construction Contract', id, 'PHO', null, { date: iso(input.date), retention: held });
    return this.contract(id);
  }

  async finalHandover(id: string, input: { date: Date }) {
    RequestCtx.assert('construction.manage');
    const u = RequestCtx.user();
    const c = await this.contractOf(id, u.companyId);
    if (c.status !== 'PHO' || !c.phoDate) throw new ConflictException('Record the provisional handover (PHO) first');
    if (input.date.getTime() < c.phoDate.getTime()) throw invalid({ date: 'The final handover comes after the provisional one' });
    await this.prisma.constructionContract.update({ where: { id }, data: { status: 'FHO', fhoDate: input.date, updatedById: u.id } });
    await this.audit.record('Construction Contract', id, 'FHO', null, { date: iso(input.date) });
    return this.contract(id);
  }

  /** undoes the PHO while its retention invoice is unpaid */
  async undoHandover(id: string) {
    RequestCtx.assert('construction.manage');
    const u = RequestCtx.user();
    const c = await this.contractOf(id, u.companyId);
    if (c.status !== 'PHO') throw new ConflictException('Only a provisional handover can be undone');
    if (c.retentionInvoiceId && (await this.liveInvoice(c.retentionInvoiceId))) await this.docs.cancel('SI', c.retentionInvoiceId, { skipPermission: true });
    await this.prisma.constructionContract.update({ where: { id }, data: { status: 'ACTIVE', phoDate: null, retentionInvoiceId: null, updatedById: u.id } });
    await this.audit.record('Construction Contract', id, 'PHO_UNDO');
    return this.contract(id);
  }

  async cancelContract(id: string) {
    RequestCtx.assert('construction.manage');
    const u = RequestCtx.user();
    const c = await this.contractOf(id, u.companyId);
    if (c.status !== 'ACTIVE') throw new ConflictException('Only an active contract can be cancelled');
    if (await this.prisma.progressCertificate.count({ where: { contractId: id, status: 'APPROVED' } })) throw new ConflictException('Cancel its certificates first');
    if (await this.liveInvoice(c.advanceInvoiceId)) throw new ConflictException('Cancel the advance invoice first');
    await this.prisma.constructionContract.update({ where: { id }, data: { status: 'CANCELLED', updatedById: u.id } });
    await this.audit.record('Construction Contract', id, 'CANCEL');
    return { success: true };
  }

  // ------------------------------------------------------------------ subcontracts
  async subcontracts(contractId?: string) {
    RequestCtx.assert('construction.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.subcontract.findMany({
      where: { companyId, ...(contractId ? { contractId } : {}), status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      include: { claims: { orderBy: { createdAt: 'asc' } }, contract: { select: { contractNo: true, title: true, status: true } } },
    });
    const sup = await this.prisma.supplier.findMany({ where: { id: { in: rows.map((r) => r.supplierId) } }, select: { id: true, name: true } });
    const invIds = [...rows.flatMap((r) => r.claims.map((x) => x.invoiceId)), ...rows.map((r) => r.retentionReleaseId)].filter(Boolean) as string[];
    const inv = await this.prisma.tradeDocument.findMany({ where: { id: { in: invIds } }, select: { id: true, number: true, status: true, grandTotal: true, paidAmount: true } });
    return rows.map(({ claims, contract, ...r }) => ({
      ...r,
      value: n(r.value),
      retentionPct: n(r.retentionPct),
      pphRate: n(r.pphRate),
      claimedPct: n(r.claimedPct),
      retentionHeld: n(r.retentionHeld),
      supplier: sup.find((s) => s.id === r.supplierId)?.name ?? null,
      contractNo: contract.contractNo,
      contractTitle: contract.title,
      contractStatus: contract.status,
      retentionRelease: inv.find((i) => i.id === r.retentionReleaseId) ?? null,
      claims: claims.map((x) => ({
        id: x.id,
        number: x.number,
        date: iso(x.date),
        prevPct: n(x.prevPct),
        cumPct: n(x.cumPct),
        thisValue: n(x.thisValue),
        retention: n(x.retention),
        netAmount: n(x.netAmount),
        supplierRef: x.supplierRef,
        status: x.status,
        invoice: inv.find((i) => i.id === x.invoiceId) ?? null,
      })),
    }));
  }

  async saveSubcontract(id: string | null, input: z.infer<typeof subcontractSchema>) {
    RequestCtx.assert('construction.subcon');
    const u = RequestCtx.user();
    const c = await this.prisma.constructionContract.findFirst({ where: { id: input.contractId, companyId: u.companyId, status: { not: 'CANCELLED' } } });
    if (!c) throw invalid({ contractId: 'Choose a contract' });
    const s = await this.prisma.supplier.findFirst({ where: { id: input.supplierId, companyId: u.companyId, deletedAt: null } });
    if (!s) throw invalid({ supplierId: 'Choose a supplier' });
    const data = {
      contractId: input.contractId,
      supplierId: input.supplierId,
      scope: input.scope,
      value: D(input.value),
      retentionPct: D(input.retentionPct),
      vat: input.vat,
      pphRate: D(input.pphRate),
      notes: input.notes ?? null,
    };
    let row;
    if (id) {
      const cur = await this.prisma.subcontract.findFirst({ where: { id, companyId: u.companyId } });
      if (!cur) throw new NotFoundException('Subcontract not found');
      const claimed = await this.prisma.subcontractClaim.count({ where: { subcontractId: id, status: 'APPROVED' } });
      if (claimed && (n(cur.retentionPct) !== input.retentionPct || cur.supplierId !== input.supplierId || cur.contractId !== input.contractId))
        throw new ConflictException('Claims are certified: only the scope, value, PPN and PPh rate can change');
      row = await this.prisma.subcontract.update({ where: { id }, data });
    } else row = await this.prisma.subcontract.create({ data: { ...data, companyId: u.companyId, createdById: u.id } });
    await this.audit.record('Subcontract', row.id, id ? 'UPDATE' : 'CREATE', null, { value: input.value });
    return (await this.subcontracts(row.contractId)).find((x) => x.id === row.id);
  }

  /** a subcontractor's claim on its cumulative progress: purchase invoice of the work less the retention we hold */
  async claim(subId: string, input: z.infer<typeof claimSchema>) {
    RequestCtx.assert('construction.subcon');
    const u = RequestCtx.user();
    const s = await this.prisma.subcontract.findFirst({ where: { id: subId, companyId: u.companyId }, include: { contract: true } });
    if (!s || s.status === 'CANCELLED') throw new NotFoundException('Subcontract not found');
    if (s.retentionReleaseId) throw new ConflictException('The retention is released: the subcontract is closed');
    const prev = n(s.claimedPct);
    if (input.cumPct <= prev) throw invalid({ cumPct: `${prev}% claimed before` });
    const thisValue = r2((n(s.value) * (input.cumPct - prev)) / 100);
    const retention = r2((thisValue * n(s.retentionPct)) / 100);
    const work = await this.product(u.companyId, 'SUBCON-WORK', 'Subcontract work certified', 'SUBCON_COST', 'expense');
    const ret = await this.product(u.companyId, 'SUBCON-RETENTION', 'Retention held from subcontractors', 'RETENTION_PAYABLE', 'expense');
    const tax = s.vat ? await this.ppnTax(u.companyId) : null;
    const lines: Record<string, unknown>[] = [{ productId: work, description: `${s.scope}: progress ${prev}% to ${input.cumPct}%`, qty: 1, unitPrice: thisValue, taxId: tax }];
    if (retention > 0) lines.push({ productId: ret, description: `Retention ${n(s.retentionPct)}% held until the handover`, qty: -1, unitPrice: retention, taxId: null });
    const number = await this.prisma.$transaction((tx) => this.sequence.next('SUBCON_CLAIM', u.companyId, input.date, tx));
    const pi = await this.invoice('PI', {
      date: input.date,
      supplierId: s.supplierId,
      projectId: s.contract.projectId,
      reference: input.supplierRef ?? number,
      notes: `Subcontractor claim ${number} on contract ${s.contract.contractNo}.\nWithhold PPh final 4(2) ${n(s.pphRate)}% of the payment before PPN (PP 9/2022).`,
      lines,
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.subcontractClaim.create({
        data: {
          companyId: u.companyId,
          subcontractId: subId,
          number,
          date: input.date,
          prevPct: D(prev),
          cumPct: D(input.cumPct),
          thisValue: D(thisValue),
          retention: D(retention),
          netAmount: D(r2(thisValue - retention)),
          supplierRef: input.supplierRef ?? null,
          invoiceId: pi.id,
          createdById: u.id,
        },
      });
      await tx.subcontract.update({ where: { id: subId }, data: { claimedPct: D(input.cumPct), retentionHeld: { increment: D(retention) } } });
    });
    await this.audit.record('Subcontract', subId, 'CLAIM', null, { number, invoice: pi.number, value: thisValue });
    return { ...(await this.subcontracts(s.contractId)).find((x) => x.id === subId), invoice: pi };
  }

  async cancelClaim(claimId: string) {
    RequestCtx.assert('construction.subcon');
    const u = RequestCtx.user();
    const cl = await this.prisma.subcontractClaim.findFirst({ where: { id: claimId, companyId: u.companyId }, include: { subcontract: true } });
    if (!cl || cl.status !== 'APPROVED') throw new NotFoundException('Claim not found');
    const later = await this.prisma.subcontractClaim.count({ where: { subcontractId: cl.subcontractId, status: 'APPROVED', createdAt: { gt: cl.createdAt } } });
    if (later || cl.subcontract.retentionReleaseId) throw new ConflictException('Cancel the later claims / the retention release first');
    if (cl.invoiceId) {
      const inv = await this.prisma.tradeDocument.findFirst({ where: { id: cl.invoiceId, deletedAt: null } });
      if (inv?.status === 'DRAFT') await this.prisma.tradeDocument.update({ where: { id: inv.id }, data: { deletedAt: new Date() } });
      else if (inv && inv.status !== 'CANCELLED') await this.docs.cancel('PI', inv.id, { skipPermission: true });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.subcontractClaim.update({ where: { id: claimId }, data: { status: 'CANCELLED' } });
      await tx.subcontract.update({ where: { id: cl.subcontractId }, data: { claimedPct: cl.prevPct, retentionHeld: { decrement: cl.retention } } });
    });
    await this.audit.record('Subcontract', cl.subcontractId, 'CLAIM_CANCEL', null, { number: cl.number });
    return (await this.subcontracts(cl.subcontract.contractId)).find((x) => x.id === cl.subcontractId);
  }

  /** the subcontractor's retention: invoiced (with its PPN) once our own handover is done */
  async releaseRetention(subId: string, input: { date: Date; supplierRef?: string | null }) {
    RequestCtx.assert('construction.subcon');
    const u = RequestCtx.user();
    const s = await this.prisma.subcontract.findFirst({ where: { id: subId, companyId: u.companyId }, include: { contract: true } });
    if (!s || s.status === 'CANCELLED') throw new NotFoundException('Subcontract not found');
    if (s.retentionReleaseId) throw new ConflictException('Released already');
    if (n(s.retentionHeld) <= 0) throw new ConflictException('No retention held');
    if (s.contract.status === 'ACTIVE') throw new ConflictException('Release it after the provisional handover (PHO) of the contract');
    const ret = await this.product(u.companyId, 'SUBCON-RETENTION', 'Retention held from subcontractors', 'RETENTION_PAYABLE', 'expense');
    const pi = await this.invoice('PI', {
      date: input.date,
      supplierId: s.supplierId,
      projectId: s.contract.projectId,
      reference: input.supplierRef ?? `Retention ${s.contract.contractNo}`,
      notes: `Retention released to the subcontractor (contract ${s.contract.contractNo}).\nWithhold PPh final 4(2) ${n(s.pphRate)}% of the payment before PPN (PP 9/2022).`,
      lines: [{ productId: ret, description: `Retention ${n(s.retentionPct)}% released: ${s.scope}`, qty: 1, unitPrice: n(s.retentionHeld), taxId: s.vat ? await this.ppnTax(u.companyId) : null }],
    });
    await this.prisma.subcontract.update({ where: { id: subId }, data: { retentionReleaseId: pi.id, status: 'CLOSED' } });
    await this.audit.record('Subcontract', subId, 'RETENTION_RELEASE', null, { invoice: pi.number });
    return { ...(await this.subcontracts(s.contractId)).find((x) => x.id === subId), invoice: pi };
  }

  // ------------------------------------------------------------------ PPh final 4(2)
  /**
   * PPh final on construction income for a month: due on each payment received (before PPN), withheld by the client
   * (bukti potong) or paid by us by the 15th of the next month; and what we withheld from subcontractors.
   */
  async finalTax(period: string) {
    RequestCtx.assert('construction.read');
    const companyId = RequestCtx.companyId();
    const [y, m] = period.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const contracts = await this.prisma.constructionContract.findMany({ where: { companyId }, include: { certificates: { select: { invoiceId: true } } } });
    const owner = new Map<string, (typeof contracts)[number]>();
    for (const c of contracts) for (const i of [c.advanceInvoiceId, c.retentionInvoiceId, ...c.certificates.map((x) => x.invoiceId)]) if (i) owner.set(i, c);
    const kon = await this.prisma.tax.findMany({ where: { companyId, code: { startsWith: 'PPH42-KON' } }, select: { id: true, code: true } });
    const konIds = new Set(kon.map((t) => t.id));
    const payments = await this.prisma.payment.findMany({
      where: { companyId, direction: 'IN', status: 'CONFIRMED', deletedAt: null, date: { gte: from, lt: to }, allocations: { some: { documentId: { in: [...owner.keys()] } } } },
      include: { allocations: { include: { document: { select: { id: true, number: true, grandTotal: true, taxTotal: true } } } } },
    });
    const rows = [];
    for (const p of payments) {
      const all = p.allocations.reduce((a, x) => a + n(x.amount), 0);
      for (const a of p.allocations) {
        const c = owner.get(a.documentId);
        if (!c) continue;
        const gt = n(a.document.grandTotal);
        const base = gt > 0 ? r2((n(a.amount) * (gt - n(a.document.taxTotal))) / gt) : 0;
        const withheld = p.whtTaxId && konIds.has(p.whtTaxId) && all > 0 ? r2((n(p.whtAmount) * n(a.amount)) / all) : 0;
        const due = Math.floor((base * n(c.pphRate)) / 100);
        rows.push({
          paymentId: p.id,
          payment: p.number,
          date: iso(p.date),
          contractNo: c.contractNo,
          invoice: a.document.number,
          allocated: n(a.amount),
          base,
          rate: n(c.pphRate),
          due,
          withheld,
          slipNo: p.whtSlipNo,
          selfPay: withheld > 0 ? 0 : due,
        });
      }
    }
    const booked = await this.prisma.constructionTaxSelfPay.findMany({ where: { companyId, period, status: 'POSTED' }, orderBy: { createdAt: 'asc' } });
    // withheld by us from subcontractors (payments out with a construction PPh 4(2))
    const out = await this.prisma.payment.findMany({
      where: { companyId, direction: 'OUT', status: 'CONFIRMED', deletedAt: null, date: { gte: from, lt: to }, whtTaxId: { in: [...konIds] } },
      select: { id: true, number: true, date: true, supplierId: true, whtBase: true, whtRate: true, whtAmount: true, whtSlipNo: true },
    });
    const sup = await this.prisma.supplier.findMany({ where: { id: { in: out.map((o) => o.supplierId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
    const selfPay = r2(rows.reduce((a, r) => a + r.selfPay, 0));
    const bookedTotal = r2(booked.reduce((a, b) => a + n(b.amount), 0));
    return {
      period,
      depositBy: iso(new Date(Date.UTC(y, m, 15))),
      rows,
      totals: {
        base: r2(rows.reduce((a, r) => a + r.base, 0)),
        due: r2(rows.reduce((a, r) => a + r.due, 0)),
        withheld: r2(rows.reduce((a, r) => a + r.withheld, 0)),
        selfPay,
        booked: bookedTotal,
        toBook: r2(selfPay - bookedTotal),
      },
      booked: booked.map((b) => ({ id: b.id, amount: n(b.amount), base: n(b.base), createdAt: b.createdAt })),
      subcontractors: out.map((o) => ({
        payment: o.number,
        date: iso(o.date),
        supplier: sup.find((s) => s.id === o.supplierId)?.name ?? null,
        base: n(o.whtBase),
        rate: n(o.whtRate),
        amount: n(o.whtAmount),
        slipNo: o.whtSlipNo,
      })),
    };
  }

  /** books the PPh final we pay ourselves for the month: Dr final tax expense / Cr PPh 4(2) payable */
  async bookSelfPay(period: string) {
    RequestCtx.assert('construction.tax');
    const u = RequestCtx.user();
    const t = await this.finalTax(period);
    if (t.totals.toBook <= 0) throw new ConflictException('Nothing to book for this month');
    const [y, m] = period.split('-').map(Number);
    const date = new Date(Date.UTC(y, m, 0));
    const base = r2(t.rows.filter((r) => r.selfPay > 0).reduce((a, r) => a + r.base, 0));
    const row = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.constructionTaxSelfPay.create({ data: { companyId: u.companyId, period, base: D(base), amount: D(t.totals.toBook), createdById: u.id } });
      await this.journal.post(tx, {
        companyId: u.companyId,
        date,
        description: `PPh final 4(2) construction ${period} (paid by us)`,
        reference: period,
        sourceType: 'CONS_PPH',
        sourceId: rec.id,
        lines: [
          { key: 'CONSTRUCTION_FINAL_TAX', debit: D(t.totals.toBook), description: `PPh final 4(2) ${period}` },
          { key: 'FINAL_TAX_PAYABLE', credit: D(t.totals.toBook), description: `PPh final 4(2) construction ${period}, deposit by ${t.depositBy}` },
        ],
      });
      return rec;
    });
    await this.audit.record('Construction Tax', row.id, 'CREATE', null, { period, amount: t.totals.toBook });
    return this.finalTax(period);
  }

  async cancelSelfPay(id: string) {
    RequestCtx.assert('construction.tax');
    const u = RequestCtx.user();
    const rec = await this.prisma.constructionTaxSelfPay.findFirst({ where: { id, companyId: u.companyId, status: 'POSTED' } });
    if (!rec) throw new NotFoundException('Not found');
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'CONS_PPH', id);
      await tx.constructionTaxSelfPay.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    await this.audit.record('Construction Tax', id, 'CANCEL');
    return this.finalTax(rec.period);
  }
}
