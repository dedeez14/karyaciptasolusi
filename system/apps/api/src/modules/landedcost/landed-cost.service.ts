import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { JournalService, PostingLine } from '../accounting/journal.service';
import { InventoryService } from '../documents/inventory.service';
import { calculate, CIF_TERMS, FREIGHT_IN_PRICE, INCOTERMS } from './landed-cost.calc';

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optNum = (max: number) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(0).max(max).nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });
const LIVE_RECEIPT = ['CONFIRMED', 'PARTIAL', 'COMPLETED'] as const;

export const CHARGE_TYPES = ['FREIGHT', 'INSURANCE', 'BROKER', 'PORT', 'TRUCKING', 'STORAGE', 'OTHER'] as const;
export const CHARGE_LABEL: Record<string, string> = {
  FREIGHT: 'Freight',
  INSURANCE: 'Cargo insurance',
  BROKER: 'Customs broker (PPJK)',
  PORT: 'Port charges (THC, port storage, handling)',
  TRUCKING: 'Trucking to the warehouse',
  STORAGE: 'Storage before receipt',
  OTHER: 'Other import charges',
};

export const landedCostSchema = z.object({
  date: z.coerce.date(),
  reference: optText(100),
  receiptIds: z.array(z.uuid()).min(1).max(50),
  pibNo: optText(20),
  pibDate: z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional()),
  incoterm: z.enum(INCOTERMS as [string, ...string[]]).default('CIF'),
  ndpbm: z.coerce.number().positive().max(1e9).default(1),
  freightFx: z.coerce.number().min(0).max(1e13).default(0),
  insuranceFx: z.coerce.number().min(0).max(1e13).default(0),
  apiHolder: z.boolean().optional(),
  ppnCreditable: z.boolean().optional(),
  bmActual: optNum(1e13),
  ppnActual: optNum(1e13),
  pph22Actual: optNum(1e13),
  lines: z
    .array(
      z.object({
        receiptLineId: z.uuid(),
        weight: z.coerce.number().min(0).max(1e12).default(0),
        hsCode: optText(12),
        bmPct: z.coerce.number().min(0).max(200).default(0),
        bmadPct: z.coerce.number().min(0).max(500).default(0),
        ppnbmPct: z.coerce.number().min(0).max(200).default(0),
        pph22Pct: optNum(10),
      }),
    )
    .max(500)
    .default([]),
  charges: z
    .array(
      z.object({
        type: z.enum(CHARGE_TYPES),
        description: optText(200),
        amount: z.coerce.number().positive().max(1e13),
        method: z.enum(['VALUE', 'QTY', 'WEIGHT']).default('VALUE'),
        sourceLineId: optUuid,
      }),
    )
    .max(50)
    .default([]),
  notes: optText(2000),
});
type Input = z.infer<typeof landedCostSchema>;
type Tx = Prisma.TransactionClient;

/**
 * Landed costs: import duties and taxes of the PIB and the charges of getting the goods in (freight, insurance, customs
 * broker, port, trucking) spread over goods receipts and added to their cost. Stock still on hand takes its share in its
 * average cost; the share of goods already sold goes to cost of sales. Charges come from purchase invoice lines booked
 * to Landed Costs Clearing (the LC-* service products) or are entered after being booked there; duties are owed to
 * customs (Import Duties & Taxes Payable), import PPN is input tax for a PKP and PPh 22 import a prepaid income tax.
 */
