import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, sum, ZERO } from '../../common/utils/money';
import { paged } from '../../common/utils/query';

export interface PostingLine {
  /** functional key resolved via account_mappings (AR, SALES, ...) */
  key?: string;
  accountId?: string | null;
  debit?: Prisma.Decimal;
  credit?: Prisma.Decimal;
  description?: string;
  customerId?: string | null;
  supplierId?: string | null;
  projectId?: string | null;
  costCenterId?: string | null;
}

export interface PostingRequest {
  companyId: string;
  branchId?: string | null;
  date: Date;
  description: string;
  reference?: string;
  sourceType: string;
  sourceId?: string;
  lines: PostingLine[];
}

@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  async mapping(tx: Tx, companyId: string, key: string): Promise<string> {
    const m = await tx.accountMapping.findUnique({ where: { companyId_key: { companyId, key } } });
    if (!m?.accountId) throw new BadRequestException(`Posting account "${key}" is not configured. Set it in Accounting > Posting Accounts.`);
    return m.accountId;
  }

  async assertOpenPeriod(tx: Tx, companyId: string, date: Date) {
    const closed = await tx.fiscalPeriod.findFirst({ where: { companyId, isClosed: true, deletedAt: null, startDate: { lte: date }, endDate: { gte: date } } });
    if (closed) throw new ConflictException(`Fiscal period ${closed.name} is closed`);
  }

  /** Creates a POSTED, balanced journal. Lines with the same account/party are merged. */
  async post(tx: Tx, req: PostingRequest) {
    await this.assertOpenPeriod(tx, req.companyId, req.date);
    const resolved: (PostingLine & { accountId: string })[] = [];
    for (const l of req.lines) {
      const debit = round(D(l.debit));
      const credit = round(D(l.credit));
      if (debit.isZero() && credit.isZero()) continue;
      const accountId = l.accountId || (l.key ? await this.mapping(tx, req.companyId, l.key) : null);
      if (!accountId) throw new BadRequestException('Journal line without account');
      resolved.push({ ...l, accountId, debit, credit });
    }
    // merge identical buckets and net debit/credit per bucket
    const buckets = new Map<string, PostingLine & { accountId: string }>();
    for (const l of resolved) {
      const k = [l.accountId, l.customerId, l.supplierId, l.projectId, l.costCenterId].join('|');
      const b = buckets.get(k);
      if (b) {
        b.debit = D(b.debit).plus(D(l.debit));
        b.credit = D(b.credit).plus(D(l.credit));
      } else buckets.set(k, { ...l });
    }
    const lines = [...buckets.values()]
      .map((l) => {
        const net = D(l.debit).minus(D(l.credit));
        return { ...l, debit: net.gt(0) ? net : ZERO, credit: net.lt(0) ? net.abs() : ZERO };
      })
      .filter((l) => !l.debit.isZero() || !l.credit.isZero());

    const totalDebit = sum(lines.map((l) => l.debit));
    const totalCredit = sum(lines.map((l) => l.credit));
    if (!totalDebit.equals(totalCredit)) throw new BadRequestException(`Journal is not balanced (debit ${totalDebit} / credit ${totalCredit})`);
    if (!lines.length) return null;

    const number = await this.sequence.next('JE', req.companyId, req.date, tx);
    const entry = await tx.journalEntry.create({
      data: {
        companyId: req.companyId,
        branchId: req.branchId ?? null,
        number,
        date: req.date,
        description: req.description.slice(0, 500),
        reference: req.reference,
        sourceType: req.sourceType,
        sourceId: req.sourceId,
        status: 'POSTED',
        postedAt: new Date(),
        totalDebit,
        totalCredit,
        createdById: RequestCtx.get()?.user?.id,
        lines: {
          create: lines.map((l, i) => ({
            lineNo: i + 1,
            accountId: l.accountId,
            description: l.description?.slice(0, 500),
            debit: l.debit,
            credit: l.credit,
            customerId: l.customerId ?? null,
            supplierId: l.supplierId ?? null,
            projectId: l.projectId ?? null,
            costCenterId: l.costCenterId ?? null,
          })),
        },
      },
    });
    return entry;
  }

  /** Voids every posted journal created from a source document */
  async voidBySource(tx: Tx, sourceType: string, sourceId: string) {
    const entries = await tx.journalEntry.findMany({ where: { sourceType, sourceId, status: 'POSTED' } });
    for (const e of entries) {
      await this.assertOpenPeriod(tx, e.companyId, e.date);
      await tx.journalEntry.update({ where: { id: e.id }, data: { status: 'VOID', updatedById: RequestCtx.get()?.user?.id } });
    }
  }

  // ------------------------------------------------------------- manual journals (UI)
  async list(q: { page: number; pageSize: number; search?: string; status?: string; from?: string; to?: string; sourceType?: string }) {
    RequestCtx.assert('accounting.journal.read');
    const where: Prisma.JournalEntryWhereInput = { ...(this.access.scopeWhere({ branchField: 'branchId' }) as any), deletedAt: null };
    if (q.search) where.OR = [{ number: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }];
    if (q.status) where.status = q.status as any;
    if (q.sourceType) where.sourceType = q.sourceType;
    if (q.from || q.to) where.date = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.journalEntry.findMany({ where, orderBy: [{ date: 'desc' }, { number: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.journalEntry.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  async get(id: string) {
    RequestCtx.assert('accounting.journal.read');
    const e = await this.prisma.journalEntry.findFirst({
      where: { id, ...(this.access.scopeWhere({ branchField: 'branchId' }) as any) },
      include: { lines: { orderBy: { lineNo: 'asc' }, include: { account: { select: { code: true, name: true } } } } },
    });
    if (!e) throw new NotFoundException('Journal not found');
    return e;
  }

  async createManual(body: { date: Date; description: string; reference?: string | null; post: boolean; lines: { accountId: string; debit: number; credit: number; description?: string | null; costCenterId?: string | null; projectId?: string | null }[] }) {
    RequestCtx.assert(body.post ? 'accounting.journal.post' : 'accounting.journal.create');
    const u = RequestCtx.user();
    const accounts = await this.prisma.account.findMany({ where: { id: { in: body.lines.map((l) => l.accountId) }, companyId: u.companyId, isGroup: false, deletedAt: null } });
    if (accounts.length !== new Set(body.lines.map((l) => l.accountId)).size) throw new BadRequestException('Invalid or header account selected');
    const totalDebit = round(sum(body.lines.map((l) => D(l.debit))));
    const totalCredit = round(sum(body.lines.map((l) => D(l.credit))));
    if (!totalDebit.equals(totalCredit) || totalDebit.isZero()) throw new BadRequestException('Journal must be balanced and non-zero');
    return this.prisma.$transaction(async (tx) => {
      await this.assertOpenPeriod(tx, u.companyId, body.date);
      const e = await tx.journalEntry.create({
        data: {
          companyId: u.companyId,
          branchId: u.branchId,
          number: await this.sequence.next('JE', u.companyId, body.date, tx),
          date: body.date,
          description: body.description,
          reference: body.reference,
          sourceType: 'MANUAL',
          status: body.post ? 'POSTED' : 'DRAFT',
          postedAt: body.post ? new Date() : null,
          totalDebit,
          totalCredit,
          createdById: u.id,
          lines: { create: body.lines.map((l, i) => ({ lineNo: i + 1, accountId: l.accountId, debit: D(l.debit), credit: D(l.credit), description: l.description, costCenterId: l.costCenterId, projectId: l.projectId })) },
        },
      });
      await this.audit.record('JournalEntry', e.id, 'CREATE', undefined, e, tx);
      return e;
    });
  }

  async postDraft(id: string) {
    RequestCtx.assert('accounting.journal.post');
    const e = await this.get(id);
    if (e.status !== 'DRAFT') throw new ConflictException('Only draft journals can be posted');
    return this.prisma.$transaction(async (tx) => {
      await this.assertOpenPeriod(tx, e.companyId, e.date);
      const r = await tx.journalEntry.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date(), updatedById: RequestCtx.user().id } });
      await this.audit.record('JournalEntry', id, 'POST', e, r, tx);
      return r;
    });
  }

  async voidManual(id: string) {
    RequestCtx.assert('accounting.journal.void');
    const e = await this.get(id);
    if (e.sourceType !== 'MANUAL') throw new ConflictException('System journals are voided by cancelling their source document');
    if (e.status === 'VOID') throw new ConflictException('Journal is already void');
    return this.prisma.$transaction(async (tx) => {
      await this.assertOpenPeriod(tx, e.companyId, e.date);
      const r = await tx.journalEntry.update({ where: { id }, data: { status: 'VOID', updatedById: RequestCtx.user().id } });
      await this.audit.record('JournalEntry', id, 'VOID', e, r, tx);
      return r;
    });
  }
}
