import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, sum } from '../../common/utils/money';
import { JournalService } from '../accounting/journal.service';
import { DocumentService } from '../documents/document.service';

const OPENING_SOURCE = 'OPENING';
/** posting keys whose accounts get their opening balance from documents (invoices, bills, stock), not from the grid */
const DOC_DRIVEN_KEYS = ['AR', 'AP', 'INVENTORY'];
/** accounts nobody may type an opening balance on */
const LOCKED_KEYS = ['OPENING_EQUITY', 'CURRENT_EARNINGS'];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const balancesSchema = z.object({
  date: isoDate,
  lines: z
    .array(
      z.object({
        accountId: z.uuid(),
        debit: z.coerce.number().min(0).max(1e14).default(0),
        credit: z.coerce.number().min(0).max(1e14).default(0),
      }),
    )
    .max(2000),
});

export const invoiceRowSchema = z.object({
  /** customer / supplier id, or its code or exact name (CSV import) */
  partner: z.string().trim().min(1, 'Customer / supplier is required').max(200),
  reference: z.string().trim().min(1, 'Invoice number is required').max(100),
  date: isoDate,
  dueDate: z.preprocess((v) => (v === '' ? null : v), isoDate.nullable().optional()),
  amount: z.coerce.number().positive('Amount must be greater than zero').max(1e14),
  taxInvoiceNumber: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(40).nullable().optional()),
  notes: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(1000).nullable().optional()),
});
export const invoicesSchema = z.object({ kind: z.enum(['SI', 'PI']), rows: z.array(z.unknown()).min(1).max(2000) });

export const stockSchema = z.object({
  date: isoDate,
  warehouseId: z.uuid(),
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        qty: z.coerce.number().positive('Quantity must be greater than zero').max(1e12),
        unitCost: z.coerce.number().min(0).max(1e14),
      }),
    )
    .min(1, 'Add at least one product')
    .max(1000),
});

/**
 * Go-live: brings the closing position of the previous system into KCS ERP.
 *  - account balances  -> one journal (source OPENING) balanced against Opening Balance Equity
 *  - open invoices / bills -> confirmed SI / PI flagged isOpening (Dr AR or Cr AP against the same equity account)
 *  - stock on hand -> ADJ flagged isOpening (stock in at cost, Dr Inventory)
 * When everything is entered, Opening Balance Equity holds the owners' equity of the previous system.
 */
