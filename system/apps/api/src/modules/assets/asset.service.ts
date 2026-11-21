import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, ZERO } from '../../common/utils/money';
import { paged } from '../../common/utils/query';
import { JournalService } from '../accounting/journal.service';
import { assertLookup, assertOwned, assertPostingAccount, isoOf, isUuid, PERIOD_RE, periodEnd, periodFromIndex, periodIndex, periodOf, todayIso } from '../billing/job-context';

const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());

export const assetSchema = z
  .object({
    code: optText(30),
    name: z.string().trim().min(1, 'Name is required').max(200),
    categoryCode: optText(50),
    serialNumber: optText(100),
    location: optText(150),
    custodianEmployeeId: optUuid,
    supplierId: optUuid,
    acquisitionDate: z.coerce.date(),
    depreciationStartDate: z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional()),
    cost: z.coerce.number().positive('Cost must be greater than zero').max(1e14),
    salvageValue: z.coerce.number().min(0).max(1e14).default(0),
    usefulLifeMonths: z.coerce.number().int().min(1, 'Useful life is required').max(600),
    methodCode: z.string().trim().min(1).max(30).default('STRAIGHT_LINE'),
    /** fiscal depreciation group (PMK 72/2023): K1..K4, BP, BNP, NONE */
    taxGroupCode: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(20).nullable().optional()),
    assetAccountId: optUuid,
    accumDepAccountId: optUuid,
    depExpenseAccountId: optUuid,
    /** existing asset: depreciation already booked before it was registered here (no journal) */
    openingAccumulated: z.coerce.number().min(0).max(1e14).default(0),
    /** post the purchase: Dr fixed asset / Cr this account (bank, payable, opening equity ...) */
    acquisitionCreditAccountId: optUuid,
    notes: optText(4000),
  })
  .superRefine((v, ctx) => {
    if (v.salvageValue >= v.cost)
      ctx.addIssue({
        code: 'custom',
        path: ['salvageValue'],
        message: 'Salvage value must be lower than the cost',
      });
    if (v.openingAccumulated > v.cost - v.salvageValue)
      ctx.addIssue({
        code: 'custom',
        path: ['openingAccumulated'],
        message: 'Cannot exceed cost minus salvage value',
      });
    if (v.depreciationStartDate && v.depreciationStartDate < v.acquisitionDate)
      ctx.addIssue({
        code: 'custom',
        path: ['depreciationStartDate'],
        message: 'Cannot be before the acquisition date',
      });
    if (v.openingAccumulated > 0 && v.acquisitionCreditAccountId)
      ctx.addIssue({
        code: 'custom',
        path: ['acquisitionCreditAccountId'],
        message: 'Existing assets with opening depreciation are registered without a purchase journal',
      });
  });

export const disposeSchema = z
  .object({
    date: z.coerce.date(),
    proceeds: z.coerce.number().min(0).max(1e14).default(0),
    bankAccountId: optUuid,
    notes: optText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.proceeds > 0 && !v.bankAccountId)
      ctx.addIssue({
        code: 'custom',
        path: ['bankAccountId'],
        message: 'Choose the account that received the money',
      });
  });

type Asset = Prisma.FixedAssetGetPayload<object>;
const FINANCIAL = ['acquisitionDate', 'depreciationStartDate', 'cost', 'salvageValue', 'usefulLifeMonths', 'methodCode', 'assetAccountId', 'accumDepAccountId', 'depExpenseAccountId'] as const;

/** Depreciation amount of one month. Pure function so schedules and postings always agree. */
export function monthlyDepreciation(
  a: {
    cost: Prisma.Decimal.Value;
    salvageValue: Prisma.Decimal.Value;
    usefulLifeMonths: number;
    methodCode: string;
    depreciationStartDate: Date;
  },
  period: string,
  accumulated: Prisma.Decimal,
) {
  const idx = periodIndex(period) - periodIndex(periodOf(a.depreciationStartDate));
  if (idx < 0 || idx >= a.usefulLifeMonths) return ZERO;
  const book = D(a.cost).minus(accumulated);
  const depreciable = book.minus(D(a.salvageValue));
  if (depreciable.lte(0)) return ZERO;
  const remaining = a.usefulLifeMonths - idx;
  if (remaining <= 1) return round(depreciable); // last month absorbs rounding
  const straight = round(depreciable.div(remaining));
  if (a.methodCode === 'DECLINING_BALANCE') {
    // double declining balance, switching to straight line once that gives more
    const declining = round(book.times(2).div(a.usefulLifeMonths));
    return Prisma.Decimal.min(Prisma.Decimal.max(declining, straight), depreciable);
  }
  return Prisma.Decimal.min(straight, depreciable);
}

