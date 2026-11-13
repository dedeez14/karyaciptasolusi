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
import { addDays, addMonths, allocateFifo, BC_TYPES, bcType, conversion, domesticQuota, ImportLot, mutation } from './bonded-calc';

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());
const money = z.preprocess((v) => (v === '' || v === null || v === undefined ? 0 : v), z.coerce.number().min(0).max(1e15));
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });
const DAY = 86_400_000;

export const CLASSES = ['RAW', 'AUX', 'FG', 'CAPITAL', 'RND', 'FUEL', 'OFFICE', 'SCRAP'] as const;
const STOCK_IN = ['GR', 'SR', 'TRF', 'ADJ'];
const STOCK_OUT = ['DO', 'PRT', 'TRF', 'ADJ'];

const lineSchema = z.object({
  productId: z.uuid(),
  hsCode: optText(12),
  description: optText(200),
  qty: z.coerce.number().positive().max(1e12),
  uom: optText(20),
  value: money,
  originCountry: optText(3),
  wastePct: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(100).nullable().optional()),
});
export const documentSchema = z.object({
  bcType: z.enum(BC_TYPES.map((t) => t.code) as [string, ...string[]]),
  direction: z.enum(['IN', 'OUT']),
  facility: z.enum(['KB', 'KITE']).default('KB'),
  destination: z.preprocess((v) => (v === '' ? null : v), z.enum(['TLDDP', 'FTZ', 'KEK', 'KB']).nullable().optional()),
  tradeDocumentId: optUuid,
  ajuNo: optText(30),
  officeCode: optText(8),
  supplierId: optUuid,
  customerId: optUuid,
  partnerName: optText(200),
  currencyCode: z.string().trim().length(3).default('IDR'),
  exchangeRate: z.coerce.number().positive().max(1e9).default(1),
  dutyBasis: z.preprocess((v) => (v === '' ? null : v), z.enum(['FG', 'RAW']).nullable().optional()),
  returnDueDate: optDate,
  linkedId: optUuid,
  taxInvoiceCode: optText(2),
  notes: optText(2000),
  lines: z.array(lineSchema).max(500).optional(),
});
export const registerSchema = z.object({
  registrationNo: z.string().trim().min(1).max(20),
  registrationDate: z.coerce.date(),
  ajuNo: optText(30),
  officeCode: optText(8),
  bm: money,
  ppn: money,
  ppnbm: money,
  pph22: money,
  fine: money,
  dutyStatus: z.enum(['SUSPENDED', 'PAYABLE', 'GUARANTEE']),
  ppnCreditable: z.boolean().default(true),
  kiteDueDate: optDate,
});

type Tx = Prisma.TransactionClient;

/**
 * Bonded zone (Kawasan Berikat, PMK 131/2018 jo 65/2021) and KITE (PMK 149/2022): customs documents laid over the stock
 * documents that moved the goods, the IT Inventory reports (PER-19/BC/2018 Art. 19 jo PER-9/BC/2021), the domestic
 * sales quota and the KITE accountability (conversion of imported materials into exports, BCL.KT01).
 */