@Injectable()
export class LandedCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly inventory: InventoryService,
  ) {}

  // ------------------------------------------------------------------ set-up: charge products and the clearing account
  async setup() {
    RequestCtx.assert('purchase.receipt.read');
    const companyId = RequestCtx.companyId();
    const products = await this.prisma.product.findMany({ where: { companyId, code: { in: CHARGE_TYPES.map((t) => `LC-${t}`) }, deletedAt: null }, select: { id: true, code: true, name: true } });
    const clearing = await this.clearingAccount(companyId);
    return { products, missing: CHARGE_TYPES.filter((t) => !products.some((p) => p.code === `LC-${t}`)), clearing };
  }

  /** the LC-* service products whose purchase invoice lines go to Landed Costs Clearing */
  async createChargeProducts() {
    RequestCtx.assert('purchase.landedcost.manage');
    const u = RequestCtx.user();
    const account = await this.prisma.$transaction((tx) => this.journal.mapping(tx, u.companyId, 'LANDED_COST_CLEARING'));
    for (const t of CHARGE_TYPES) {
      const code = `LC-${t}`;
      const found = await this.prisma.product.findFirst({ where: { companyId: u.companyId, code, deletedAt: null } });
      if (found) continue;
      await this.prisma.product.create({
        data: {
          companyId: u.companyId,
          code,
          name: `Import charge - ${CHARGE_LABEL[t]}`,
          type: 'SERVICE',
          expenseAccountId: account,
          isSellable: false,
          description: 'Purchase invoice lines of this product are landed costs: they wait on Landed Costs Clearing until spread over goods receipts',
          createdById: u.id,
        },
      });
    }
    await this.audit.record('Landed Cost', u.companyId, 'SETUP');
    return this.setup();
  }

  private async clearingAccount(companyId: string) {
    const m = await this.prisma.accountMapping.findUnique({ where: { companyId_key: { companyId, key: 'LANDED_COST_CLEARING' } } });
    if (!m?.accountId) return null;
    const a = await this.prisma.account.findUnique({ where: { id: m.accountId }, select: { id: true, code: true, name: true } });
    const s = await this.prisma.journalLine.aggregate({ where: { accountId: m.accountId, entry: { status: 'POSTED', companyId } }, _sum: { debit: true, credit: true } });
    return a ? { ...a, balance: r2(n(s._sum.debit) - n(s._sum.credit)) } : null;
  }

  // ------------------------------------------------------------------ pickers
  /** goods receipts that can take landed costs */
  async receipts(q?: string) {
    RequestCtx.assert('purchase.receipt.read');
    const companyId = RequestCtx.companyId();
    const docs = await this.prisma.tradeDocument.findMany({
      where: {
        companyId,
        docType: 'GR',
        status: { in: [...LIVE_RECEIPT] },
        deletedAt: null,
        ...(q ? { OR: [{ number: { contains: q, mode: 'insensitive' } }, { reference: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { date: 'desc' },
      take: 50,
      include: { lines: { select: { lineSubtotal: true, lineDiscount: true } } },
    });
    const sup = await this.names(
      'supplier',
      docs.map((d) => d.supplierId),
    );
    const used = await this.prisma.landedCostLine.groupBy({
      by: ['receiptId', 'landedCostId'],
      where: { receiptId: { in: docs.map((d) => d.id) }, landedCost: { status: { not: 'CANCELLED' } } },
    });
    return docs.map((d) => ({
      id: d.id,
      number: d.number,
      date: iso(d.date),
      supplier: sup.get(d.supplierId ?? '') ?? null,
      reference: d.reference,
      currencyCode: d.currencyCode,
      exchangeRate: n(d.exchangeRate),
      value: r2(d.lines.reduce((a, l) => a + n(l.lineSubtotal) - n(l.lineDiscount), 0)),
      landedCosts: used.filter((x) => x.receiptId === d.id).length,
    }));
  }

  /** stock lines of the receipts chosen (for the rates per line before the first save) */
  async receiptLines(ids: string[]) {
    RequestCtx.assert('purchase.receipt.read');
    const companyId = RequestCtx.companyId();
    const docs = await this.prisma.tradeDocument.findMany({ where: { id: { in: ids }, companyId, docType: 'GR', deletedAt: null }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    const products = await this.prisma.product.findMany({
      where: { id: { in: docs.flatMap((d) => d.lines.map((l) => l.productId)).filter(Boolean) as string[] }, type: 'STOCK' },
      select: { id: true, code: true, name: true, hsCode: true },
    });
    const pm = new Map(products.map((p) => [p.id, p]));
    return docs.flatMap((d) =>
      d.lines
        .filter((l) => l.productId && pm.has(l.productId) && n(l.qty) > 0)
        .map((l) => ({
          receiptLineId: l.id,
          receipt: d.number,
          currencyCode: d.currencyCode,
          product: pm.get(l.productId!)!,
          qty: n(l.qty),
          valueFx: r2(n(l.lineSubtotal) - n(l.lineDiscount)),
          value: r2((n(l.lineSubtotal) - n(l.lineDiscount)) * n(d.exchangeRate)),
          hsCode: pm.get(l.productId!)!.hsCode,
        })),
    );
  }

  /** purchase invoice lines booked to Landed Costs Clearing and the part not yet spread */
  async openCharges() {
    RequestCtx.assert('purchase.receipt.read');
    const companyId = RequestCtx.companyId();
    const m = await this.prisma.accountMapping.findUnique({ where: { companyId_key: { companyId, key: 'LANDED_COST_CLEARING' } } });
    if (!m?.accountId) return [];
    const products = await this.prisma.product.findMany({ where: { companyId, expenseAccountId: m.accountId }, select: { id: true, code: true } });
    if (!products.length) return [];
    const lines = await this.prisma.tradeDocumentLine.findMany({
      where: { productId: { in: products.map((p) => p.id) }, document: { companyId, docType: 'PI', status: { in: ['CONFIRMED', 'PARTIAL', 'COMPLETED'] }, deletedAt: null } },
      include: { document: { select: { id: true, number: true, date: true, supplierId: true, exchangeRate: true } } },
      orderBy: { document: { date: 'desc' } },
      take: 300,
    });
    const usedRows = await this.prisma.landedCostCharge.groupBy({
      by: ['sourceLineId'],
      where: { sourceLineId: { in: lines.map((l) => l.id) }, landedCost: { status: { not: 'CANCELLED' } } },
      _sum: { amount: true },
    });
    const used = new Map(usedRows.map((u) => [u.sourceLineId, n(u._sum.amount)]));
    const sup = await this.names(
      'supplier',
      lines.map((l) => l.document.supplierId),
    );
    const code = new Map(products.map((p) => [p.id, p.code]));
    return lines
      .map((l) => {
        const amount = r2((n(l.lineSubtotal) - n(l.lineDiscount)) * n(l.document.exchangeRate));
        const type = (code.get(l.productId!) ?? '').replace(/^LC-/, '');
        return {
          lineId: l.id,
          invoiceId: l.document.id,
          invoice: l.document.number,
          date: iso(l.document.date),
          supplier: sup.get(l.document.supplierId ?? '') ?? null,
          type: CHARGE_TYPES.includes(type as never) ? type : 'OTHER',
          description: l.description,
          amount,
          open: r2(amount - (used.get(l.id) ?? 0)),
        };
      })
      .filter((l) => l.open > 0.004);
  }

  private async names(kind: 'supplier' | 'warehouse', ids: (string | null)[]) {
    const list = [...new Set(ids.filter(Boolean) as string[])];
    if (!list.length) return new Map<string, string>();
    const rows =
      kind === 'supplier'
        ? await this.prisma.supplier.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })
        : await this.prisma.warehouse.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  // ------------------------------------------------------------------ list / detail
  async list(status?: string) {
    RequestCtx.assert('purchase.receipt.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.landedCost.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: 200,
      include: { lines: { select: { receiptId: true } } },
    });
    const sup = await this.names(
      'supplier',
      rows.map((r) => r.supplierId),
    );
    const receipts = await this.prisma.tradeDocument.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.lines.map((l) => l.receiptId)))] } }, select: { id: true, number: true } });
    const rn = new Map(receipts.map((r) => [r.id, r.number]));
    return rows.map(({ lines, ...r }) => ({ ...this.money(r), supplier: sup.get(r.supplierId ?? '') ?? null, receipts: [...new Set(lines.map((l) => rn.get(l.receiptId) ?? ''))] }));
  }

  private money<T extends Record<string, unknown>>(r: T) {
    const out: Record<string, unknown> = { ...r };
    for (const k of [
      'ndpbm',
      'freightFx',
      'insuranceFx',
      'customsValue',
      'bm',
      'bmad',
      'ppn',
      'ppnbm',
      'pph22',
      'charges',
      'toInventory',
      'toCogs',
      'qty',
      'valueFx',
      'value',
      'weight',
      'bmPct',
      'bmadPct',
      'ppnbmPct',
      'qtyOnHand',
      'amount',
    ])
      if (k in out) out[k] = n(out[k]);
    for (const k of ['bmActual', 'ppnActual', 'pph22Actual', 'pph22Pct']) if (k in out) out[k] = out[k] === null ? null : n(out[k]);
    for (const k of ['date', 'pibDate']) if (k in out) out[k] = iso(out[k] as Date | null);
    return out as T;
  }

  async get(id: string) {
    RequestCtx.assert('purchase.receipt.read');
    const companyId = RequestCtx.companyId();
    const lc = await this.prisma.landedCost.findFirst({ where: { id, companyId }, include: { lines: true, chargeLines: true } });
    if (!lc) throw new NotFoundException('Landed cost not found');
    const products = await this.prisma.product.findMany({ where: { id: { in: lc.lines.map((l) => l.productId) } }, select: { id: true, code: true, name: true } });
    const pm = new Map(products.map((p) => [p.id, p]));
    const docs = await this.prisma.tradeDocument.findMany({
      where: { id: { in: [...lc.lines.map((l) => l.receiptId), ...(lc.chargeLines.map((c) => c.sourceDocId).filter(Boolean) as string[])] } },
      select: { id: true, number: true },
    });
    const dn = new Map(docs.map((d) => [d.id, d.number]));
    const wh = await this.names(
      'warehouse',
      lc.lines.map((l) => l.warehouseId),
    );
    const sup = await this.names('supplier', [lc.supplierId]);
    const { lines, chargeLines, ...head } = lc;
    return {
      ...this.money(head),
      supplier: sup.get(lc.supplierId ?? '') ?? null,
      receiptIds: [...new Set(lines.map((l) => l.receiptId))],
      lines: lines.map((l) => ({
        ...this.money(l),
        receipt: dn.get(l.receiptId) ?? null,
        product: pm.get(l.productId) ?? null,
        warehouse: wh.get(l.warehouseId) ?? null,
        cost: r2(n(l.bm) + n(l.bmad) + n(l.ppnbm) + (lc.ppnCreditable ? 0 : n(l.ppn)) + n(l.charges)),
      })),
      chargeRows: chargeLines.map((c) => ({ ...this.money(c), invoice: c.sourceDocId ? (dn.get(c.sourceDocId) ?? null) : null })),
    };
  }

  // ------------------------------------------------------------------ build: receipts + rates + charges -> amounts per line
  private async build(tx: Tx, companyId: string, input: Input, selfId: string | null) {
    const errors: Record<string, string> = {};
    const docs = await tx.tradeDocument.findMany({ where: { id: { in: input.receiptIds }, companyId, docType: 'GR', deletedAt: null }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (docs.length !== new Set(input.receiptIds).size) throw invalid({ receiptIds: 'Choose goods receipts of this company' });
    const dead = docs.find((d) => !LIVE_RECEIPT.includes(d.status as never));
    if (dead) throw invalid({ receiptIds: `${dead.number} is not a confirmed receipt` });
    const currencies = new Set(docs.map((d) => d.currencyCode));
    if (currencies.size > 1) throw invalid({ receiptIds: 'The receipts are in different currencies: make one landed cost per currency' });
    const currencyCode = docs[0].currencyCode;
    const products = await tx.product.findMany({
      where: { id: { in: docs.flatMap((d) => d.lines.map((l) => l.productId)).filter(Boolean) as string[] } },
      select: { id: true, type: true, hsCode: true },
    });
    const pm = new Map(products.map((p) => [p.id, p]));
    const rates = new Map(input.lines.map((l) => [l.receiptLineId, l]));
    const lines = docs.flatMap((d) =>
      d.lines
        .filter((l) => l.productId && pm.get(l.productId)?.type === 'STOCK' && n(l.qty) > 0)
        .map((l) => {
          const r = rates.get(l.id);
          const valueFx = r2(n(l.lineSubtotal) - n(l.lineDiscount));
          return {
            receiptId: d.id,
            receiptLineId: l.id,
            productId: l.productId!,
            warehouseId: d.warehouseId!,
            qty: n(l.qty),
            valueFx,
            value: r2(valueFx * n(d.exchangeRate)),
            weight: r?.weight ?? 0,
            hsCode: r?.hsCode ?? pm.get(l.productId!)?.hsCode ?? null,
            bmPct: r?.bmPct ?? 0,
            bmadPct: r?.bmadPct ?? 0,
            ppnbmPct: r?.ppnbmPct ?? 0,
            pph22Pct: r?.pph22Pct ?? null,
          };
        }),
    );
    if (!lines.length) throw invalid({ receiptIds: 'The receipts have no stock lines' });
    const customs = !!input.pibNo;
    if (customs && !input.pibDate) errors.pibDate = 'Enter the PIB date';
    if (customs && currencyCode !== 'IDR' && input.ndpbm <= 1) errors.ndpbm = `Enter the NDPBM rate of ${currencyCode} for the PIB week`;
    if (CIF_TERMS.includes(input.incoterm) && (input.freightFx > 0 || input.insuranceFx > 0)) errors.freightFx = `${input.incoterm}: freight and insurance are already in the price`;
    if (FREIGHT_IN_PRICE.includes(input.incoterm) && input.freightFx > 0) errors.freightFx = `${input.incoterm}: the freight is already in the price`;
    if (!customs && (input.bmActual || input.ppnActual || input.pph22Actual)) errors.pibNo = 'Enter the PIB the duties are on';
    // charges from purchase invoice lines: not more than what is left of them
    const clearing = await this.journal.mapping(tx, companyId, 'LANDED_COST_CLEARING');
    const charges: { type: string; description: string | null; amount: number; method: 'VALUE' | 'QTY' | 'WEIGHT'; sourceDocId: string | null; sourceLineId: string | null }[] = [];
    for (const [k, c] of input.charges.entries()) {
      let sourceDocId: string | null = null;
      if (c.sourceLineId) {
        const l = await tx.tradeDocumentLine.findFirst({
          where: { id: c.sourceLineId, document: { companyId, docType: 'PI', status: { in: ['CONFIRMED', 'PARTIAL', 'COMPLETED'] }, deletedAt: null } },
          include: { document: { select: { id: true, number: true, exchangeRate: true } } },
        });
        const p = l?.productId ? await tx.product.findUnique({ where: { id: l.productId }, select: { expenseAccountId: true } }) : null;
        if (!l || p?.expenseAccountId !== clearing) {
          errors[`charges.${k}.sourceLineId`] = 'Choose a confirmed purchase invoice line booked to Landed Costs Clearing';
          continue;
        }
        const amount = r2((n(l.lineSubtotal) - n(l.lineDiscount)) * n(l.document.exchangeRate));
        const used = await tx.landedCostCharge.aggregate({
          where: { sourceLineId: l.id, landedCost: { status: { not: 'CANCELLED' }, ...(selfId ? { id: { not: selfId } } : {}) } },
          _sum: { amount: true },
        });
        const open = r2(amount - n(used._sum.amount) - charges.filter((x) => x.sourceLineId === l.id).reduce((a, x) => a + x.amount, 0));
        if (c.amount > open + 0.004) errors[`charges.${k}.amount`] = `${l.document.number}: only ${open.toLocaleString('id-ID')} left to spread`;
        sourceDocId = l.document.id;
      }
      charges.push({ type: c.type, description: c.description ?? null, amount: c.amount, method: c.method, sourceDocId, sourceLineId: c.sourceLineId ?? null });
    }
    const pkp = await this.settings.bool('sales.vatPayer', companyId, true);
    const head = {
      customs,
      ndpbm: currencyCode === 'IDR' ? 1 : input.ndpbm,
      freightFx: input.freightFx,
      insuranceFx: input.insuranceFx,
      apiHolder: input.apiHolder ?? (await this.settings.bool('purchase.apiHolder', companyId, true)),
      ppnCreditable: pkp && (input.ppnCreditable ?? true),
      bmActual: input.bmActual ?? null,
      ppnActual: input.ppnActual ?? null,
      pph22Actual: input.pph22Actual ?? null,
    };
    if (!customs && !charges.length) errors.charges = 'Add the PIB or at least one charge';
    const calc = calculate(head, lines, charges);
    calc.errors.forEach((e, i) => (errors[`charges.calc${i}`] = e));
    if (Object.keys(errors).length) throw invalid(errors);
    const sum = (k: 'customsValue' | 'bm' | 'bmad' | 'ppn' | 'ppnbm' | 'pph22' | 'charges') => r2(calc.lines.reduce((a, l) => a + l[k], 0));
    return {
      head,
      currencyCode,
      supplierId: docs[0].supplierId,
      branchId: docs[0].branchId,
      lines: lines.map((l, i) => ({ ...l, ...calc.lines[i] })),
      charges,
      totals: { customsValue: sum('customsValue'), bm: sum('bm'), bmad: sum('bmad'), ppn: sum('ppn'), ppnbm: sum('ppnbm'), pph22: sum('pph22'), charges: sum('charges') },
    };
  }

  private async write(tx: Tx, id: string, input: Input, b: Awaited<ReturnType<LandedCostService['build']>>) {
    await tx.landedCostLine.deleteMany({ where: { landedCostId: id } });
    await tx.landedCostCharge.deleteMany({ where: { landedCostId: id } });
    await tx.landedCostLine.createMany({
      data: b.lines.map((l) => ({
        landedCostId: id,
        receiptId: l.receiptId,
        receiptLineId: l.receiptLineId,
        productId: l.productId,
        warehouseId: l.warehouseId,
        qty: D(l.qty),
        valueFx: D(l.valueFx),
        value: D(l.value),
        weight: D(l.weight),
        hsCode: l.hsCode,
        bmPct: D(l.bmPct),
        bmadPct: D(l.bmadPct),
        ppnbmPct: D(l.ppnbmPct),
        pph22Pct: l.pph22Pct === null ? null : D(l.pph22Pct),
        customsValue: D(l.customsValue),
        bm: D(l.bm),
        bmad: D(l.bmad),
        ppn: D(l.ppn),
        ppnbm: D(l.ppnbm),
        pph22: D(l.pph22),
        charges: D(l.charges),
      })),
    });
    if (b.charges.length)
      await tx.landedCostCharge.createMany({
        data: b.charges.map((c) => ({ landedCostId: id, type: c.type, description: c.description, amount: D(c.amount), method: c.method, sourceDocId: c.sourceDocId, sourceLineId: c.sourceLineId })),
      });
    const t = b.totals;
    return {
      supplierId: b.supplierId,
      branchId: b.branchId,
      date: input.date,
      reference: input.reference ?? null,
      pibNo: input.pibNo ?? null,
      pibDate: input.pibDate ?? null,
      incoterm: input.incoterm,
      currencyCode: b.currencyCode,
      ndpbm: D(b.head.ndpbm),
      freightFx: D(input.freightFx),
      insuranceFx: D(input.insuranceFx),
      apiHolder: b.head.apiHolder,
      ppnCreditable: b.head.ppnCreditable,
      bmActual: input.bmActual === null || input.bmActual === undefined ? null : D(input.bmActual),
      ppnActual: input.ppnActual === null || input.ppnActual === undefined ? null : D(input.ppnActual),
      pph22Actual: input.pph22Actual === null || input.pph22Actual === undefined ? null : D(input.pph22Actual),
      customsValue: D(t.customsValue),
      bm: D(t.bm),
      bmad: D(t.bmad),
      ppn: D(t.ppn),
      ppnbm: D(t.ppnbm),
      pph22: D(t.pph22),
      charges: D(t.charges),
      notes: input.notes ?? null,
    };
  }

  async save(id: string | null, input: Input) {
    RequestCtx.assert('purchase.landedcost.manage');
    const u = RequestCtx.user();
    const saved = await this.prisma.$transaction(
      async (tx) => {
        if (id) {
          const cur = await tx.landedCost.findFirst({ where: { id, companyId: u.companyId } });
          if (!cur) throw new NotFoundException('Landed cost not found');
          if (cur.status !== 'DRAFT') throw new ConflictException('Only a draft can be changed');
        }
        const b = await this.build(tx, u.companyId, input, id);
        const row = id
          ? { id }
          : await tx.landedCost.create({ data: { companyId: u.companyId, number: await this.sequence.next('LANDED_COST', u.companyId, input.date, tx), date: input.date, createdById: u.id } });
        const data = await this.write(tx, row.id, input, b);
        return tx.landedCost.update({ where: { id: row.id }, data: { ...data, updatedById: u.id } });
      },
      { timeout: 30_000 },
    );
    await this.audit.record('Landed Cost', saved.id, id ? 'UPDATE' : 'CREATE', null, { number: saved.number });
    return this.get(saved.id);
  }

  /** stored rows back into the input shape (to rebuild with the receipts as they are now) */
  private async inputOf(tx: Tx, id: string): Promise<Input> {
    const lc = await tx.landedCost.findUniqueOrThrow({ where: { id }, include: { lines: true, chargeLines: true } });
    return {
      date: lc.date,
      reference: lc.reference,
      receiptIds: [...new Set(lc.lines.map((l) => l.receiptId))],
      pibNo: lc.pibNo,
      pibDate: lc.pibDate,
      incoterm: lc.incoterm,
      ndpbm: n(lc.ndpbm),
      freightFx: n(lc.freightFx),
      insuranceFx: n(lc.insuranceFx),
      apiHolder: lc.apiHolder,
      ppnCreditable: lc.ppnCreditable,
      bmActual: lc.bmActual === null ? null : n(lc.bmActual),
      ppnActual: lc.ppnActual === null ? null : n(lc.ppnActual),
      pph22Actual: lc.pph22Actual === null ? null : n(lc.pph22Actual),
      lines: lc.lines.map((l) => ({
        receiptLineId: l.receiptLineId,
        weight: n(l.weight),
        hsCode: l.hsCode,
        bmPct: n(l.bmPct),
        bmadPct: n(l.bmadPct),
        ppnbmPct: n(l.ppnbmPct),
        pph22Pct: l.pph22Pct === null ? null : n(l.pph22Pct),
      })),
      charges: lc.chargeLines.map((c) => ({
        type: c.type as (typeof CHARGE_TYPES)[number],
        description: c.description,
        amount: n(c.amount),
        method: c.method as 'VALUE' | 'QTY' | 'WEIGHT',
        sourceLineId: c.sourceLineId,
      })),
      notes: lc.notes,
    };
  }

  /**
   * Posting: per product and warehouse, the part of the received quantity still on hand takes its share in the stock
   * value (average cost), the rest goes to cost of sales; duties to customs payable, charges out of clearing.
   */
  async post(id: string) {
    RequestCtx.assert('purchase.landedcost.post');
    const u = RequestCtx.user();
    const res = await this.prisma.$transaction(
      async (tx) => {
        const cur = await tx.landedCost.findFirst({ where: { id, companyId: u.companyId } });
        if (!cur) throw new NotFoundException('Landed cost not found');
        if (cur.status !== 'DRAFT') throw new ConflictException('Already posted or cancelled');
        const input = await this.inputOf(tx, id);
        const b = await this.build(tx, u.companyId, input, id);
        const data = await this.write(tx, id, input, b);
        const rows = await tx.landedCostLine.findMany({ where: { landedCostId: id } });
        const groups = new Map<string, typeof rows>();
        for (const r of rows) groups.set(`${r.productId}:${r.warehouseId}`, [...(groups.get(`${r.productId}:${r.warehouseId}`) ?? []), r]);
        const products = await tx.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, name: true } });
        const pname = new Map(products.map((p) => [p.id, p.name]));
        const j: PostingLine[] = [];
        let toInv = 0;
        let toCogs = 0;
        for (const g of groups.values()) {
          const bal = await this.inventory.balanceForUpdate(tx, g[0].productId, g[0].warehouseId);
          const received = g.reduce((a, r) => a + n(r.qty), 0);
          const onHand = Math.max(0, n(bal.qty));
          const ratio = received > 0 ? Math.min(1, onHand / received) : 0;
          let inv = 0;
          for (const r of g) {
            const cost = r2(n(r.bm) + n(r.bmad) + n(r.ppnbm) + (b.head.ppnCreditable ? 0 : n(r.ppn)) + n(r.charges));
            const share = r2(cost * ratio);
            inv = r2(inv + share);
            await tx.landedCostLine.update({ where: { id: r.id }, data: { qtyOnHand: D(onHand), toInventory: D(share), toCogs: D(r2(cost - share)) } });
            toCogs = r2(toCogs + cost - share);
            if (cost - share > 0.004) j.push({ key: 'COGS', debit: D(r2(cost - share)), description: `Landed cost of goods sold: ${pname.get(r.productId)}`, supplierId: cur.supplierId });
          }
          if (inv > 0) {
            const applied = await this.inventory.revalue(tx, {
              companyId: u.companyId,
              branchId: cur.branchId,
              productId: g[0].productId,
              warehouseId: g[0].warehouseId,
              date: cur.date,
              amount: D(inv),
              docType: 'LC',
              documentId: id,
              documentNumber: cur.number,
            });
            j.push({ key: 'INVENTORY', debit: applied, description: `Landed cost: ${pname.get(g[0].productId)}` });
            toInv = r2(toInv + n(applied));
          }
        }
        const t = b.totals;
        const ref = cur.pibNo ? `PIB ${cur.pibNo}` : cur.number;
        if (b.head.ppnCreditable && t.ppn > 0) j.push({ key: 'TAX_IN', debit: D(t.ppn), description: `Import PPN ${ref}` });
        if (t.pph22 > 0) j.push({ key: 'PPH22_IMPORT', debit: D(t.pph22), description: `PPh 22 import ${ref}` });
        const duties = r2(t.bm + t.bmad + t.ppn + t.ppnbm + t.pph22);
        if (duties > 0) j.push({ key: 'CUSTOMS_PAYABLE', credit: D(duties), description: `Duties and taxes ${ref}` });
        if (t.charges > 0) j.push({ key: 'LANDED_COST_CLEARING', credit: D(t.charges), description: `Charges spread on ${cur.number}` });
        if (j.length)
          await this.journal.post(tx, {
            companyId: u.companyId,
            branchId: cur.branchId,
            date: cur.date,
            description: `Landed cost ${cur.number}`,
            reference: cur.pibNo ?? cur.reference ?? undefined,
            sourceType: 'LANDED_COST',
            sourceId: id,
            lines: j,
          });
        return tx.landedCost.update({ where: { id }, data: { ...data, status: 'POSTED', postedAt: new Date(), toInventory: D(toInv), toCogs: D(toCogs), updatedById: u.id } });
      },
      { timeout: 60_000 },
    );
    await this.audit.record('Landed Cost', id, 'POST', null, { number: res.number, toInventory: n(res.toInventory), toCogs: n(res.toCogs) });
    return this.get(id);
  }

  /**
   * Cancelling a posted landed cost takes the value back out of the stock in proportion to what is left of the stock it
   * went into (the rest has been sold meanwhile: out of cost of sales), and gives back the payable and the clearing.
   */
  async cancel(id: string) {
    RequestCtx.assert('purchase.landedcost.post');
    const u = RequestCtx.user();
    const res = await this.prisma.$transaction(
      async (tx) => {
        const cur = await tx.landedCost.findFirst({ where: { id, companyId: u.companyId }, include: { lines: true } });
        if (!cur) throw new NotFoundException('Landed cost not found');
        if (cur.status === 'CANCELLED') throw new ConflictException('Already cancelled');
        if (cur.status === 'POSTED') {
          const today = new Date(new Date().toISOString().slice(0, 10));
          const j: PostingLine[] = [];
          const groups = new Map<string, typeof cur.lines>();
          for (const r of cur.lines) groups.set(`${r.productId}:${r.warehouseId}`, [...(groups.get(`${r.productId}:${r.warehouseId}`) ?? []), r]);
          let fromCogs = 0;
          for (const g of groups.values()) {
            const inv = r2(g.reduce((a, r) => a + n(r.toInventory), 0));
            fromCogs = r2(fromCogs + g.reduce((a, r) => a + n(r.toCogs), 0));
            if (inv <= 0) continue;
            const bal = await this.inventory.balanceForUpdate(tx, g[0].productId, g[0].warehouseId);
            const then = n(g[0].qtyOnHand);
            const left = then > 0 ? Math.min(1, Math.max(0, n(bal.qty)) / then) : 0;
            const removed = await this.inventory.revalue(tx, {
              companyId: u.companyId,
              branchId: cur.branchId,
              productId: g[0].productId,
              warehouseId: g[0].warehouseId,
              date: today,
              amount: D(-r2(inv * left)),
              docType: 'LC-REV',
              documentId: id,
              documentNumber: cur.number,
            });
            if (n(removed) < 0) j.push({ key: 'INVENTORY', credit: removed.abs(), description: `Landed cost cancelled ${cur.number}` });
            fromCogs = r2(fromCogs + inv + n(removed));
          }
          if (fromCogs > 0.004) j.push({ key: 'COGS', credit: D(fromCogs), description: `Landed cost cancelled ${cur.number} (goods sold)`, supplierId: cur.supplierId });
          const ref = cur.pibNo ? `PIB ${cur.pibNo}` : cur.number;
          if (cur.ppnCreditable && n(cur.ppn) > 0) j.push({ key: 'TAX_IN', credit: cur.ppn, description: `Import PPN ${ref} cancelled` });
          if (n(cur.pph22) > 0) j.push({ key: 'PPH22_IMPORT', credit: cur.pph22, description: `PPh 22 import ${ref} cancelled` });
          const duties = r2(n(cur.bm) + n(cur.bmad) + n(cur.ppn) + n(cur.ppnbm) + n(cur.pph22));
          if (duties > 0) j.push({ key: 'CUSTOMS_PAYABLE', debit: D(duties), description: `Duties and taxes ${ref} cancelled` });
          if (n(cur.charges) > 0) j.push({ key: 'LANDED_COST_CLEARING', debit: cur.charges, description: `Charges back to clearing ${cur.number}` });
          if (j.length)
            await this.journal.post(tx, {
              companyId: u.companyId,
              branchId: cur.branchId,
              date: today,
              description: `Landed cost ${cur.number} cancelled`,
              reference: cur.pibNo ?? undefined,
              sourceType: 'LANDED_COST_REV',
              sourceId: id,
              lines: j,
            });
        }
        return tx.landedCost.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), updatedById: u.id } });
      },
      { timeout: 60_000 },
    );
    await this.audit.record('Landed Cost', id, 'CANCEL', null, { number: res.number });
    return this.get(id);
  }
}