@Injectable()
export class AssetService {
  private readonly logger = new Logger('FixedAssets');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly journal: JournalService,
  ) {}

  private scope() {
    return this.access.scopeWhere({
      branchField: 'branchId',
    }) as Prisma.FixedAssetWhereInput;
  }

  private async findOwned(id: string, tx?: Tx): Promise<Asset> {
    if (!isUuid(id)) throw new NotFoundException('Asset not found');
    const a = await (tx ?? this.prisma).fixedAsset.findFirst({
      where: { ...this.scope(), id, deletedAt: null },
    });
    if (!a) throw new NotFoundException('Asset not found');
    return a;
  }

  private book(a: Asset) {
    return D(a.cost).minus(D(a.accumulatedDepreciation));
  }

  // ------------------------------------------------------------------ queries
  async list(q: { page: number; pageSize: number; search?: string; status?: string; category?: string; sort?: string; order?: 'asc' | 'desc' }) {
    RequestCtx.assert('accounting.asset.read');
    const where: Prisma.FixedAssetWhereInput = {
      ...this.scope(),
      deletedAt: null,
    };
    if (q.status) where.statusCode = q.status;
    if (q.category) where.categoryCode = q.category;
    if (q.search)
      where.OR = [{ code: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }, { serialNumber: { contains: q.search, mode: 'insensitive' } }, { location: { contains: q.search, mode: 'insensitive' } }];
    const sort = ['code', 'name', 'acquisitionDate', 'cost'].includes(q.sort ?? '') ? q.sort! : 'code';
    const [rows, total, sums] = await Promise.all([
      this.prisma.fixedAsset.findMany({
        where,
        orderBy: { [sort]: q.order ?? 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.fixedAsset.count({ where }),
      this.prisma.fixedAsset.aggregate({
        where: { ...where, statusCode: { not: 'DISPOSED' } },
        _sum: { cost: true, accumulatedDepreciation: true },
        _count: { _all: true },
      }),
    ]);
    const emps = await this.prisma.employee.findMany({
      where: {
        id: {
          in: rows.map((r) => r.custodianEmployeeId).filter(Boolean) as string[],
        },
      },
      select: { id: true, fullName: true },
    });
    const en = new Map(emps.map((e) => [e.id, e.fullName]));
    const cost = D(sums._sum.cost);
    const accum = D(sums._sum.accumulatedDepreciation);
    return {
      ...paged(
        rows.map((r) => ({
          ...r,
          bookValue: this.book(r),
          custodianName: r.custodianEmployeeId ? (en.get(r.custodianEmployeeId) ?? null) : null,
        })),
        total,
        q,
      ),
      summary: {
        count: sums._count._all,
        cost,
        accumulated: accum,
        bookValue: cost.minus(accum),
      },
    };
  }

  async get(id: string) {
    RequestCtx.assert('accounting.asset.read');
    const a = await this.findOwned(id);
    const accIds = [a.assetAccountId, a.accumDepAccountId, a.depExpenseAccountId].filter(Boolean) as string[];
    const [emp, supplier, accounts, deps, journals] = await Promise.all([
      a.custodianEmployeeId
        ? this.prisma.employee.findUnique({
            where: { id: a.custodianEmployeeId },
            select: { fullName: true },
          })
        : null,
      a.supplierId
        ? this.prisma.supplier.findUnique({
            where: { id: a.supplierId },
            select: { name: true },
          })
        : null,
      this.prisma.account.findMany({
        where: { id: { in: accIds } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.assetDepreciation.findMany({
        where: { assetId: id },
        orderBy: { period: 'asc' },
      }),
      this.prisma.journalEntry.findMany({
        where: {
          companyId: a.companyId,
          OR: [{ sourceType: { in: ['ASSET_ACQ', 'ASSET_DISP'] }, sourceId: id }],
        },
        select: {
          id: true,
          number: true,
          status: true,
          sourceType: true,
          date: true,
        },
      }),
    ]);
    const depJournals = await this.prisma.journalEntry.findMany({
      where: {
        id: {
          in: deps.map((d) => d.journalEntryId).filter(Boolean) as string[],
        },
      },
      select: { id: true, number: true, status: true },
    });
    const jm = new Map(depJournals.map((j) => [j.id, j]));
    const am = new Map(accounts.map((x) => [x.id, `${x.code} - ${x.name}`]));
    return {
      ...a,
      bookValue: this.book(a),
      custodianName: emp?.fullName ?? null,
      supplierName: supplier?.name ?? null,
      assetAccountName: a.assetAccountId ? (am.get(a.assetAccountId) ?? null) : null,
      accumDepAccountName: a.accumDepAccountId ? (am.get(a.accumDepAccountId) ?? null) : null,
      depExpenseAccountName: a.depExpenseAccountId ? (am.get(a.depExpenseAccountId) ?? null) : null,
      depreciations: deps.map((d) => ({
        ...d,
        journal: d.journalEntryId ? (jm.get(d.journalEntryId) ?? null) : null,
      })),
      journals,
      schedule: this.schedule(a),
    };
  }

  /** Remaining depreciation plan from the current state (projection, nothing is posted). */
  schedule(a: Asset) {
    if (a.statusCode === 'DISPOSED') return [];
    const out: {
      period: string;
      amount: Prisma.Decimal;
      accumulated: Prisma.Decimal;
      bookValue: Prisma.Decimal;
    }[] = [];
    let accumulated = D(a.accumulatedDepreciation);
    const start = Math.max(periodIndex(periodOf(a.depreciationStartDate)), a.lastDepreciationPeriod ? periodIndex(a.lastDepreciationPeriod) + 1 : 0);
    const end = periodIndex(periodOf(a.depreciationStartDate)) + a.usefulLifeMonths - 1;
    for (let i = start; i <= end && out.length < 600; i++) {
      const period = periodFromIndex(i);
      const amount = monthlyDepreciation(a, period, accumulated);
      if (amount.lte(0)) break;
      accumulated = accumulated.plus(amount);
      out.push({
        period,
        amount,
        accumulated,
        bookValue: D(a.cost).minus(accumulated),
      });
    }
    return out;
  }

  // ------------------------------------------------------------------ register / edit
  private async validate(input: z.infer<typeof assetSchema>) {
    await assertLookup(this.prisma, 'ASSET_CATEGORY', input.categoryCode, 'categoryCode');
    await assertLookup(this.prisma, 'DEPRECIATION_METHOD', input.methodCode, 'methodCode');
    await assertLookup(this.prisma, 'TAX_ASSET_GROUP', input.taxGroupCode, 'taxGroupCode');
    await assertOwned(this.prisma, 'employee', input.custodianEmployeeId, 'custodianEmployeeId', 'Employee');
    await assertOwned(this.prisma, 'supplier', input.supplierId, 'supplierId', 'Supplier');
    await assertPostingAccount(this.prisma, input.assetAccountId, 'assetAccountId');
    await assertPostingAccount(this.prisma, input.accumDepAccountId, 'accumDepAccountId');
    await assertPostingAccount(this.prisma, input.depExpenseAccountId, 'depExpenseAccountId');
    await assertPostingAccount(this.prisma, input.acquisitionCreditAccountId, 'acquisitionCreditAccountId');
  }

  /** default ledger accounts from Accounting > Posting Accounts */
  private async defaults(companyId: string) {
    const maps = await this.prisma.accountMapping.findMany({
      where: {
        companyId,
        key: {
          in: ['FIXED_ASSET', 'ACCUM_DEPRECIATION', 'DEPRECIATION_EXPENSE'],
        },
      },
    });
    const m = new Map(maps.map((x) => [x.key, x.accountId]));
    return {
      assetAccountId: m.get('FIXED_ASSET') ?? null,
      accumDepAccountId: m.get('ACCUM_DEPRECIATION') ?? null,
      depExpenseAccountId: m.get('DEPRECIATION_EXPENSE') ?? null,
    };
  }

  async create(body: unknown) {
    RequestCtx.assert('accounting.asset.create');
    const input = assetSchema.parse(body);
    await this.validate(input);
    const u = RequestCtx.user();
    const def = await this.defaults(u.companyId);
    return this.prisma.$transaction(async (tx) => {
      const code = input.code || (await this.sequence.next('ASSET', u.companyId, input.acquisitionDate, tx));
      if (
        await tx.fixedAsset.findFirst({
          where: { companyId: u.companyId, code },
        })
      )
        throw new BadRequestException({
          message: 'Validation failed',
          errors: { code: 'Code is already used' },
        });
      const a = await tx.fixedAsset.create({
        data: {
          companyId: u.companyId,
          branchId: u.branchId,
          code,
          name: input.name,
          categoryCode: input.categoryCode ?? null,
          taxGroupCode: input.taxGroupCode ?? null,
          serialNumber: input.serialNumber ?? null,
          location: input.location ?? null,
          custodianEmployeeId: input.custodianEmployeeId ?? null,
          supplierId: input.supplierId ?? null,
          acquisitionDate: input.acquisitionDate,
          depreciationStartDate: input.depreciationStartDate ?? input.acquisitionDate,
          cost: D(input.cost),
          salvageValue: D(input.salvageValue),
          usefulLifeMonths: input.usefulLifeMonths,
          methodCode: input.methodCode,
          assetAccountId: input.assetAccountId ?? def.assetAccountId,
          accumDepAccountId: input.accumDepAccountId ?? def.accumDepAccountId,
          depExpenseAccountId: input.depExpenseAccountId ?? def.depExpenseAccountId,
          accumulatedDepreciation: D(input.openingAccumulated),
          statusCode: D(input.openingAccumulated).gte(D(input.cost).minus(D(input.salvageValue))) ? 'FULLY_DEPRECIATED' : 'ACTIVE',
          notes: input.notes ?? null,
          createdById: u.id,
        },
      });
      if (input.acquisitionCreditAccountId) {
        await this.journal.post(tx, {
          companyId: u.companyId,
          branchId: u.branchId,
          date: input.acquisitionDate,
          description: `Acquisition of fixed asset ${code} - ${input.name}`,
          reference: code,
          sourceType: 'ASSET_ACQ',
          sourceId: a.id,
          lines: [
            {
              accountId: a.assetAccountId,
              key: a.assetAccountId ? undefined : 'FIXED_ASSET',
              debit: D(input.cost),
              description: input.name,
            },
            {
              accountId: input.acquisitionCreditAccountId,
              credit: D(input.cost),
              description: input.name,
            },
          ],
        });
      }
      await this.audit.record('Fixed Asset', a.id, 'CREATE', undefined, a, tx);
      return a;
    });
  }

  async update(id: string, body: unknown) {
    RequestCtx.assert('accounting.asset.update');
    const before = await this.findOwned(id);
    if (before.statusCode === 'DISPOSED') throw new ConflictException('Disposed assets cannot be edited');
    const input = assetSchema.parse({
      ...(body as object),
      openingAccumulated: 0,
      acquisitionCreditAccountId: null,
    });
    await this.validate(input);
    const next = {
      acquisitionDate: input.acquisitionDate,
      depreciationStartDate: input.depreciationStartDate ?? input.acquisitionDate,
      cost: D(input.cost),
      salvageValue: D(input.salvageValue),
      usefulLifeMonths: input.usefulLifeMonths,
      methodCode: input.methodCode,
      assetAccountId: input.assetAccountId ?? before.assetAccountId,
      accumDepAccountId: input.accumDepAccountId ?? before.accumDepAccountId,
      depExpenseAccountId: input.depExpenseAccountId ?? before.depExpenseAccountId,
    };
    const posted = await this.prisma.assetDepreciation.count({
      where: { assetId: id },
    });
    const hasAcq = await this.prisma.journalEntry.count({
      where: { sourceType: 'ASSET_ACQ', sourceId: id, status: 'POSTED' },
    });
    if (posted || hasAcq) {
      const changed = FINANCIAL.filter((k) => String(next[k] instanceof Date ? isoOf(next[k] as Date) : (next[k] ?? '')) !== String(before[k] instanceof Date ? isoOf(before[k] as Date) : (before[k] ?? '')));
      if (changed.length) throw new ConflictException(`Depreciation or a purchase journal has been posted, so these fields can no longer change: ${changed.join(', ')}`);
    }
    if (D(before.accumulatedDepreciation).gt(next.cost.minus(next.salvageValue)))
      throw new BadRequestException({
        message: 'Validation failed',
        errors: {
          cost: 'Cost minus salvage is lower than the depreciation already booked',
        },
      });
    const code = input.code || before.code;
    if (
      code !== before.code &&
      (await this.prisma.fixedAsset.findFirst({
        where: { companyId: before.companyId, code },
      }))
    )
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { code: 'Code is already used' },
      });
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.fixedAsset.update({
        where: { id },
        data: {
          ...next,
          code,
          name: input.name,
          categoryCode: input.categoryCode ?? null,
          taxGroupCode: input.taxGroupCode ?? null,
          serialNumber: input.serialNumber ?? null,
          location: input.location ?? null,
          custodianEmployeeId: input.custodianEmployeeId ?? null,
          supplierId: input.supplierId ?? null,
          notes: input.notes ?? null,
          statusCode: D(before.accumulatedDepreciation).gte(next.cost.minus(next.salvageValue)) ? 'FULLY_DEPRECIATED' : 'ACTIVE',
          updatedById: RequestCtx.user().id,
        },
      });
      await this.audit.record('Fixed Asset', id, 'UPDATE', before, a, tx);
      return a;
    });
  }

  async remove(id: string) {
    RequestCtx.assert('accounting.asset.delete');
    const before = await this.findOwned(id);
    if (await this.prisma.assetDepreciation.count({ where: { assetId: id } })) throw new ConflictException('Depreciation has been posted for this asset. Dispose it instead.');
    if (before.statusCode === 'DISPOSED') throw new ConflictException('Disposed assets cannot be deleted');
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'ASSET_ACQ', id);
      await tx.fixedAsset.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: RequestCtx.user().id },
      });
      await this.audit.record('Fixed Asset', id, 'DELETE', before, undefined, tx);
    });
    return { success: true };
  }

  // ------------------------------------------------------------------ depreciation
  private assertPeriod(period: string) {
    if (!PERIOD_RE.test(period))
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { period: 'Use the format YYYY-MM' },
      });
    if (periodIndex(period) > periodIndex(todayIso().slice(0, 7)))
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { period: 'Future periods cannot be depreciated' },
      });
  }

  /** Amounts that a run up to `period` would post, per asset (nothing is written). */
  async preview(period: string) {
    RequestCtx.assert('accounting.asset.read');
    this.assertPeriod(period);
    const assets = await this.prisma.fixedAsset.findMany({
      where: { ...this.scope(), deletedAt: null, statusCode: 'ACTIVE' },
      orderBy: { code: 'asc' },
    });
    const rows = assets
      .map((a) => {
        const plan = this.schedule(a).filter((s) => periodIndex(s.period) <= periodIndex(period));
        return {
          id: a.id,
          code: a.code,
          name: a.name,
          periods: plan.map((p) => p.period),
          amount: plan.reduce((t, p) => t.plus(p.amount), ZERO),
        };
      })
      .filter((r) => r.periods.length);
    return {
      period,
      rows,
      total: rows.reduce((t, r) => t.plus(r.amount), ZERO),
    };
  }

  /** Posts depreciation up to and including `period` for one asset (catching up missed months). Idempotent. */
  private async depreciateAsset(assetId: string, period: string) {
    const posted: {
      period: string;
      amount: Prisma.Decimal;
      journal?: string;
    }[] = [];
    for (let guard = 0; guard < 600; guard++) {
      const step = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM fixed_assets WHERE id = ${assetId}::uuid FOR UPDATE`;
          const a = await tx.fixedAsset.findUniqueOrThrow({
            where: { id: assetId },
          });
          if (a.statusCode !== 'ACTIVE' || a.deletedAt) return null;
          const nextIdx = Math.max(periodIndex(periodOf(a.depreciationStartDate)), a.lastDepreciationPeriod ? periodIndex(a.lastDepreciationPeriod) + 1 : 0);
          if (nextIdx > periodIndex(period)) return null;
          const p = periodFromIndex(nextIdx);
          const amount = monthlyDepreciation(a, p, D(a.accumulatedDepreciation));
          if (amount.lte(0)) {
            await tx.fixedAsset.update({
              where: { id: a.id },
              data: { statusCode: 'FULLY_DEPRECIATED' },
            });
            return null;
          }
          const date = periodEnd(p);
          const accumulated = D(a.accumulatedDepreciation).plus(amount);
          const book = D(a.cost).minus(accumulated);
          const dep = await tx.assetDepreciation.create({
            data: {
              assetId: a.id,
              period: p,
              date,
              amount,
              bookValueAfter: book,
            },
          });
          const je = await this.journal.post(tx, {
            companyId: a.companyId,
            branchId: a.branchId,
            date,
            description: `Depreciation ${p} - ${a.code} ${a.name}`,
            reference: a.code,
            sourceType: 'ASSET_DEP',
            sourceId: dep.id,
            lines: [
              {
                accountId: a.depExpenseAccountId,
                key: a.depExpenseAccountId ? undefined : 'DEPRECIATION_EXPENSE',
                debit: amount,
                description: a.name,
              },
              {
                accountId: a.accumDepAccountId,
                key: a.accumDepAccountId ? undefined : 'ACCUM_DEPRECIATION',
                credit: amount,
                description: a.name,
              },
            ],
          });
          if (je)
            await tx.assetDepreciation.update({
              where: { id: dep.id },
              data: { journalEntryId: je.id },
            });
          const fully = book.lte(D(a.salvageValue)) || nextIdx - periodIndex(periodOf(a.depreciationStartDate)) + 1 >= a.usefulLifeMonths;
          const after = await tx.fixedAsset.update({
            where: { id: a.id },
            data: {
              accumulatedDepreciation: accumulated,
              lastDepreciationPeriod: p,
              statusCode: fully ? 'FULLY_DEPRECIATED' : 'ACTIVE',
            },
          });
          await this.audit.record(
            'Fixed Asset',
            a.id,
            'DEPRECIATE',
            {
              accumulatedDepreciation: a.accumulatedDepreciation,
              lastDepreciationPeriod: a.lastDepreciationPeriod,
            },
            {
              accumulatedDepreciation: after.accumulatedDepreciation,
              lastDepreciationPeriod: p,
              journal: je?.number,
            },
            tx,
          );
          return { period: p, amount, journal: je?.number };
        },
        { timeout: 30_000 },
      );
      if (!step) break;
      posted.push(step);
    }
    return posted;
  }

  /** Depreciation run for every active asset of the company up to `period`. */
  async run(period: string, assetIds?: string[]) {
    this.assertPeriod(period);
    const assets = await this.prisma.fixedAsset.findMany({
      where: {
        ...this.scope(),
        deletedAt: null,
        statusCode: 'ACTIVE',
        ...(assetIds ? { id: { in: assetIds } } : {}),
      },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    const results: {
      id: string;
      code: string;
      name: string;
      periods: number;
      amount: Prisma.Decimal;
      error?: string;
    }[] = [];
    for (const a of assets) {
      try {
        const posted = await this.depreciateAsset(a.id, period);
        if (posted.length)
          results.push({
            ...a,
            periods: posted.length,
            amount: posted.reduce((t, p) => t.plus(p.amount), ZERO),
          });
      } catch (e) {
        this.logger.warn(`${a.code}: depreciation failed - ${(e as Error).message}`);
        results.push({
          ...a,
          periods: 0,
          amount: ZERO,
          error: (e as Error).message,
        });
      }
    }
    return {
      period,
      assets: results.filter((r) => !r.error).length,
      entries: results.reduce((t, r) => t + r.periods, 0),
      total: results.reduce((t, r) => t.plus(r.amount), ZERO),
      failed: results.filter((r) => r.error).length,
      results,
    };
  }

  async runForUser(period: string, assetIds?: string[]) {
    RequestCtx.assert('accounting.asset.depreciate');
    if (assetIds?.some((x) => !isUuid(x))) throw new NotFoundException('Asset not found');
    return this.run(period, assetIds);
  }

  // ------------------------------------------------------------------ disposal
  async dispose(id: string, body: unknown) {
    RequestCtx.assert('accounting.asset.dispose');
    const input = disposeSchema.parse(body);
    const a0 = await this.findOwned(id);
    if (a0.statusCode === 'DISPOSED') throw new ConflictException('Asset is already disposed');
    if (input.date < a0.acquisitionDate)
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { date: 'Cannot be before the acquisition date' },
      });
    const bank = await assertOwned(this.prisma, 'bankAccount', input.bankAccountId, 'bankAccountId', 'Cash / bank account');
    if (bank && !bank.accountId) throw new BadRequestException('The cash/bank account has no ledger account');

    // book depreciation up to the month before the disposal first
    const prev = periodFromIndex(periodIndex(periodOf(input.date)) - 1);
    if (a0.statusCode === 'ACTIVE' && periodIndex(prev) >= periodIndex(periodOf(a0.depreciationStartDate))) await this.depreciateAsset(id, prev);

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM fixed_assets WHERE id = ${id}::uuid FOR UPDATE`;
        const a = await tx.fixedAsset.findUniqueOrThrow({ where: { id } });
        if (a.statusCode === 'DISPOSED') throw new ConflictException('Asset is already disposed');
        const cost = D(a.cost);
        const accum = D(a.accumulatedDepreciation);
        const proceeds = round(D(input.proceeds));
        const result = proceeds.minus(cost.minus(accum)); // > 0 gain, < 0 loss
        const desc = `Disposal of fixed asset ${a.code} - ${a.name}`;
        const je = await this.journal.post(tx, {
          companyId: a.companyId,
          branchId: a.branchId,
          date: input.date,
          description: desc,
          reference: a.code,
          sourceType: 'ASSET_DISP',
          sourceId: a.id,
          lines: [
            {
              accountId: a.accumDepAccountId,
              key: a.accumDepAccountId ? undefined : 'ACCUM_DEPRECIATION',
              debit: accum,
              description: a.name,
            },
            ...(proceeds.gt(0)
              ? [
                  {
                    accountId: bank!.accountId as string,
                    debit: proceeds,
                    description: input.notes ?? desc,
                  },
                ]
              : []),
            {
              accountId: a.assetAccountId,
              key: a.assetAccountId ? undefined : 'FIXED_ASSET',
              credit: cost,
              description: a.name,
            },
            ...(result.gt(0)
              ? [
                  {
                    key: 'ASSET_DISPOSAL_GAIN',
                    credit: result,
                    description: desc,
                  },
                ]
              : []),
            ...(result.lt(0)
              ? [
                  {
                    key: 'ASSET_DISPOSAL_LOSS',
                    debit: result.abs(),
                    description: desc,
                  },
                ]
              : []),
          ],
        });
        const after = await tx.fixedAsset.update({
          where: { id },
          data: {
            statusCode: 'DISPOSED',
            disposalDate: input.date,
            disposalAmount: proceeds,
            notes: input.notes ? [a.notes, `Disposal: ${input.notes}`].filter(Boolean).join('\n') : a.notes,
            updatedById: RequestCtx.user().id,
          },
        });
        await this.audit.record('Fixed Asset', id, 'DISPOSE', a, { ...after, journal: je?.number, gainLoss: result.toString() }, tx);
        return {
          ...after,
          journalNumber: je?.number ?? null,
          gainLoss: result,
        };
      },
      { timeout: 30_000 },
    );
  }
}