@Injectable()
export class OpeningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journal: JournalService,
    private readonly documents: DocumentService,
  ) {}

  private async mappings(companyId: string) {
    const rows = await this.prisma.accountMapping.findMany({ where: { companyId, key: { in: [...DOC_DRIVEN_KEYS, ...LOCKED_KEYS] } }, select: { key: true, accountId: true } });
    return new Map(rows.map((r) => [r.key, r.accountId]));
  }

  private currentJournal(companyId: string) {
    return this.prisma.journalEntry.findFirst({
      where: { companyId, sourceType: OPENING_SOURCE, sourceId: companyId, status: 'POSTED', deletedAt: null },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async overview() {
    RequestCtx.assert('accounting.opening.read');
    const companyId = RequestCtx.companyId();
    const map = await this.mappings(companyId);
    const docDriven = DOC_DRIVEN_KEYS.map((k) => map.get(k)).filter(Boolean) as string[];
    const locked = LOCKED_KEYS.map((k) => map.get(k)).filter(Boolean) as string[];
    const [accounts, journal, docs] = await Promise.all([
      this.prisma.account.findMany({ where: { companyId, isGroup: false, deletedAt: null }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, type: true, isActive: true } }),
      this.currentJournal(companyId),
      this.prisma.tradeDocument.groupBy({ by: ['docType'], where: { companyId, isOpening: true, deletedAt: null, status: { not: 'CANCELLED' } }, _sum: { grandTotal: true }, _count: { _all: true } }),
    ]);
    const amounts = new Map((journal?.lines ?? []).map((l) => [l.accountId, { debit: Number(l.debit), credit: Number(l.credit) }]));
    const equityId = map.get('OPENING_EQUITY') ?? null;
    let equity = 0;
    if (equityId) {
      const agg = await this.prisma.journalLine.aggregate({ where: { accountId: equityId, entry: { companyId, status: 'POSTED', deletedAt: null } }, _sum: { debit: true, credit: true } });
      equity = Number(agg._sum.credit ?? 0) - Number(agg._sum.debit ?? 0);
    }
    const docSum = (t: string) => {
      const g = docs.find((d) => d.docType === t);
      return { count: g?._count._all ?? 0, total: Number(g?._sum.grandTotal ?? 0) };
    };
    // stock value of opening adjustments (posted cost), invoices in base currency
    const stockValue = await this.prisma.$queryRaw<{ v: Prisma.Decimal | null }[]>`
      SELECT SUM(l.qty * l."unitCost") AS v FROM trade_document_lines l JOIN trade_documents d ON d.id = l."documentId"
      WHERE d."companyId" = ${companyId}::uuid AND d."isOpening" AND d."docType" = 'ADJ' AND d.status <> 'CANCELLED' AND d."deletedAt" IS NULL`;
    const goLive = journal?.date ?? null;
    let earlier = 0;
    if (goLive) {
      const [{ c }] = await this.prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::bigint AS c FROM journal_entries e
        WHERE e."companyId" = ${companyId}::uuid AND e.status = 'POSTED' AND e."deletedAt" IS NULL AND e.date < ${goLive}
          AND COALESCE(e."sourceType", '') NOT IN ('OPENING', 'CLOSING')
          AND NOT EXISTS (SELECT 1 FROM trade_documents d WHERE d.id = e."sourceId" AND d."isOpening")`;
      earlier = Number(c);
    }
    return {
      goLiveDate: goLive,
      journal: journal ? { id: journal.id, number: journal.number, date: journal.date, totalDebit: journal.totalDebit, totalCredit: journal.totalCredit } : null,
      accounts: accounts
        .filter((a) => !docDriven.includes(a.id) && !locked.includes(a.id))
        .map((a) => ({ ...a, debit: amounts.get(a.id)?.debit ?? 0, credit: amounts.get(a.id)?.credit ?? 0 })),
      excluded: accounts.filter((a) => docDriven.includes(a.id) || locked.includes(a.id)).map((a) => ({ id: a.id, code: a.code, name: a.name, reason: locked.includes(a.id) ? 'system' : 'documents' })),
      openingEquity: { accountId: equityId, balance: equity },
      receivables: docSum('SI'),
      payables: docSum('PI'),
      stock: { count: docSum('ADJ').count, value: Number(stockValue[0]?.v ?? 0) },
      /** posted transactions dated before the go-live date (other than opening entries): usually a wrong go-live date */
      transactionsBeforeGoLive: earlier,
      configured: !!equityId,
    };
  }

  /** Replaces the opening journal of account balances (void + post) */
  async postBalances(body: unknown) {
    RequestCtx.assert('accounting.opening.manage');
    const input = balancesSchema.parse(body);
    const u = RequestCtx.user();
    const companyId = u.companyId;
    const map = await this.mappings(companyId);
    if (!map.get('OPENING_EQUITY')) throw new BadRequestException('Posting account "OPENING_EQUITY" is not configured. Set it in Accounting > Posting Accounts.');
    const forbidden = new Set([...DOC_DRIVEN_KEYS, ...LOCKED_KEYS].map((k) => map.get(k)).filter(Boolean) as string[]);
    const lines = input.lines.filter((l) => l.debit > 0 || l.credit > 0);
    for (const l of lines) if (l.debit > 0 && l.credit > 0) throw new BadRequestException('Enter either a debit or a credit per account, not both');
    const ids = [...new Set(lines.map((l) => l.accountId))];
    if (ids.length !== lines.length) throw new BadRequestException('Each account can appear only once');
    const accounts = await this.prisma.account.findMany({ where: { id: { in: ids }, companyId, isGroup: false, deletedAt: null }, select: { id: true, code: true } });
    if (accounts.length !== ids.length) throw new BadRequestException('Invalid or header account selected');
    const bad = accounts.find((a) => forbidden.has(a.id));
    if (bad) throw new BadRequestException(`Account ${bad.code} gets its opening balance from open invoices, bills or stock (or is a system account)`);
    const date = new Date(input.date);
    const debit = round(sum(lines.map((l) => D(l.debit))));
    const credit = round(sum(lines.map((l) => D(l.credit))));
    const diff = debit.minus(credit);

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.journalEntry.findFirst({ where: { companyId, sourceType: OPENING_SOURCE, sourceId: companyId, status: 'POSTED' } });
      await this.journal.voidBySource(tx, OPENING_SOURCE, companyId);
      let entry = null;
      if (lines.length) {
        entry = await this.journal.post(tx, {
          companyId,
          branchId: u.branchId,
          date,
          description: 'Opening balances (go-live)',
          reference: 'Opening balances',
          sourceType: OPENING_SOURCE,
          sourceId: companyId,
          lines: [
            ...lines.map((l) => ({ accountId: l.accountId, debit: D(l.debit), credit: D(l.credit), description: 'Opening balance' })),
            ...(diff.isZero() ? [] : [{ key: 'OPENING_EQUITY', debit: diff.lt(0) ? diff.abs() : undefined, credit: diff.gt(0) ? diff : undefined, description: 'Opening balance equity' }]),
          ],
        });
      }
      await this.audit.record('Opening Balances', companyId, before ? 'REPLACE' : 'CREATE', before ? { journal: before.number, date: before.date } : undefined, { journal: entry?.number ?? null, date: input.date, accounts: lines.length, debit: debit.toString(), credit: credit.toString() }, tx);
      return { journal: entry ? { id: entry.id, number: entry.number } : null };
    });
  }

  async voidBalances() {
    RequestCtx.assert('accounting.opening.manage');
    const companyId = RequestCtx.companyId();
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.journalEntry.findFirst({ where: { companyId, sourceType: OPENING_SOURCE, sourceId: companyId, status: 'POSTED' } });
      if (!before) throw new ConflictException('There are no opening account balances to remove');
      await this.journal.voidBySource(tx, OPENING_SOURCE, companyId);
      await this.audit.record('Opening Balances', companyId, 'VOID', { journal: before.number }, undefined, tx);
      return { success: true };
    });
  }

  // ---------------------------------------------------------------- open invoices / bills
  async listInvoices(kind: 'SI' | 'PI') {
    RequestCtx.assert('accounting.opening.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.tradeDocument.findMany({ where: { companyId, docType: kind, isOpening: true, deletedAt: null }, orderBy: [{ date: 'asc' }, { number: 'asc' }] });
    const ids = rows.map((r) => (kind === 'SI' ? r.customerId : r.supplierId)).filter(Boolean) as string[];
    const partners = kind === 'SI' ? await this.prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } }) : await this.prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } });
    const pm = new Map(partners.map((p) => [p.id, p]));
    return rows.map((r) => {
      const p = pm.get((kind === 'SI' ? r.customerId : r.supplierId) ?? '');
      return { id: r.id, number: r.number, reference: r.reference, date: r.date, dueDate: r.dueDate, status: r.status, partnerName: p?.name ?? null, partnerCode: p?.code ?? null, taxInvoiceNumber: r.taxInvoiceNumber, total: r.grandTotal, paid: r.paidAmount, balance: D(r.grandTotal).minus(D(r.paidAmount)) };
    });
  }

  private async findPartner(kind: 'SI' | 'PI', key: string) {
    const companyId = RequestCtx.companyId();
    const where = { companyId, deletedAt: null };
    const or = [{ code: { equals: key, mode: 'insensitive' as const } }, { name: { equals: key, mode: 'insensitive' as const } }, ...(/^[0-9a-f-]{36}$/i.test(key) ? [{ id: key }] : [])];
    const found = kind === 'SI' ? await this.prisma.customer.findMany({ where: { ...where, OR: or }, select: { id: true }, take: 2 }) : await this.prisma.supplier.findMany({ where: { ...where, OR: or }, select: { id: true }, take: 2 });
    if (found.length !== 1) throw new BadRequestException(found.length ? `"${key}" matches more than one ${kind === 'SI' ? 'customer' : 'supplier'} - use the code` : `${kind === 'SI' ? 'Customer' : 'Supplier'} "${key}" not found`);
    return found[0].id;
  }

  /** Creates confirmed opening invoices / bills; every row is validated on its own and reported back */
  async createInvoices(body: unknown) {
    RequestCtx.assert('accounting.opening.manage');
    const { kind, rows } = invoicesSchema.parse(body);
    const created: { row: number; number: string; id: string }[] = [];
    const errors: { row: number; message: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      try {
        const r = invoiceRowSchema.parse(rows[i]);
        const partnerId = await this.findPartner(kind, r.partner);
        const dup = await this.prisma.tradeDocument.findFirst({
          where: { companyId: RequestCtx.companyId(), docType: kind, isOpening: true, deletedAt: null, status: { not: 'CANCELLED' }, reference: r.reference, ...(kind === 'SI' ? { customerId: partnerId } : { supplierId: partnerId }) },
          select: { number: true },
        });
        if (dup) throw new BadRequestException(`Invoice ${r.reference} is already entered (${dup.number})`);
        const doc = await this.documents.create(
          kind,
          {
            date: r.date,
            dueDate: r.dueDate ?? undefined,
            ...(kind === 'SI' ? { customerId: partnerId } : { supplierId: partnerId }),
            reference: r.reference,
            notes: r.notes ?? undefined,
            taxInvoiceNumber: r.taxInvoiceNumber ?? undefined,
            lines: [{ description: `Opening balance - ${r.reference}`, qty: 1, unitPrice: r.amount }],
          },
          undefined,
          { opening: true, skipPermission: true },
        );
        try {
          await this.documents.confirm(kind, doc.id, { skipPermission: true });
        } catch (e) {
          await this.prisma.tradeDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
          throw e;
        }
        created.push({ row: i + 1, number: doc.number, id: doc.id });
      } catch (e) {
        errors.push({ row: i + 1, message: this.message(e) });
      }
    }
    return { created, errors };
  }

  private message(e: unknown): string {
    if (e instanceof z.ZodError) return e.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`).join('; ');
    const r = (e as { getResponse?: () => unknown })?.getResponse?.();
    if (r && typeof r === 'object') {
      const o = r as { message?: unknown; errors?: Record<string, string> };
      if (o.errors) return Object.entries(o.errors).map(([k, v]) => `${k}: ${v}`).join('; ');
      if (typeof o.message === 'string') return o.message;
    }
    return (e as Error)?.message ?? 'Invalid row';
  }

  /** Cancels an opening invoice / bill / stock entry (only while nothing was paid against it) */
  async cancel(type: 'SI' | 'PI' | 'ADJ', id: string) {
    RequestCtx.assert('accounting.opening.manage');
    const doc = await this.prisma.tradeDocument.findFirst({ where: { id, companyId: RequestCtx.companyId(), docType: type, isOpening: true, deletedAt: null } });
    if (!doc) throw new BadRequestException('Opening entry not found');
    return this.documents.cancel(type, id, { skipPermission: true });
  }

  // ---------------------------------------------------------------- opening stock
  async listStock() {
    RequestCtx.assert('accounting.opening.read');
    const companyId = RequestCtx.companyId();
    const docs = await this.prisma.tradeDocument.findMany({ where: { companyId, docType: 'ADJ', isOpening: true, deletedAt: null }, include: { lines: { orderBy: { lineNo: 'asc' } } }, orderBy: { date: 'asc' } });
    const [products, warehouses] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: docs.flatMap((d) => d.lines.map((l) => l.productId)).filter(Boolean) as string[] } }, select: { id: true, code: true, name: true } }),
      this.prisma.warehouse.findMany({ where: { id: { in: docs.map((d) => d.warehouseId).filter(Boolean) as string[] } }, select: { id: true, name: true } }),
    ]);
    const pm = new Map(products.map((p) => [p.id, p]));
    const wm = new Map(warehouses.map((w) => [w.id, w.name]));
    return docs.map((d) => ({
      id: d.id,
      number: d.number,
      date: d.date,
      status: d.status,
      warehouseName: d.warehouseId ? wm.get(d.warehouseId) ?? null : null,
      value: round(sum(d.lines.map((l) => D(l.qty).times(D(l.unitCost ?? l.unitPrice))))),
      lines: d.lines.map((l) => ({ productCode: l.productId ? pm.get(l.productId)?.code : null, productName: l.productId ? pm.get(l.productId)?.name : l.description, qty: l.qty, unitCost: l.unitCost ?? l.unitPrice })),
    }));
  }

  async createStock(body: unknown) {
    RequestCtx.assert('accounting.opening.manage');
    const input = stockSchema.parse(body);
    const dupe = new Set<string>();
    for (const l of input.lines) {
      if (dupe.has(l.productId)) throw new BadRequestException('Each product can appear only once per entry');
      dupe.add(l.productId);
    }
    const doc = await this.documents.create(
      'ADJ',
      { date: input.date, warehouseId: input.warehouseId, reference: 'Opening stock', lines: input.lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitCost })) },
      undefined,
      { opening: true, skipPermission: true },
    );
    try {
      await this.documents.confirm('ADJ', doc.id, { skipPermission: true });
    } catch (e) {
      // keep nothing half done: an unconfirmed opening entry is removed again
      await this.prisma.tradeDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
      throw e;
    }
    return { id: doc.id, number: doc.number };
  }
}