@Injectable()
export class BondedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
  ) {}

  meta() {
    RequestCtx.assert('bonded.read');
    return { types: BC_TYPES, classes: CLASSES };
  }

  // ------------------------------------------------------------------ documents
  async documents(f: { bcType?: string; direction?: string; status?: string; facility?: string; from?: string; to?: string; q?: string }) {
    RequestCtx.assert('bonded.read');
    const companyId = RequestCtx.companyId();
    const date = f.from || f.to ? { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(f.to) } : {}) } : undefined;
    const rows = await this.prisma.customsDocument.findMany({
      where: {
        companyId,
        ...(f.bcType ? { bcType: f.bcType } : {}),
        ...(f.direction ? { direction: f.direction } : {}),
        ...(f.status ? { status: f.status } : {}),
        ...(f.facility ? { facility: f.facility } : {}),
        ...(date ? { OR: [{ registrationDate: date }, { registrationDate: null, createdAt: date }] } : {}),
        ...(f.q ? { OR: [{ number: { contains: f.q, mode: 'insensitive' } }, { registrationNo: { contains: f.q } }, { ajuNo: { contains: f.q } }, { receiptNumber: { contains: f.q, mode: 'insensitive' } }, { partnerName: { contains: f.q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ registrationDate: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: 300,
      include: { _count: { select: { lines: true } } },
    });
    return rows.map((r) => ({ ...this.head(r), lineCount: r._count.lines }));
  }

  private head(r: Prisma.CustomsDocumentGetPayload<object>) {
    return {
      ...r,
      exchangeRate: n(r.exchangeRate),
      totalValue: n(r.totalValue),
      totalValueIdr: n(r.totalValueIdr),
      bm: n(r.bm),
      ppn: n(r.ppn),
      ppnbm: n(r.ppnbm),
      pph22: n(r.pph22),
      fine: n(r.fine),
      typeLabel: bcType(r.bcType)?.label ?? r.bcType,
    };
  }

  async document(id: string) {
    RequestCtx.assert('bonded.read');
    const d = await this.prisma.customsDocument.findFirst({ where: { id, companyId: RequestCtx.companyId() }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!d) throw new NotFoundException('Customs document not found');
    const allocs = await this.prisma.customsAllocation.findMany({ where: { OR: [{ targetDocId: d.id }, { sourceLineId: { in: d.lines.map((l) => l.id) } }] } });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: [...d.lines.map((l) => l.productId), ...allocs.map((a) => a.productId)] } }, select: { id: true, code: true, name: true, customsClass: true } })).map((p) => [p.id, p]));
    const lineDocs = new Map(
      (await this.prisma.customsDocumentLine.findMany({ where: { id: { in: allocs.map((a) => a.sourceLineId) } }, select: { id: true, lineNo: true, document: { select: { id: true, number: true, bcType: true, registrationNo: true, registrationDate: true } } } })).map((l) => [l.id, l]),
    );
    const targets = new Map((await this.prisma.customsDocument.findMany({ where: { id: { in: allocs.map((a) => a.targetDocId) } }, select: { id: true, number: true, bcType: true, registrationNo: true, registrationDate: true } })).map((t) => [t.id, t]));
    const [trade, linked, returns] = await Promise.all([
      d.tradeDocumentId ? this.prisma.tradeDocument.findUnique({ where: { id: d.tradeDocumentId }, select: { id: true, docType: true, number: true, date: true } }) : null,
      d.linkedId ? this.prisma.customsDocument.findUnique({ where: { id: d.linkedId }, select: { id: true, number: true, bcType: true, registrationNo: true } }) : null,
      d.bcType === 'BC261' ? this.prisma.customsDocument.findMany({ where: { linkedId: d.id, status: { not: 'CANCELLED' } }, select: { id: true, number: true, registrationNo: true, registrationDate: true, status: true } }) : [],
    ]);
    return {
      ...this.head(d),
      trade,
      linked,
      returns,
      lines: d.lines.map((l) => ({ ...l, qty: n(l.qty), value: n(l.value), valueIdr: n(l.valueIdr), wastePct: l.wastePct === null ? null : n(l.wastePct), settledQty: n(l.settledQty), product: products.get(l.productId) ?? null })),
      allocations: allocs.map((a) => ({ id: a.id, kind: a.kind, productId: a.productId, qty: n(a.qty), product: products.get(a.productId) ?? null, source: lineDocs.get(a.sourceLineId) ?? null, target: targets.get(a.targetDocId) ?? null, sourceLineId: a.sourceLineId, targetLineId: a.targetLineId })),
    };
  }

  /** confirmed stock documents of the right direction that have no customs document yet */
  async candidates(direction: string, q?: string) {
    RequestCtx.assert('bonded.read');
    const companyId = RequestCtx.companyId();
    const types = direction === 'OUT' ? STOCK_OUT : STOCK_IN;
    const used = (await this.prisma.customsDocument.findMany({ where: { companyId, status: { not: 'CANCELLED' }, tradeDocumentId: { not: null } }, select: { tradeDocumentId: true } })).map((x) => x.tradeDocumentId!);
    const docs = await this.prisma.tradeDocument.findMany({
      where: { companyId, deletedAt: null, docType: { in: types }, status: { in: ['CONFIRMED', 'PARTIAL', 'COMPLETED'] }, id: { notIn: used }, date: { gte: addDays(new Date(), -400) }, ...(q ? { number: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { date: 'desc' },
      take: 50,
      select: { id: true, docType: true, number: true, date: true, supplierId: true, customerId: true, grandTotal: true, currencyCode: true },
    });
    const names = await this.partnerNames(docs);
    return docs.map((d) => ({ ...d, grandTotal: n(d.grandTotal), partner: names.get(d.supplierId ?? d.customerId ?? '') ?? null }));
  }

  private async partnerNames(docs: { supplierId: string | null; customerId: string | null }[]) {
    const [s, c] = await Promise.all([
      this.prisma.supplier.findMany({ where: { id: { in: docs.map((d) => d.supplierId!).filter(Boolean) } }, select: { id: true, name: true } }),
      this.prisma.customer.findMany({ where: { id: { in: docs.map((d) => d.customerId!).filter(Boolean) } }, select: { id: true, name: true } }),
    ]);
    return new Map([...s, ...c].map((x) => [x.id, x.name]));
  }

  /** lines and partner taken from the stock document: quantities moved, values at the document price (or cost) */
  private async fromTrade(tx: Tx, companyId: string, tradeId: string, direction: string) {
    const t = await tx.tradeDocument.findFirst({ where: { id: tradeId, companyId, deletedAt: null }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!t) throw invalid({ tradeDocumentId: 'Stock document not found' });
    if (!['CONFIRMED', 'PARTIAL', 'COMPLETED'].includes(t.status)) throw invalid({ tradeDocumentId: 'Confirm the stock document first' });
    if (!(direction === 'OUT' ? STOCK_OUT : STOCK_IN).includes(t.docType)) throw invalid({ tradeDocumentId: `A ${t.docType} does not move goods ${direction === 'OUT' ? 'out' : 'in'}` });
    const taken = await tx.customsDocument.findFirst({ where: { tradeDocumentId: t.id, status: { not: 'CANCELLED' } }, select: { number: true } });
    if (taken) throw new ConflictException(`${t.number} is already on customs document ${taken.number}`);
    const products = new Map((await tx.product.findMany({ where: { id: { in: t.lines.map((l) => l.productId!).filter(Boolean) } }, select: { id: true, hsCode: true, originCountry: true, type: true, uom: { select: { code: true } } } })).map((p) => [p.id, p]));
    const priced = ['GR', 'DO', 'SR', 'PRT'].includes(t.docType) && t.lines.some((l) => n(l.unitPrice) > 0);
    const lines = t.lines
      .filter((l) => l.productId && products.get(l.productId)?.type === 'STOCK')
      .map((l) => {
        const p = products.get(l.productId!)!;
        const value = priced ? n(l.lineSubtotal) - n(l.lineDiscount) : n(l.qty) * n(l.unitCost);
        return { productId: l.productId!, hsCode: p.hsCode, description: l.description, qty: Math.abs(n(l.qty)), uom: p.uom?.code ?? null, value: r2(Math.abs(value)), originCountry: p.originCountry, wastePct: null };
      });
    const names = await this.partnerNames([t]);
    return { t, lines, priced, partnerName: names.get(t.supplierId ?? t.customerId ?? '') ?? null };
  }

  private async writeLines(tx: Tx, documentId: string, lines: z.infer<typeof lineSchema>[], rate: number) {
    await tx.customsDocumentLine.deleteMany({ where: { documentId } });
    let total = 0;
    for (const [i, l] of lines.entries()) {
      total += l.value;
      await tx.customsDocumentLine.create({ data: { documentId, lineNo: i + 1, productId: l.productId, hsCode: l.hsCode ?? null, description: l.description ?? null, qty: D(l.qty), uom: l.uom ?? null, value: D(l.value), valueIdr: D(r2(l.value * rate)), originCountry: l.originCountry ?? null, wastePct: l.wastePct === null || l.wastePct === undefined ? null : D(l.wastePct) } });
    }
    return { totalValue: D(r2(total)), totalValueIdr: D(r2(total * rate)) };
  }

  private check(input: z.infer<typeof documentSchema>) {
    const t = bcType(input.bcType)!;
    if (!t.dirs.includes(input.direction)) throw invalid({ direction: `${t.label} goes ${t.dirs[0] === 'IN' ? 'in' : 'out'}` });
    if (input.bcType === 'BC20' && input.facility !== 'KITE') throw invalid({ facility: 'BC 2.0 entries are KITE imports' });
    if (input.bcType === 'BC24' && input.facility !== 'KITE') throw invalid({ facility: 'BC 2.4 settles KITE materials' });
    if (input.bcType === 'BC262' && !input.linkedId) throw invalid({ linkedId: 'Choose the BC 2.6.1 the goods come back from' });
    if (input.currencyCode === 'IDR' && input.exchangeRate !== 1) input.exchangeRate = 1;
  }

  async create(input: z.infer<typeof documentSchema>) {
    RequestCtx.assert('bonded.document.manage');
    this.check(input);
    const u = RequestCtx.user();
    const t = bcType(input.bcType)!;
    const id = await this.prisma.$transaction(async (tx) => {
      let lines = input.lines ?? [];
      let receipt: { number: string; date: Date } | null = null;
      let partnerName = input.partnerName ?? null;
      let supplierId = input.supplierId ?? null;
      let customerId = input.customerId ?? null;
      let currencyCode = input.currencyCode;
      let rate = input.exchangeRate;
      if (input.tradeDocumentId) {
        const fromT = await this.fromTrade(tx, u.companyId, input.tradeDocumentId, input.direction);
        if (!lines.length) lines = fromT.lines;
        receipt = { number: fromT.t.number, date: fromT.t.date };
        partnerName ??= fromT.partnerName;
        supplierId ??= fromT.t.supplierId;
        customerId ??= fromT.t.customerId;
        if (fromT.priced && fromT.t.currencyCode !== 'IDR' && input.currencyCode === 'IDR') {
          currencyCode = fromT.t.currencyCode;
          rate = n(fromT.t.exchangeRate);
        }
      }
      if (input.linkedId) {
        const out = await this.linkedOut(tx, u.companyId, input.linkedId);
        partnerName ??= out.partnerName;
        if (!lines.length) {
          const open = await tx.customsDocumentLine.findMany({ where: { documentId: out.id }, orderBy: { lineNo: 'asc' } });
          lines = open.filter((l) => n(l.qty) > n(l.settledQty)).map((l) => ({ productId: l.productId, hsCode: l.hsCode, description: l.description, qty: r4(n(l.qty) - n(l.settledQty)), uom: l.uom, value: r2((n(l.value) * (n(l.qty) - n(l.settledQty))) / n(l.qty)), originCountry: l.originCountry, wastePct: null }));
        }
      }
      const number = await this.sequence.next('CUSTOMS_DOC', u.companyId, new Date(), tx);
      const d = await tx.customsDocument.create({
        data: {
          companyId: u.companyId,
          branchId: u.branchId ?? null,
          number,
          bcType: input.bcType,
          direction: input.direction,
          facility: input.facility,
          destination: input.destination ?? (input.bcType === 'BC25' ? 'TLDDP' : input.bcType === 'BC27' && input.direction === 'OUT' ? 'KB' : null),
          ajuNo: input.ajuNo ?? null,
          officeCode: input.officeCode ?? null,
          tradeDocumentId: input.tradeDocumentId ?? null,
          receiptNumber: receipt?.number ?? null,
          receiptDate: receipt?.date ?? null,
          supplierId,
          customerId,
          partnerName,
          currencyCode,
          exchangeRate: D(rate),
          dutyBasis: input.bcType === 'BC25' ? (input.dutyBasis ?? 'FG') : null,
          dutyStatus: t.duty,
          returnDueDate: input.returnDueDate ?? null,
          linkedId: input.linkedId ?? null,
          taxInvoiceCode: input.taxInvoiceCode ?? t.faktur ?? null,
          notes: input.notes ?? null,
          createdById: u.id,
          updatedById: u.id,
        },
      });
      const totals = await this.writeLines(tx, d.id, lines, rate);
      await tx.customsDocument.update({ where: { id: d.id }, data: totals });
      return d.id;
    });
    await this.audit.record('Customs Document', id, 'CREATE', null, { bcType: input.bcType, tradeDocumentId: input.tradeDocumentId });
    return this.document(id);
  }

  private async linkedOut(tx: Tx, companyId: string, linkedId: string) {
    const l = await tx.customsDocument.findFirst({ where: { id: linkedId, companyId, bcType: 'BC261', status: 'REGISTERED' } });
    if (!l) throw invalid({ linkedId: 'Choose a registered BC 2.6.1' });
    return l;
  }

  async update(id: string, input: z.infer<typeof documentSchema>) {
    RequestCtx.assert('bonded.document.manage');
    this.check(input);
    const u = RequestCtx.user();
    const d = await this.prisma.customsDocument.findFirst({ where: { id, companyId: u.companyId } });
    if (!d) throw new NotFoundException('Customs document not found');
    if (d.status !== 'DRAFT') throw new ConflictException('Only a draft can be changed: cancel the registration first');
    if (input.bcType !== d.bcType || input.direction !== d.direction) throw invalid({ bcType: 'The document type cannot change: cancel this one and make a new one' });
    await this.prisma.$transaction(async (tx) => {
      if (input.linkedId) await this.linkedOut(tx, u.companyId, input.linkedId);
      const rate = input.currencyCode === 'IDR' ? 1 : input.exchangeRate;
      const totals = input.lines?.length ? await this.writeLines(tx, id, input.lines, rate) : {};
      await tx.customsDocument.update({
        where: { id },
        data: {
          ...totals,
          facility: input.facility,
          destination: input.destination ?? null,
          ajuNo: input.ajuNo ?? null,
          officeCode: input.officeCode ?? null,
          supplierId: input.supplierId ?? d.supplierId,
          customerId: input.customerId ?? d.customerId,
          partnerName: input.partnerName ?? d.partnerName,
          currencyCode: input.currencyCode,
          exchangeRate: D(rate),
          dutyBasis: d.bcType === 'BC25' ? (input.dutyBasis ?? 'FG') : null,
          returnDueDate: input.returnDueDate ?? null,
          linkedId: input.linkedId ?? null,
          taxInvoiceCode: input.taxInvoiceCode ?? null,
          notes: input.notes ?? null,
          updatedById: u.id,
        },
      });
      if (!input.lines?.length && n(d.exchangeRate) !== rate) {
        const lines = await tx.customsDocumentLine.findMany({ where: { documentId: id } });
        for (const l of lines) await tx.customsDocumentLine.update({ where: { id: l.id }, data: { valueIdr: D(r2(n(l.value) * rate)) } });
        await tx.customsDocument.update({ where: { id }, data: { totalValueIdr: D(r2(n(d.totalValue) * rate)) } });
      }
    });
    await this.audit.record('Customs Document', id, 'UPDATE');
    return this.document(id);
  }

  /** registration (nomor & tanggal pendaftaran): duties we pay are booked to Import Duties & Taxes Payable */
  async register(id: string, input: z.infer<typeof registerSchema>) {
    RequestCtx.assert('bonded.register');
    const u = RequestCtx.user();
    const d = await this.prisma.customsDocument.findFirst({ where: { id, companyId: u.companyId }, include: { lines: true } });
    if (!d) throw new NotFoundException('Customs document not found');
    if (d.status !== 'DRAFT') throw new ConflictException('Already registered or cancelled');
    if (!d.lines.length) throw invalid({ lines: 'Add the goods first' });
    if (input.registrationDate.getTime() > Date.now() + DAY) throw invalid({ registrationDate: 'The registration date cannot be in the future' });
    if (d.receiptDate && input.registrationDate.getTime() > d.receiptDate.getTime() + 60 * DAY && d.direction === 'OUT') throw invalid({ registrationDate: 'Goods leave on a registered document: the registration is long after the release' });
    const dup = await this.prisma.customsDocument.findFirst({ where: { companyId: u.companyId, bcType: d.bcType, registrationNo: input.registrationNo, status: 'REGISTERED', id: { not: id }, registrationDate: { gte: new Date(Date.UTC(input.registrationDate.getUTCFullYear(), 0, 1)) } } });
    if (dup) throw invalid({ registrationNo: `Already used on ${dup.number}` });
    const months = await this.settings.num('bonded.kiteMonths', u.companyId, 12);
    const kiteImport = d.facility === 'KITE' && d.direction === 'IN';
    await this.prisma.$transaction(async (tx) => {
      const amounts = { bm: input.bm, ppn: input.ppn, ppnbm: input.ppnbm, pph22: input.pph22, fine: input.fine };
      if (input.dutyStatus === 'PAYABLE') {
        const lines = [];
        const ref = `${bcType(d.bcType)?.label.split(' ').slice(0, 2).join(' ')} ${input.registrationNo}`;
        if (input.bm) lines.push({ key: 'CUSTOMS_DUTY', debit: D(input.bm), description: `Import duty ${ref}` });
        if (input.ppn) lines.push({ key: input.ppnCreditable ? 'TAX_IN' : 'CUSTOMS_DUTY', debit: D(input.ppn), description: `Import PPN ${ref}${input.ppnCreditable ? '' : ' (not creditable)'}` });
        if (input.ppnbm) lines.push({ key: 'CUSTOMS_DUTY', debit: D(input.ppnbm), description: `PPnBM ${ref}` });
        if (input.pph22) lines.push({ key: 'PPH22_IMPORT', debit: D(input.pph22), description: `PPh 22 import ${ref}` });
        if (input.fine) lines.push({ key: 'CUSTOMS_FINE', debit: D(input.fine), description: `Customs fine ${ref}` });
        const total = input.bm + input.ppn + input.ppnbm + input.pph22 + input.fine;
        if (total > 0) {
          lines.push({ key: 'CUSTOMS_PAYABLE', credit: D(r2(total)), description: ref });
          await this.journal.post(tx, { companyId: u.companyId, branchId: d.branchId, date: input.registrationDate, description: `${d.number} ${ref}: duties and taxes`, reference: input.registrationNo, sourceType: 'BCDUTY', sourceId: d.id, lines });
        }
      }
      await tx.customsDocument.update({
        where: { id },
        data: {
          status: 'REGISTERED',
          registrationNo: input.registrationNo,
          registrationDate: input.registrationDate,
          ajuNo: input.ajuNo ?? d.ajuNo,
          officeCode: input.officeCode ?? d.officeCode,
          bm: D(amounts.bm),
          ppn: D(amounts.ppn),
          ppnbm: D(amounts.ppnbm),
          pph22: D(amounts.pph22),
          fine: D(amounts.fine),
          dutyStatus: input.dutyStatus,
          ppnCreditable: input.ppnCreditable,
          kiteDueDate: kiteImport ? (input.kiteDueDate ?? addMonths(input.registrationDate, months)) : null,
          updatedById: u.id,
        },
      });
      if (d.bcType === 'BC262' && d.linkedId) await this.allocateReturn(tx, u.companyId, d);
    });
    await this.audit.record('Customs Document', id, 'REGISTER', { status: 'DRAFT' }, { registrationNo: input.registrationNo, dutyStatus: input.dutyStatus });
    return this.document(id);
  }

  /** goods back on a BC 2.6.2 settle the open lines of its BC 2.6.1, by product, oldest line first */
  private async allocateReturn(tx: Tx, companyId: string, d: { id: string; linkedId: string | null; lines: { id: string; productId: string; qty: Prisma.Decimal }[] }) {
    const outLines = await tx.customsDocumentLine.findMany({ where: { documentId: d.linkedId! }, orderBy: { lineNo: 'asc' } });
    const lots: ImportLot[] = outLines.map((l) => ({ lineId: l.id, productId: l.productId, date: String(l.lineNo).padStart(4, '0'), remaining: r4(n(l.qty) - n(l.settledQty)) }));
    for (const l of d.lines) {
      const { allocations } = allocateFifo(lots, l.productId, n(l.qty));
      for (const a of allocations) {
        await tx.customsAllocation.create({ data: { companyId, kind: 'RETURN', sourceLineId: a.lineId, targetDocId: d.id, targetLineId: l.id, productId: l.productId, qty: D(a.qty) } });
        await tx.customsDocumentLine.update({ where: { id: a.lineId }, data: { settledQty: { increment: D(a.qty) } } });
      }
    }
  }

  private async releaseAllocations(tx: Tx, targetDocId: string) {
    const allocs = await tx.customsAllocation.findMany({ where: { targetDocId } });
    for (const a of allocs) await tx.customsDocumentLine.update({ where: { id: a.sourceLineId }, data: { settledQty: { decrement: a.qty } } });
    await tx.customsAllocation.deleteMany({ where: { targetDocId } });
    return allocs.length;
  }

  /** cancel: a draft is dropped; a registration is undone (duty journal voided, returns / KITE charges released) */
  async cancel(id: string) {
    RequestCtx.assert('bonded.register');
    const u = RequestCtx.user();
    const d = await this.prisma.customsDocument.findFirst({ where: { id, companyId: u.companyId }, include: { lines: true } });
    if (!d) throw new NotFoundException('Customs document not found');
    if (d.status === 'CANCELLED') throw new ConflictException('Already cancelled');
    const used = await this.prisma.customsAllocation.findFirst({ where: { sourceLineId: { in: d.lines.map((l) => l.id) } } });
    if (used) throw new ConflictException(d.bcType === 'BC261' ? 'Goods have come back on a BC 2.6.2: cancel that first' : 'Its materials are charged to an export / BC 2.4: release that first');
    if (d.bcType === 'BC261' && (await this.prisma.customsDocument.findFirst({ where: { linkedId: d.id, status: 'DRAFT' } }))) throw new ConflictException('A draft BC 2.6.2 refers to it: cancel the draft first');
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'BCDUTY', d.id);
      await this.releaseAllocations(tx, d.id);
      await tx.customsDocument.update({ where: { id }, data: { status: 'CANCELLED', updatedById: u.id } });
    });
    await this.audit.record('Customs Document', id, 'CANCEL', { status: d.status }, { status: 'CANCELLED' });
    return this.document(id);
  }

  // ------------------------------------------------------------------ IT Inventory reports
  private range(from: string, to: string) {
    const f = new Date(from);
    const t = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || f > t) throw new BadRequestException('Choose a valid period');
    if (t.getTime() - f.getTime() > 400 * DAY) throw new BadRequestException('Choose at most a year');
    return { f, t };
  }

  /** goods in / out per customs document (PER-9/BC/2021 Art. 19): document, registration, receipt / release proof, item, unit, quantity, value */
  async movements(direction: 'IN' | 'OUT', from: string, to: string) {
    RequestCtx.assert('bonded.read');
    const { f, t } = this.range(from, to);
    const docs = await this.prisma.customsDocument.findMany({ where: { companyId: RequestCtx.companyId(), direction, status: 'REGISTERED', registrationDate: { gte: f, lte: t } }, orderBy: [{ registrationDate: 'asc' }, { registrationNo: 'asc' }], include: { lines: { orderBy: { lineNo: 'asc' } } } });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: [...new Set(docs.flatMap((d) => d.lines.map((l) => l.productId)))] } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    return docs.flatMap((d) =>
      d.lines.map((l) => ({
        documentId: d.id,
        bcType: d.bcType,
        facility: d.facility,
        registrationNo: d.registrationNo,
        registrationDate: iso(d.registrationDate),
        receiptNumber: d.receiptNumber,
        receiptDate: iso(d.receiptDate),
        partner: d.partnerName,
        lineNo: l.lineNo,
        code: products.get(l.productId)?.code ?? '',
        name: l.description || products.get(l.productId)?.name || '',
        hsCode: l.hsCode,
        uom: l.uom,
        qty: n(l.qty),
        currency: d.currencyCode,
        value: n(l.value),
        valueIdr: n(l.valueIdr),
      })),
    );
  }

  /** mutation report of one IT Inventory class: opening, in, out, adjustment, closing, stock count, difference */
  async mutationReport(cls: string, from: string, to: string, warehouseId?: string) {
    RequestCtx.assert('bonded.read');
    if (!(CLASSES as readonly string[]).includes(cls)) throw new BadRequestException('Choose a class');
    const { f, t } = this.range(from, to);
    const companyId = RequestCtx.companyId();
    const products = await this.prisma.product.findMany({ where: { companyId, customsClass: cls, deletedAt: null }, select: { id: true, code: true, name: true, uom: { select: { code: true } } }, orderBy: { code: 'asc' } });
    const ids = products.map((p) => p.id);
    const wh = warehouseId ? { warehouseId } : {};
    const [before, moves, counts] = await Promise.all([
      this.prisma.stockMovement.groupBy({ by: ['productId'], where: { companyId, productId: { in: ids }, date: { lt: f }, ...wh }, _sum: { qty: true } }),
      this.prisma.stockMovement.findMany({ where: { companyId, productId: { in: ids }, date: { gte: f, lte: t }, ...wh }, select: { productId: true, qty: true, docType: true, documentId: true } }),
      this.prisma.stockCount.findMany({ where: { companyId, status: 'POSTED', countDate: { gte: f, lte: t }, deletedAt: null, ...wh }, orderBy: { countDate: 'asc' }, select: { warehouseId: true, adjustmentId: true, lines: { where: { productId: { in: ids } }, select: { productId: true, countedQty: true } } } }),
    ]);
    // latest count per warehouse and product, summed over the warehouses
    const latest = new Map<string, number>();
    for (const c of counts) for (const l of c.lines) if (l.countedQty !== null) latest.set(`${c.warehouseId}|${l.productId}`, n(l.countedQty));
    const counted = new Map<string, number>();
    for (const [k, v] of latest) counted.set(k.split('|')[1], (counted.get(k.split('|')[1]) ?? 0) + v);
    const rows = mutation(
      new Map(before.map((b) => [b.productId, n(b._sum.qty)])),
      moves.map((m) => ({ productId: m.productId, qty: n(m.qty), docType: m.docType, documentId: m.documentId })),
      new Set(counts.map((c) => c.adjustmentId!).filter(Boolean)),
      counted,
    );
    const byId = new Map(products.map((p) => [p.id, p]));
    return { class: cls, from, to, rows: rows.map((r) => ({ ...r, code: byId.get(r.productId)?.code ?? '', name: byId.get(r.productId)?.name ?? '', uom: byId.get(r.productId)?.uom?.code ?? '' })).sort((a, b) => a.code.localeCompare(b.code)) };
  }

  /** work-in-process position on a date: open production orders and garment orders (cut, not yet received) */
  async wip() {
    RequestCtx.assert('bonded.read');
    const companyId = RequestCtx.companyId();
    const [orders, garments] = await Promise.all([
      this.prisma.workOrder.findMany({ where: { companyId, deletedAt: null, status: 'RELEASED' }, select: { number: true, productId: true, qty: true, producedQty: true, startedAt: true, wipMaterial: true } }),
      this.prisma.garmentOrder.findMany({ where: { companyId, status: 'OPEN' }, select: { number: true, lines: { select: { productId: true, cutQty: true, receivedQty: true } } } }),
    ]);
    const rows: { productId: string; qty: number; note: string }[] = [];
    for (const o of orders) if (o.startedAt || n(o.wipMaterial) > 0) rows.push({ productId: o.productId, qty: r4(n(o.qty) - n(o.producedQty)), note: o.number });
    for (const g of garments) for (const l of g.lines) if (l.cutQty > l.receivedQty) rows.push({ productId: l.productId, qty: l.cutQty - l.receivedQty, note: g.number });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true, uom: { select: { code: true } } } })).map((p) => [p.id, p]));
    return rows.filter((r) => r.qty > 0).map((r) => ({ ...r, code: products.get(r.productId)?.code ?? '', name: products.get(r.productId)?.name ?? '', uom: products.get(r.productId)?.uom?.code ?? '' })).sort((a, b) => a.code.localeCompare(b.code) || a.note.localeCompare(b.note));
  }

  /** stock documents that moved goods in the period without a customs document (every movement must carry one) */
  async unlinked(from: string, to: string) {
    RequestCtx.assert('bonded.read');
    const { f, t } = this.range(from, to);
    const companyId = RequestCtx.companyId();
    const used = (await this.prisma.customsDocument.findMany({ where: { companyId, status: { not: 'CANCELLED' }, tradeDocumentId: { not: null } }, select: { tradeDocumentId: true } })).map((x) => x.tradeDocumentId!);
    const docs = await this.prisma.tradeDocument.findMany({ where: { companyId, deletedAt: null, isOpening: false, docType: { in: ['GR', 'DO', 'SR', 'PRT'] }, status: { in: ['CONFIRMED', 'PARTIAL', 'COMPLETED'] }, date: { gte: f, lte: t }, id: { notIn: used } }, orderBy: { date: 'asc' }, select: { id: true, docType: true, number: true, date: true, supplierId: true, customerId: true }, take: 300 });
    const names = await this.partnerNames(docs);
    return docs.map((d) => ({ ...d, partner: names.get(d.supplierId ?? d.customerId ?? '') ?? null }));
  }

  /** goods out on BC 2.6.1 not back yet, with the return deadline */
  async subcontract() {
    RequestCtx.assert('bonded.read');
    const docs = await this.prisma.customsDocument.findMany({ where: { companyId: RequestCtx.companyId(), bcType: 'BC261', status: 'REGISTERED' }, orderBy: { registrationDate: 'asc' }, include: { lines: true } });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: docs.flatMap((d) => d.lines.map((l) => l.productId)) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    const today = new Date();
    return docs
      .map((d) => ({
        id: d.id,
        number: d.number,
        registrationNo: d.registrationNo,
        registrationDate: iso(d.registrationDate),
        partner: d.partnerName,
        returnDueDate: iso(d.returnDueDate),
        overdue: !!d.returnDueDate && d.returnDueDate < today,
        guarantee: n(d.bm) + n(d.ppn) + n(d.ppnbm) + n(d.pph22),
        lines: d.lines.map((l) => ({ code: products.get(l.productId)?.code, name: products.get(l.productId)?.name, uom: l.uom, qty: n(l.qty), back: n(l.settledQty), open: r4(n(l.qty) - n(l.settledQty)) })).filter((l) => l.open > 0),
      }))
      .filter((d) => d.lines.length);
  }

  // ------------------------------------------------------------------ domestic quota
  async quota(year: number) {
    RequestCtx.assert('bonded.read');
    if (!(year >= 2000 && year <= 2100)) throw new BadRequestException('Choose a year');
    const companyId = RequestCtx.companyId();
    const pct = await this.settings.num('bonded.domesticQuotaPct', companyId, 50);
    const docs = await this.prisma.customsDocument.findMany({ where: { companyId, facility: 'KB', status: 'REGISTERED', direction: 'OUT', bcType: { in: ['BC30', 'BC27', 'BC25', 'BC41'] }, registrationDate: { gte: new Date(Date.UTC(year - 1, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } }, select: { bcType: true, destination: true, registrationDate: true, totalValueIdr: true } });
    const realisation = (d: (typeof docs)[number]) => d.bcType === 'BC30' || d.bcType === 'BC27' || (d.bcType === 'BC25' && (d.destination === 'FTZ' || d.destination === 'KEK'));
    const domestic = (d: (typeof docs)[number]) => (d.bcType === 'BC25' && (!d.destination || d.destination === 'TLDDP')) || d.bcType === 'BC41';
    const months = Array.from({ length: 12 }, (_, m) => ({ month: m + 1, realisation: 0, domestic: 0 }));
    let last = 0;
    let thisYear = 0;
    let used = 0;
    for (const d of docs) {
      const y = d.registrationDate!.getUTCFullYear();
      const v = n(d.totalValueIdr);
      if (y === year - 1) {
        if (realisation(d)) last += v;
        continue;
      }
      const m = months[d.registrationDate!.getUTCMonth()];
      if (realisation(d)) {
        thisYear += v;
        m.realisation += v;
      }
      if (domestic(d)) {
        used += v;
        m.domestic += v;
      }
    }
    return { year, pct, ...domesticQuota(pct, last, thisYear, used), lastYearRealisation: Math.round(last), thisYearRealisation: Math.round(thisYear), months: months.map((m) => ({ ...m, realisation: Math.round(m.realisation), domestic: Math.round(m.domestic) })) };
  }

  // ------------------------------------------------------------------ KITE
  /** KITE imports still open (period end, report due 60 days later) and the exports / BC 2.4 to charge them to */
  async kite() {
    RequestCtx.assert('bonded.read');
    const companyId = RequestCtx.companyId();
    const [imports, outs] = await Promise.all([
      this.prisma.customsDocument.findMany({ where: { companyId, facility: 'KITE', direction: 'IN', status: 'REGISTERED' }, orderBy: { registrationDate: 'asc' }, include: { lines: { orderBy: { lineNo: 'asc' } } } }),
      this.prisma.customsDocument.findMany({ where: { companyId, facility: 'KITE', direction: 'OUT', bcType: { in: ['BC30', 'BC24', 'BC27', 'BC25'] }, status: 'REGISTERED' }, orderBy: { registrationDate: 'desc' }, take: 200, include: { lines: true } }),
    ]);
    const settledDocs = new Set((await this.prisma.customsAllocation.findMany({ where: { kind: 'KITE', targetDocId: { in: outs.map((o) => o.id) } }, select: { targetDocId: true }, distinct: ['targetDocId'] })).map((a) => a.targetDocId));
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: [...imports, ...outs].flatMap((d) => d.lines.map((l) => l.productId)) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    const today = new Date();
    return {
      imports: imports.map((d) => {
        const qty = d.lines.reduce((a, l) => a + n(l.qty), 0);
        const settled = d.lines.reduce((a, l) => a + n(l.settledQty), 0);
        const reportDue = d.kiteDueDate ? addDays(d.kiteDueDate, 60) : null;
        const daysLeft = d.kiteDueDate ? Math.ceil((d.kiteDueDate.getTime() - today.getTime()) / DAY) : null;
        return {
          id: d.id,
          number: d.number,
          bcType: d.bcType,
          ajuNo: d.ajuNo,
          registrationNo: d.registrationNo,
          registrationDate: iso(d.registrationDate),
          partner: d.partnerName,
          kiteDueDate: iso(d.kiteDueDate),
          reportDue: iso(reportDue),
          daysLeft,
          state: settled >= qty - 1e-6 ? 'SETTLED' : daysLeft === null ? 'OPEN' : daysLeft < 0 ? 'OVERDUE' : daysLeft <= 30 ? 'DUE_SOON' : 'OPEN',
          lines: d.lines.map((l) => ({ id: l.id, lineNo: l.lineNo, code: products.get(l.productId)?.code, name: products.get(l.productId)?.name, uom: l.uom, qty: n(l.qty), settled: n(l.settledQty), open: r4(n(l.qty) - n(l.settledQty)), valueIdr: n(l.valueIdr) })),
        };
      }),
      exports: outs.map((d) => ({ id: d.id, number: d.number, bcType: d.bcType, registrationNo: d.registrationNo, registrationDate: iso(d.registrationDate), partner: d.partnerName, settled: settledDocs.has(d.id), lines: d.lines.map((l) => ({ code: products.get(l.productId)?.code, name: products.get(l.productId)?.name, uom: l.uom, qty: n(l.qty) })) })),
    };
  }

  /**
   * Charge an export (BC 3.0 / 2.7 / 2.5 of finished goods: materials by the default BOM, conversion incl. its loss %) or a
   * BC 2.4 (the materials themselves) to the open KITE imports, oldest registration first (PMK 149/2022 Art. 17, 28).
   */
  async kiteSettle(id: string) {
    RequestCtx.assert('bonded.kite');
    const u = RequestCtx.user();
    const d = await this.prisma.customsDocument.findFirst({ where: { id, companyId: u.companyId }, include: { lines: true } });
    if (!d) throw new NotFoundException('Customs document not found');
    if (d.facility !== 'KITE' || d.direction !== 'OUT' || d.status !== 'REGISTERED') throw new ConflictException('Only a registered KITE export or BC 2.4 is charged to the imports');
    if (await this.prisma.customsAllocation.findFirst({ where: { targetDocId: id, kind: 'KITE' } })) throw new ConflictException('Already charged: release it first');
    const imports = await this.prisma.customsDocumentLine.findMany({ where: { document: { companyId: u.companyId, facility: 'KITE', direction: 'IN', status: 'REGISTERED', registrationDate: { lte: d.registrationDate! } } }, select: { id: true, productId: true, qty: true, settledQty: true, document: { select: { registrationDate: true, registrationNo: true } } } });
    const lots: ImportLot[] = imports.map((l) => ({ lineId: l.id, productId: l.productId, date: `${iso(l.document.registrationDate)}|${l.document.registrationNo}`, remaining: r4(n(l.qty) - n(l.settledQty)) }));
    const plan: { lineId: string; qty: number; productId: string; targetLineId: string }[] = [];
    const missing: string[] = [];
    let unallocated = 0;
    for (const l of d.lines) {
      let needs: { productId: string; qty: number }[];
      if (d.bcType === 'BC24') needs = [{ productId: l.productId, qty: n(l.qty) }];
      else {
        const bom = await this.prisma.bom.findFirst({ where: { companyId: u.companyId, productId: l.productId, isActive: true, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }], include: { lines: true } });
        if (!bom) {
          missing.push(l.productId);
          continue;
        }
        needs = conversion(n(l.qty), { outputQty: n(bom.outputQty), lines: bom.lines.map((b) => ({ productId: b.productId, qty: n(b.qty), scrapPct: n(b.scrapPct) })) });
      }
      for (const need of needs) {
        const r = allocateFifo(lots, need.productId, need.qty);
        unallocated += lots.some((x) => x.productId === need.productId) ? r.unallocated : 0;
        for (const a of r.allocations) plan.push({ ...a, productId: need.productId, targetLineId: l.id });
      }
    }
    if (missing.length) {
      const p = await this.prisma.product.findMany({ where: { id: { in: missing } }, select: { code: true } });
      throw new ConflictException(`No bill of materials (conversion) for ${p.map((x) => x.code).join(', ')}: set it up in Manufacturing first`);
    }
    if (!plan.length) throw new ConflictException('None of its materials came in under KITE before this document');
    await this.prisma.$transaction(async (tx) => {
      for (const a of plan) {
        await tx.customsAllocation.create({ data: { companyId: u.companyId, kind: 'KITE', sourceLineId: a.lineId, targetDocId: id, targetLineId: a.targetLineId, productId: a.productId, qty: D(a.qty) } });
        await tx.customsDocumentLine.update({ where: { id: a.lineId }, data: { settledQty: { increment: D(a.qty) } } });
      }
    });
    await this.audit.record('Customs Document', id, 'KITE_SETTLE', null, { allocations: plan.length, unallocated });
    return { allocations: plan.length, unallocated: r4(unallocated), document: await this.document(id) };
  }

  async kiteRelease(id: string) {
    RequestCtx.assert('bonded.kite');
    const d = await this.prisma.customsDocument.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!d) throw new NotFoundException('Customs document not found');
    const count = await this.prisma.$transaction((tx) => this.releaseAllocations(tx, id));
    if (!count) throw new ConflictException('Nothing charged to the imports');
    await this.audit.record('Customs Document', id, 'KITE_RELEASE', null, { allocations: count });
    return this.document(id);
  }

  /**
   * BCL.KT01 accountability data (PER-8/BC/2022 Lampiran IX): finished goods exported (PEB), raw materials used per
   * import (PIB) with the waste %, and the settled CIF / duties in proportion to the quantity used.
   */
  async bclkt01(from: string, to: string) {
    RequestCtx.assert('bonded.read');
    const { f, t } = this.range(from, to);
    const companyId = RequestCtx.companyId();
    const outs = await this.prisma.customsDocument.findMany({ where: { companyId, facility: 'KITE', direction: 'OUT', status: 'REGISTERED', registrationDate: { gte: f, lte: t } }, orderBy: { registrationDate: 'asc' }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    const allocs = await this.prisma.customsAllocation.findMany({ where: { kind: 'KITE', targetDocId: { in: outs.map((o) => o.id) } } });
    const settled = new Set(allocs.map((a) => a.targetDocId));
    const srcLines = await this.prisma.customsDocumentLine.findMany({ where: { id: { in: allocs.map((a) => a.sourceLineId) } }, include: { document: { select: { id: true, ajuNo: true, registrationNo: true, registrationDate: true, officeCode: true, totalValueIdr: true, bm: true, ppn: true, ppnbm: true } } } });
    const src = new Map(srcLines.map((l) => [l.id, l]));
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: [...outs.flatMap((o) => o.lines.map((l) => l.productId)), ...srcLines.map((l) => l.productId)] } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    const finished = outs
      .filter((o) => settled.has(o.id))
      .flatMap((o) => o.lines.map((l) => ({ bcType: o.bcType, ajuNo: o.ajuNo, registrationNo: o.registrationNo, registrationDate: iso(o.registrationDate), officeCode: o.officeCode, lineNo: l.lineNo, code: products.get(l.productId)?.code, name: products.get(l.productId)?.name, uom: l.uom, qty: n(l.qty), valueIdr: n(l.valueIdr) })));
    const used = new Map<string, number>();
    for (const a of allocs) used.set(a.sourceLineId, (used.get(a.sourceLineId) ?? 0) + n(a.qty));
    const totals = { cif: 0, bm: 0, ppn: 0, ppnbm: 0 };
    const raw = [...used.entries()]
      .map(([lineId, qty]) => {
        const l = src.get(lineId)!;
        const lineShare = n(l.qty) > 0 ? qty / n(l.qty) : 0;
        const docShare = n(l.document.totalValueIdr) > 0 ? n(l.valueIdr) / n(l.document.totalValueIdr) : 0;
        const cif = r2(n(l.valueIdr) * lineShare);
        const bm = r2(n(l.document.bm) * docShare * lineShare);
        const ppn = r2(n(l.document.ppn) * docShare * lineShare);
        const ppnbm = r2(n(l.document.ppnbm) * docShare * lineShare);
        totals.cif += cif;
        totals.bm += bm;
        totals.ppn += ppn;
        totals.ppnbm += ppnbm;
        return { ajuNo: l.document.ajuNo, registrationNo: l.document.registrationNo, registrationDate: iso(l.document.registrationDate), officeCode: l.document.officeCode, lineNo: l.lineNo, code: products.get(l.productId)?.code, name: products.get(l.productId)?.name, uom: l.uom, qty: r4(qty), wastePct: l.wastePct === null ? null : n(l.wastePct), cif, bm, ppn, ppnbm };
      })
      .sort((a, b) => (a.registrationDate ?? '').localeCompare(b.registrationDate ?? '') || a.lineNo - b.lineNo);
    return {
      from,
      to,
      header: { pibCount: new Set(srcLines.map((l) => l.document.id)).size, pebCount: settled.size, rawQty: r4(raw.reduce((a, r) => a + r.qty, 0)), finishedQty: r4(finished.reduce((a, r) => a + r.qty, 0)) },
      finished,
      raw,
      totals: { cif: r2(totals.cif), bm: r2(totals.bm), ppn: r2(totals.ppn), ppnbm: r2(totals.ppnbm) },
      unsettled: outs.filter((o) => !settled.has(o.id)).map((o) => ({ id: o.id, number: o.number, bcType: o.bcType, registrationNo: o.registrationNo })),
    };
  }
}
