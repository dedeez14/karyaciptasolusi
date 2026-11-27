import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { JournalService, PostingLine } from '../accounting/journal.service';
import { collectOf, effectiveOfFlat, parseRates, schedule } from './coop.calc';

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const DAY = 86_400_000;
const today = () => new Date(new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });

/** PP 15/2009: savings interest to an individual member above Rp240,000 a month: 10% final; to an entity: PPh 23 15% */
export const PPH_THRESHOLD = 240_000;
const SAVING_KEY: Record<string, string> = { PRINCIPAL: 'COOP_SAV_PRINCIPAL', MANDATORY: 'COOP_SAV_MANDATORY', VOLUNTARY: 'COOP_SAV_VOLUNTARY', TERM: 'COOP_SAV_TERM' };
const SHU_PARTS = ['reserve', 'capital', 'transactions', 'board', 'staff', 'education', 'social'] as const;

export const memberSchema = z.object({
  name: z.string().trim().min(1).max(150),
  kind: z.enum(['INDIVIDUAL', 'ENTITY']).default('INDIVIDUAL'),
  idNumber: optText(40),
  phone: optText(30),
  address: optText(300),
  employeeId: optUuid,
  customerId: optUuid,
  joinDate: z.coerce.date(),
  notes: optText(1000),
});
export const savingProductSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['PRINCIPAL', 'MANDATORY', 'VOLUNTARY', 'TERM']),
  amount: z.coerce.number().min(0).max(1e12).default(0),
  ratePct: z.coerce.number().min(0).max(9, 'Savings interest at most 9% a year (Permenkop UKM 8/2023)').default(0),
  termMonths: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().min(1).max(120).nullable().optional()),
  isActive: z.boolean().default(true),
});
export const loanProductSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  ratePct: z.coerce.number().min(0).max(24, 'Loan interest at most 24% a year (Permenkop UKM 8/2023 Art. 27)'),
  method: z.enum(['FLAT', 'ANNUITY']).default('FLAT'),
  adminPct: z.coerce.number().min(0).max(10).default(0),
  savingPct: z.coerce.number().min(0).max(20).default(0),
  latePct: z.coerce.number().min(0).max(5).default(0),
  maxTerm: z.coerce.number().int().min(1).max(240).default(36),
  isActive: z.boolean().default(true),
});
export const txnSchema = z.object({ date: z.coerce.date(), amount: z.coerce.number().positive().max(1e13), bankAccountId: z.uuid(), reference: optText(100) });
export const openSchema = z.object({ productId: z.uuid(), date: z.coerce.date() });
export const loanSchema = z.object({
  memberId: z.uuid(),
  productId: z.uuid(),
  applicationDate: z.coerce.date(),
  principal: z.coerce.number().positive().max(1e13),
  termMonths: z.coerce.number().int().min(1).max(240),
  firstDue: z.coerce.date(),
  purpose: optText(200),
  collateral: optText(300),
  guarantor: optText(150),
  notes: optText(1000),
});
export const disburseSchema = z.object({ date: z.coerce.date(), bankAccountId: z.uuid() });
export const paySchema = z.object({ date: z.coerce.date(), amount: z.coerce.number().positive().max(1e13), lateFee: z.coerce.number().min(0).max(1e12).default(0), bankAccountId: z.uuid() });
export const leaveSchema = z.object({ date: z.coerce.date(), bankAccountId: z.uuid() });
export const shuSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  date: z.coerce.date(),
  shu: z.coerce.number().positive().max(1e14),
  split: z.array(z.coerce.number().min(0).max(100)).length(7).optional(),
  payout: z.enum(['PAYABLE', 'SAVINGS']).default('PAYABLE'),
  ratNotes: optText(300),
});

type Tx = Prisma.TransactionClient;

/**
 * Cooperative: members and their savings (simpanan pokok and wajib are equity, sukarela and berjangka are liabilities,
 * Permenkop UKM 2/2024), monthly savings interest with PPh (PP 15/2009), member loans (rate at most 24% a year,
 * Permenkop UKM 8/2023) with schedules, payments, collectibility and the allowance (incurred loss, SAK EP), and the
 * SHU of a year split as the members meeting decided (UU 25/1992 Art. 45) by capital and transactions.
 */
@Injectable()
export class CoopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly journal: JournalService,
  ) {}

  private async bank(companyId: string, id: string) {
    const b = await this.prisma.bankAccount.findFirst({ where: { id, companyId } });
    if (!b?.accountId) throw invalid({ bankAccountId: 'Choose a cash / bank account with a ledger account' });
    return b;
  }

  // ------------------------------------------------------------------ products
  async products() {
    RequestCtx.assert('coop.read');
    const companyId = RequestCtx.companyId();
    const [saving, loan] = await Promise.all([
      this.prisma.coopSavingProduct.findMany({ where: { companyId }, orderBy: { code: 'asc' } }),
      this.prisma.coopLoanProduct.findMany({ where: { companyId }, orderBy: { code: 'asc' } }),
    ]);
    return {
      saving: saving.map((p) => ({ ...p, amount: n(p.amount), ratePct: n(p.ratePct) })),
      loan: loan.map((p) => ({
        ...p,
        ratePct: n(p.ratePct),
        adminPct: n(p.adminPct),
        savingPct: n(p.savingPct),
        latePct: n(p.latePct),
        effectivePct: p.method === 'FLAT' ? effectiveOfFlat(n(p.ratePct), 12) : n(p.ratePct),
      })),
    };
  }

  async saveSavingProduct(id: string | null, input: z.infer<typeof savingProductSchema>) {
    RequestCtx.assert('coop.saving');
    const u = RequestCtx.user();
    if (['PRINCIPAL', 'MANDATORY'].includes(input.kind) && input.amount <= 0) throw invalid({ amount: 'Enter the amount of the simpanan pokok / wajib' });
    if (input.kind === 'TERM' && !input.termMonths) throw invalid({ termMonths: 'Enter the term' });
    const dup = await this.prisma.coopSavingProduct.findFirst({ where: { companyId: u.companyId, code: input.code, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw invalid({ code: 'Code already used' });
    const data = { ...input, amount: D(input.amount), ratePct: D(input.ratePct), termMonths: input.termMonths ?? null };
    if (id) {
      const cur = await this.prisma.coopSavingProduct.findFirst({ where: { id, companyId: u.companyId } });
      if (!cur) throw new NotFoundException('Product not found');
      if (cur.kind !== input.kind && (await this.prisma.coopSavingAccount.count({ where: { productId: id } }))) throw invalid({ kind: 'Accounts are open on it: the kind stays' });
      await this.prisma.coopSavingProduct.update({ where: { id }, data });
    } else await this.prisma.coopSavingProduct.create({ data: { ...data, companyId: u.companyId } });
    return this.products();
  }

  async saveLoanProduct(id: string | null, input: z.infer<typeof loanProductSchema>) {
    RequestCtx.assert('coop.loan');
    const u = RequestCtx.user();
    const dup = await this.prisma.coopLoanProduct.findFirst({ where: { companyId: u.companyId, code: input.code, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw invalid({ code: 'Code already used' });
    const data = { ...input, ratePct: D(input.ratePct), adminPct: D(input.adminPct), savingPct: D(input.savingPct), latePct: D(input.latePct) };
    if (id) {
      if (!(await this.prisma.coopLoanProduct.findFirst({ where: { id, companyId: u.companyId } }))) throw new NotFoundException('Product not found');
      await this.prisma.coopLoanProduct.update({ where: { id }, data });
    } else await this.prisma.coopLoanProduct.create({ data: { ...data, companyId: u.companyId } });
    return this.products();
  }

  // ------------------------------------------------------------------ members
  async members(status?: string) {
    RequestCtx.assert('coop.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.coopMember.findMany({ where: { companyId, ...(status ? { status } : {}) }, orderBy: { number: 'asc' } });
    const accts = await this.prisma.coopSavingAccount.findMany({ where: { memberId: { in: rows.map((r) => r.id) }, status: 'ACTIVE' }, select: { memberId: true, balance: true, productId: true } });
    const prods = await this.prisma.coopSavingProduct.findMany({ where: { companyId }, select: { id: true, kind: true } });
    const loans = await this.prisma.coopLoan.groupBy({ by: ['memberId'], where: { companyId, status: 'ACTIVE' }, _sum: { outstanding: true } });
    const kind = new Map(prods.map((p) => [p.id, p.kind]));
    return rows.map((m) => {
      const a = accts.filter((x) => x.memberId === m.id);
      const sum = (k: string[]) => r2(a.filter((x) => k.includes(kind.get(x.productId) ?? '')).reduce((s, x) => s + n(x.balance), 0));
      return { ...this.shapeMember(m), capital: sum(['PRINCIPAL', 'MANDATORY']), savings: sum(['VOLUNTARY', 'TERM']), loans: n(loans.find((l) => l.memberId === m.id)?._sum.outstanding) };
    });
  }

  private shapeMember(m: Prisma.CoopMemberGetPayload<object>) {
    const id = this.crypto.decrypt(m.idNumber);
    return { ...m, idNumber: id ? `${'•'.repeat(Math.max(0, id.length - 4))}${id.slice(-4)}` : null, joinDate: iso(m.joinDate), leftDate: iso(m.leftDate) };
  }

  async member(id: string) {
    RequestCtx.assert('coop.read');
    const companyId = RequestCtx.companyId();
    const m = await this.prisma.coopMember.findFirst({ where: { id, companyId } });
    if (!m) throw new NotFoundException('Member not found');
    const accounts = await this.prisma.coopSavingAccount.findMany({
      where: { memberId: id },
      orderBy: { number: 'asc' },
      include: { txns: { where: { status: 'POSTED' }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 30 } },
    });
    const prods = await this.prisma.coopSavingProduct.findMany({ where: { id: { in: accounts.map((a) => a.productId) } } });
    const loans = await this.prisma.coopLoan.findMany({ where: { memberId: id }, orderBy: { applicationDate: 'desc' } });
    return {
      ...this.shapeMember(m),
      accounts: accounts.map(({ txns, ...a }) => {
        const p = prods.find((x) => x.id === a.productId)!;
        return {
          ...a,
          balance: n(a.balance),
          openedAt: iso(a.openedAt),
          maturityDate: iso(a.maturityDate),
          product: { id: p.id, code: p.code, name: p.name, kind: p.kind, amount: n(p.amount), ratePct: n(p.ratePct) },
          txns: txns.map((t) => ({ ...t, date: iso(t.date), amount: n(t.amount), balanceAfter: n(t.balanceAfter) })),
        };
      }),
      loans: loans.map((l) => ({ id: l.id, number: l.number, principal: n(l.principal), outstanding: n(l.outstanding), status: l.status, applicationDate: iso(l.applicationDate) })),
    };
  }

  /** registration: the member number, and the principal, mandatory and voluntary accounts of the active products */
  async saveMember(id: string | null, input: z.infer<typeof memberSchema>) {
    RequestCtx.assert('coop.member');
    const u = RequestCtx.user();
    const data = {
      name: input.name,
      kind: input.kind,
      phone: input.phone ?? null,
      address: input.address ?? null,
      employeeId: input.employeeId ?? null,
      customerId: input.customerId ?? null,
      joinDate: input.joinDate,
      notes: input.notes ?? null,
      ...(input.idNumber ? { idNumber: this.crypto.encrypt(input.idNumber) } : {}),
    };
    let m;
    if (id) {
      if (!(await this.prisma.coopMember.findFirst({ where: { id, companyId: u.companyId } }))) throw new NotFoundException('Member not found');
      m = await this.prisma.coopMember.update({ where: { id }, data });
    } else {
      m = await this.prisma.$transaction(async (tx) => {
        const row = await tx.coopMember.create({ data: { ...data, companyId: u.companyId, number: await this.sequence.next('COOP_MEMBER', u.companyId, input.joinDate, tx), createdById: u.id } });
        const prods = await tx.coopSavingProduct.findMany({ where: { companyId: u.companyId, isActive: true, kind: { in: ['PRINCIPAL', 'MANDATORY', 'VOLUNTARY'] } }, orderBy: { code: 'asc' } });
        const seen = new Set<string>();
        for (const p of prods) {
          if (seen.has(p.kind)) continue;
          seen.add(p.kind);
          await tx.coopSavingAccount.create({
            data: { companyId: u.companyId, number: await this.sequence.next('COOP_SAVING', u.companyId, input.joinDate, tx), memberId: row.id, productId: p.id, openedAt: input.joinDate },
          });
        }
        return row;
      });
    }
    await this.audit.record('Coop Member', m.id, id ? 'UPDATE' : 'CREATE', null, { number: m.number });
    return this.member(m.id);
  }

  async openAccount(memberId: string, input: z.infer<typeof openSchema>) {
    RequestCtx.assert('coop.saving');
    const u = RequestCtx.user();
    const m = await this.prisma.coopMember.findFirst({ where: { id: memberId, companyId: u.companyId, status: 'ACTIVE' } });
    if (!m) throw new NotFoundException('Active member not found');
    const p = await this.prisma.coopSavingProduct.findFirst({ where: { id: input.productId, companyId: u.companyId, isActive: true } });
    if (!p) throw invalid({ productId: 'Choose a savings product' });
    if (['PRINCIPAL', 'MANDATORY'].includes(p.kind) && (await this.prisma.coopSavingAccount.count({ where: { memberId, productId: p.id, status: 'ACTIVE' } })))
      throw new ConflictException('The member has this account already');
    await this.prisma.$transaction(async (tx) =>
      tx.coopSavingAccount.create({
        data: {
          companyId: u.companyId,
          number: await this.sequence.next('COOP_SAVING', u.companyId, input.date, tx),
          memberId,
          productId: p.id,
          openedAt: input.date,
          maturityDate: p.kind === 'TERM' && p.termMonths ? new Date(Date.UTC(input.date.getUTCFullYear(), input.date.getUTCMonth() + p.termMonths, input.date.getUTCDate())) : null,
        },
      }),
    );
    return this.member(memberId);
  }

  private async account(id: string, companyId: string) {
    const a = await this.prisma.coopSavingAccount.findFirst({ where: { id, companyId } });
    if (!a) throw new NotFoundException('Savings account not found');
    const p = await this.prisma.coopSavingProduct.findUniqueOrThrow({ where: { id: a.productId } });
    const m = await this.prisma.coopMember.findUniqueOrThrow({ where: { id: a.memberId } });
    return { a, p, m };
  }

  /** moves money in or out of a savings account with its journal (the account row locked) */
  private async move(tx: Tx, accountId: string, kind: string, amount: number, date: Date, reference: string | null, sourceId: string | null) {
    const [row] = await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`SELECT balance FROM coop_saving_accounts WHERE id = ${accountId}::uuid FOR UPDATE`;
    const balance = r2(n(row.balance) + amount);
    if (balance < -0.004) throw new ConflictException(`Not enough in the account: ${n(row.balance).toLocaleString('id-ID')}`);
    await tx.coopSavingAccount.update({ where: { id: accountId }, data: { balance: D(balance) } });
    return tx.coopSavingTxn.create({ data: { accountId, date, kind, amount: D(amount), balanceAfter: D(balance), reference, sourceId, createdById: RequestCtx.user().id } });
  }

  async deposit(accountId: string, input: z.infer<typeof txnSchema>) {
    RequestCtx.assert('coop.saving');
    const u = RequestCtx.user();
    const { a, p, m } = await this.account(accountId, u.companyId);
    if (a.status !== 'ACTIVE' || m.status !== 'ACTIVE') throw new ConflictException('The account or the member is closed');
    if (p.kind === 'PRINCIPAL' && r2(n(a.balance) + input.amount) > n(p.amount)) throw invalid({ amount: `Simpanan pokok is ${n(p.amount).toLocaleString('id-ID')} once` });
    const b = await this.bank(u.companyId, input.bankAccountId);
    await this.prisma.$transaction(async (tx) => {
      const t = await this.move(tx, accountId, 'DEPOSIT', input.amount, input.date, input.reference ?? null, null);
      await this.journal.post(tx, {
        companyId: u.companyId,
        date: input.date,
        description: `${p.name} ${m.number} ${m.name}`,
        reference: a.number,
        sourceType: 'COOP_SAVING',
        sourceId: t.id,
        lines: [
          { accountId: b.accountId, debit: D(input.amount), description: `${p.name} ${m.number}` },
          { key: SAVING_KEY[p.kind], credit: D(input.amount), description: `${a.number} ${m.name}` },
        ],
      });
    });
    await this.audit.record('Coop Savings', accountId, 'DEPOSIT', null, { amount: input.amount });
    return this.member(m.id);
  }

  /** voluntary savings any time, term deposits from their maturity; pokok and wajib only when the member leaves */
  async withdraw(accountId: string, input: z.infer<typeof txnSchema>) {
    RequestCtx.assert('coop.saving');
    const u = RequestCtx.user();
    const { a, p, m } = await this.account(accountId, u.companyId);
    if (['PRINCIPAL', 'MANDATORY'].includes(p.kind)) throw new ConflictException('Simpanan pokok and wajib are paid back when the member leaves');
    if (p.kind === 'TERM' && a.maturityDate && input.date < a.maturityDate) throw new ConflictException(`The term deposit matures on ${iso(a.maturityDate)}`);
    const b = await this.bank(u.companyId, input.bankAccountId);
    await this.prisma.$transaction(async (tx) => {
      const t = await this.move(tx, accountId, 'WITHDRAW', -input.amount, input.date, input.reference ?? null, null);
      await this.journal.post(tx, {
        companyId: u.companyId,
        date: input.date,
        description: `Withdrawal ${p.name} ${m.number} ${m.name}`,
        reference: a.number,
        sourceType: 'COOP_SAVING',
        sourceId: t.id,
        lines: [
          { key: SAVING_KEY[p.kind], debit: D(input.amount), description: `${a.number} ${m.name}` },
          { accountId: b.accountId, credit: D(input.amount), description: `Withdrawal ${m.number}` },
        ],
      });
    });
    await this.audit.record('Coop Savings', accountId, 'WITHDRAW', null, { amount: input.amount });
    return this.member(m.id);
  }

  /** leaving member: no loan left, voluntary / term savings withdrawn; pokok and wajib paid back */
  async leave(memberId: string, input: z.infer<typeof leaveSchema>) {
    RequestCtx.assert('coop.member');
    const u = RequestCtx.user();
    const m = await this.prisma.coopMember.findFirst({ where: { id: memberId, companyId: u.companyId, status: 'ACTIVE' } });
    if (!m) throw new NotFoundException('Active member not found');
    if (await this.prisma.coopLoan.count({ where: { memberId, status: { in: ['ACTIVE', 'APPLIED'] } } })) throw new ConflictException('The member has a loan open: settle or cancel it first');
    const accts = await this.prisma.coopSavingAccount.findMany({ where: { memberId, status: 'ACTIVE' } });
    const prods = await this.prisma.coopSavingProduct.findMany({ where: { id: { in: accts.map((a) => a.productId) } } });
    const kindOf = (a: (typeof accts)[number]) => prods.find((p) => p.id === a.productId)!.kind;
    const other = accts.find((a) => ['VOLUNTARY', 'TERM'].includes(kindOf(a)) && n(a.balance) > 0);
    if (other) throw new ConflictException(`Withdraw the ${other.number} balance first`);
    const b = await this.bank(u.companyId, input.bankAccountId);
    await this.prisma.$transaction(async (tx) => {
      const j: PostingLine[] = [];
      let total = 0;
      for (const a of accts) {
        if (n(a.balance) > 0) {
          await this.move(tx, a.id, 'CLOSE', -n(a.balance), input.date, 'Member left', null);
          j.push({ key: SAVING_KEY[kindOf(a)], debit: a.balance, description: `${a.number} ${m.name}` });
          total = r2(total + n(a.balance));
        }
        await tx.coopSavingAccount.update({ where: { id: a.id }, data: { status: 'CLOSED' } });
      }
      if (total > 0) {
        j.push({ accountId: b.accountId, credit: D(total), description: `Savings paid back to ${m.number} ${m.name}` });
        await this.journal.post(tx, {
          companyId: u.companyId,
          date: input.date,
          description: `Member ${m.number} ${m.name} left`,
          reference: m.number,
          sourceType: 'COOP_LEAVE',
          sourceId: m.id,
          lines: j,
        });
      }
      await tx.coopMember.update({ where: { id: memberId }, data: { status: 'LEFT', leftDate: input.date } });
    });
    await this.audit.record('Coop Member', memberId, 'LEAVE');
    return this.member(memberId);
  }

  // ------------------------------------------------------------------ savings interest
  /** interest of a month on voluntary and term savings (balance at the month end), PPh withheld per member */
  async interestPreview(period: string) {
    RequestCtx.assert('coop.read');
    const companyId = RequestCtx.companyId();
    const [y, mo] = period.split('-').map(Number);
    const end = new Date(Date.UTC(y, mo, 0));
    const prods = await this.prisma.coopSavingProduct.findMany({ where: { companyId, kind: { in: ['VOLUNTARY', 'TERM'] }, ratePct: { gt: 0 } } });
    const accts = await this.prisma.coopSavingAccount.findMany({ where: { companyId, productId: { in: prods.map((p) => p.id) }, openedAt: { lte: end } } });
    const sums = await this.prisma.coopSavingTxn.groupBy({ by: ['accountId'], where: { accountId: { in: accts.map((a) => a.id) }, status: 'POSTED', date: { lte: end } }, _sum: { amount: true } });
    const members = await this.prisma.coopMember.findMany({ where: { id: { in: accts.map((a) => a.memberId) } } });
    const rows = accts
      .map((a) => {
        const p = prods.find((x) => x.id === a.productId)!;
        const bal = n(sums.find((s) => s.accountId === a.id)?._sum.amount);
        return { accountId: a.id, number: a.number, memberId: a.memberId, kind: p.kind, rate: n(p.ratePct), balance: bal, interest: Math.floor((bal * n(p.ratePct)) / 100 / 12) };
      })
      .filter((r) => r.interest > 0);
    const byMember = new Map<string, number>();
    for (const r of rows) byMember.set(r.memberId, (byMember.get(r.memberId) ?? 0) + r.interest);
    const out = rows.map((r) => {
      const m = members.find((x) => x.id === r.memberId)!;
      const total = byMember.get(r.memberId)!;
      const pct = m.kind === 'ENTITY' ? 15 : total > PPH_THRESHOLD ? 10 : 0;
      return { ...r, member: `${m.number} ${m.name}`, memberKind: m.kind, memberInterest: total, taxPct: pct, tax: Math.floor((r.interest * pct) / 100) };
    });
    const run = await this.prisma.coopInterestRun.findFirst({ where: { companyId, period, status: 'POSTED' } });
    return {
      period,
      rows: out,
      interest: out.reduce((s, r) => s + r.interest, 0),
      tax: out.reduce((s, r) => s + r.tax, 0),
      run: run ? { id: run.id, interest: n(run.interest), tax: n(run.tax) } : null,
    };
  }

  async creditInterest(period: string) {
    RequestCtx.assert('coop.saving');
    const u = RequestCtx.user();
    const pv = await this.interestPreview(period);
    if (pv.run) throw new ConflictException(`Interest of ${period} is credited already`);
    if (!pv.rows.length) throw new ConflictException('No interest to credit');
    const [y, mo] = period.split('-').map(Number);
    const date = new Date(Date.UTC(y, mo, 0));
    const run = await this.prisma.$transaction(async (tx) => {
      const r = await tx.coopInterestRun.create({ data: { companyId: u.companyId, period, interest: D(pv.interest), tax: D(pv.tax), createdById: u.id } });
      const j: PostingLine[] = [{ key: 'COOP_SAV_INTEREST', debit: D(pv.interest), description: `Savings interest ${period}` }];
      for (const x of pv.rows) {
        await this.move(tx, x.accountId, 'INTEREST', x.interest, date, `Interest ${period}`, r.id);
        if (x.tax > 0) await this.move(tx, x.accountId, 'TAX', -x.tax, date, x.memberKind === 'ENTITY' ? `PPh 23 15% ${period}` : `PPh final 10% ${period} (PP 15/2009)`, r.id);
        j.push({ key: SAVING_KEY[x.kind], credit: D(x.interest - x.tax), description: `${x.number} interest ${period}` });
      }
      const fin = pv.rows.filter((x) => x.memberKind !== 'ENTITY').reduce((s, x) => s + x.tax, 0);
      const p23 = pv.rows.filter((x) => x.memberKind === 'ENTITY').reduce((s, x) => s + x.tax, 0);
      if (fin > 0) j.push({ key: 'FINAL_TAX_PAYABLE', credit: D(fin), description: `PPh final savings interest ${period} (PP 15/2009)` });
      if (p23 > 0) j.push({ key: 'WHT_PAYABLE', credit: D(p23), description: `PPh 23 savings interest ${period}` });
      await this.journal.post(tx, { companyId: u.companyId, date, description: `Savings interest ${period}`, reference: period, sourceType: 'COOP_INTEREST', sourceId: r.id, lines: j });
      return r;
    });
    await this.audit.record('Coop Interest', run.id, 'CREATE', null, { period, interest: pv.interest, tax: pv.tax });
    return this.interestPreview(period);
  }

  async cancelInterest(runId: string) {
    RequestCtx.assert('coop.saving');
    const u = RequestCtx.user();
    const run = await this.prisma.coopInterestRun.findFirst({ where: { id: runId, companyId: u.companyId, status: 'POSTED' } });
    if (!run) throw new NotFoundException('Interest run not found');
    await this.prisma.$transaction(async (tx) => {
      const txns = await tx.coopSavingTxn.findMany({ where: { sourceId: runId, status: 'POSTED' } });
      for (const t of txns) {
        await this.move(tx, t.accountId, 'CLOSE', -n(t.amount), t.date, `Interest ${run.period} cancelled`, null);
        await tx.coopSavingTxn.update({ where: { id: t.id }, data: { status: 'CANCELLED' } });
      }
      await tx.coopSavingTxn.updateMany({ where: { reference: `Interest ${run.period} cancelled`, accountId: { in: txns.map((t) => t.accountId) } }, data: { status: 'CANCELLED' } });
      await this.journal.voidBySource(tx, 'COOP_INTEREST', runId);
      await tx.coopInterestRun.update({ where: { id: runId }, data: { status: 'CANCELLED' } });
    });
    await this.audit.record('Coop Interest', runId, 'CANCEL');
    return this.interestPreview(run.period);
  }

  // ------------------------------------------------------------------ loans
  private shapeLoan(l: Prisma.CoopLoanGetPayload<object>) {
    return {
      ...l,
      applicationDate: iso(l.applicationDate),
      firstDue: iso(l.firstDue),
      disbursedAt: iso(l.disbursedAt),
      principal: n(l.principal),
      ratePct: n(l.ratePct),
      adminFee: n(l.adminFee),
      savingDeduction: n(l.savingDeduction),
      outstanding: n(l.outstanding),
    };
  }

  /** days overdue of the oldest instalment not fully paid */
  private overdue(sch: { dueDate: Date; principal: Prisma.Decimal; interest: Prisma.Decimal; paidPrincipal: Prisma.Decimal; paidInterest: Prisma.Decimal }[], at: Date) {
    const late = sch.filter((s) => s.dueDate <= at && r2(n(s.principal) + n(s.interest) - n(s.paidPrincipal) - n(s.paidInterest)) > 0.004).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    return {
      days: late.length ? Math.floor((at.getTime() - late[0].dueDate.getTime()) / DAY) : 0,
      amount: r2(late.reduce((s, x) => s + n(x.principal) + n(x.interest) - n(x.paidPrincipal) - n(x.paidInterest), 0)),
    };
  }

  async loans(status?: string) {
    RequestCtx.assert('coop.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.coopLoan.findMany({
      where: { companyId, ...(status ? { status } : { status: { not: 'CANCELLED' } }) },
      orderBy: [{ applicationDate: 'desc' }, { number: 'desc' }],
      take: 500,
      include: { schedule: true },
    });
    const members = await this.prisma.coopMember.findMany({ where: { id: { in: rows.map((r) => r.memberId) } }, select: { id: true, number: true, name: true } });
    const t = today();
    return rows.map(({ schedule: s, ...l }) => {
      const o = l.status === 'ACTIVE' ? this.overdue(s, t) : { days: 0, amount: 0 };
      const next = s.filter((x) => r2(n(x.principal) + n(x.interest) - n(x.paidPrincipal) - n(x.paidInterest)) > 0.004).sort((a, b) => a.seq - b.seq)[0];
      return {
        ...this.shapeLoan(l),
        member: members.find((m) => m.id === l.memberId) ?? null,
        daysOverdue: o.days,
        overdueAmount: o.amount,
        collectibility: l.status === 'ACTIVE' ? collectOf(o.days) : null,
        nextDue: next ? { date: iso(next.dueDate), amount: r2(n(next.principal) + n(next.interest) - n(next.paidPrincipal) - n(next.paidInterest)) } : null,
      };
    });
  }

  async loan(id: string) {
    RequestCtx.assert('coop.read');
    const companyId = RequestCtx.companyId();
    const l = await this.prisma.coopLoan.findFirst({ where: { id, companyId }, include: { schedule: { orderBy: { seq: 'asc' } }, payments: { orderBy: { createdAt: 'desc' } } } });
    if (!l) throw new NotFoundException('Loan not found');
    const member = await this.prisma.coopMember.findUnique({ where: { id: l.memberId }, select: { id: true, number: true, name: true, status: true } });
    const product = await this.prisma.coopLoanProduct.findUnique({ where: { id: l.productId } });
    const o = l.status === 'ACTIVE' ? this.overdue(l.schedule, today()) : { days: 0, amount: 0 };
    const { schedule: s, payments, ...head } = l;
    const equity = await this.ownCapital(companyId);
    const exposure =
      n((await this.prisma.coopLoan.aggregate({ where: { memberId: l.memberId, status: 'ACTIVE', id: { not: id } }, _sum: { outstanding: true } }))._sum.outstanding) +
      (l.status === 'APPLIED' ? n(l.principal) : n(l.outstanding));
    return {
      ...this.shapeLoan(head),
      member,
      product: product ? { code: product.code, name: product.name, latePct: n(product.latePct) } : null,
      effectivePct: l.method === 'FLAT' ? effectiveOfFlat(n(l.ratePct), l.termMonths) : n(l.ratePct),
      totalInterest: r2(s.reduce((a, x) => a + n(x.interest), 0)),
      daysOverdue: o.days,
      overdueAmount: o.amount,
      collectibility: l.status === 'ACTIVE' ? collectOf(o.days) : null,
      bmpp: { ownCapital: equity, exposure: r2(exposure), pct: equity > 0 ? r2((exposure / equity) * 100) : null, limitPct: 15 },
      schedule: s.map((x) => ({
        id: x.id,
        seq: x.seq,
        dueDate: iso(x.dueDate),
        principal: n(x.principal),
        interest: n(x.interest),
        paidPrincipal: n(x.paidPrincipal),
        paidInterest: n(x.paidInterest),
        paidAt: iso(x.paidAt),
      })),
      payments: payments.map((p) => ({ id: p.id, date: iso(p.date), amount: n(p.amount), principal: n(p.principal), interest: n(p.interest), lateFee: n(p.lateFee), status: p.status })),
    };
  }

  /** modal sendiri: equity on the books (simpanan pokok, wajib, reserve, retained and current earnings) */
  private async ownCapital(companyId: string) {
    const r = await this.prisma.$queryRaw<{ v: Prisma.Decimal | null }[]>`
      SELECT SUM(l.credit - l.debit) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId" JOIN accounts a ON a.id = l."accountId"
      WHERE e."companyId" = ${companyId}::uuid AND e.status = 'POSTED' AND a.type IN ('EQUITY', 'INCOME', 'EXPENSE')`;
    return r2(n(r[0]?.v));
  }

  async applyLoan(input: z.infer<typeof loanSchema>) {
    RequestCtx.assert('coop.loan');
    const u = RequestCtx.user();
    const m = await this.prisma.coopMember.findFirst({ where: { id: input.memberId, companyId: u.companyId } });
    if (!m || m.status !== 'ACTIVE') throw invalid({ memberId: 'Loans are for active members (Permenkop UKM 8/2023)' });
    const p = await this.prisma.coopLoanProduct.findFirst({ where: { id: input.productId, companyId: u.companyId, isActive: true } });
    if (!p) throw invalid({ productId: 'Choose a loan product' });
    if (input.termMonths > p.maxTerm) throw invalid({ termMonths: `At most ${p.maxTerm} months on ${p.code}` });
    if (input.firstDue <= input.applicationDate) throw invalid({ firstDue: 'The first instalment falls after the application' });
    const l = await this.prisma.$transaction(async (tx) => {
      const row = await tx.coopLoan.create({
        data: {
          companyId: u.companyId,
          number: await this.sequence.next('COOP_LOAN', u.companyId, input.applicationDate, tx),
          memberId: m.id,
          productId: p.id,
          applicationDate: input.applicationDate,
          principal: D(input.principal),
          ratePct: p.ratePct,
          method: p.method,
          termMonths: input.termMonths,
          firstDue: input.firstDue,
          adminFee: D(r2((input.principal * n(p.adminPct)) / 100)),
          savingDeduction: D(r2((input.principal * n(p.savingPct)) / 100)),
          purpose: input.purpose ?? null,
          collateral: input.collateral ?? null,
          guarantor: input.guarantor ?? null,
          notes: input.notes ?? null,
          createdById: u.id,
        },
      });
      await tx.coopLoanInstallment.createMany({
        data: schedule(input.principal, n(p.ratePct), input.termMonths, p.method, input.firstDue).map((s) => ({
          loanId: row.id,
          seq: s.seq,
          dueDate: s.dueDate,
          principal: D(s.principal),
          interest: D(s.interest),
        })),
      });
      return row;
    });
    await this.audit.record('Coop Loan', l.id, 'CREATE', null, { number: l.number, principal: input.principal });
    return this.loan(l.id);
  }

  /** disbursement: Dr loans / Cr bank (net), admin fee income, the savings deduction into the member's voluntary savings */
  async disburse(id: string, input: z.infer<typeof disburseSchema>) {
    RequestCtx.assert('coop.loan');
    const u = RequestCtx.user();
    const l = await this.prisma.coopLoan.findFirst({ where: { id, companyId: u.companyId } });
    if (!l || l.status !== 'APPLIED') throw new ConflictException('Only an applied loan can be disbursed');
    const m = await this.prisma.coopMember.findUniqueOrThrow({ where: { id: l.memberId } });
    if (m.status !== 'ACTIVE') throw new ConflictException('The member has left');
    const b = await this.bank(u.companyId, input.bankAccountId);
    let vol = null as null | { id: string; number: string };
    if (n(l.savingDeduction) > 0) {
      const prods = await this.prisma.coopSavingProduct.findMany({ where: { companyId: u.companyId, kind: 'VOLUNTARY' } });
      vol = await this.prisma.coopSavingAccount.findFirst({ where: { memberId: m.id, status: 'ACTIVE', productId: { in: prods.map((p) => p.id) } }, select: { id: true, number: true } });
      if (!vol) throw new ConflictException('Open a voluntary savings account for the member first: the loan puts part of it there');
    }
    const net = r2(n(l.principal) - n(l.adminFee) - n(l.savingDeduction));
    await this.prisma.$transaction(async (tx) => {
      const j: PostingLine[] = [
        { key: 'COOP_LOANS', debit: l.principal, description: `${l.number} ${m.number} ${m.name}` },
        { accountId: b.accountId, credit: D(net), description: `Loan ${l.number} paid out` },
      ];
      if (n(l.adminFee) > 0) j.push({ key: 'COOP_LOAN_FEES', credit: l.adminFee, description: `Admin fee ${l.number}` });
      if (vol) {
        await this.move(tx, vol.id, 'LOAN', n(l.savingDeduction), input.date, `Savings from loan ${l.number}`, l.id);
        j.push({ key: 'COOP_SAV_VOLUNTARY', credit: l.savingDeduction, description: `${vol.number} from loan ${l.number}` });
      }
      await this.journal.post(tx, {
        companyId: u.companyId,
        date: input.date,
        description: `Loan ${l.number} to ${m.number} ${m.name}`,
        reference: l.number,
        sourceType: 'COOP_LOAN',
        sourceId: l.id,
        lines: j,
      });
      await tx.coopLoan.update({ where: { id }, data: { status: 'ACTIVE', disbursedAt: input.date, bankAccountId: b.id, outstanding: l.principal } });
    });
    await this.audit.record('Coop Loan', id, 'DISBURSE', null, { net });
    return this.loan(id);
  }

  async cancelLoan(id: string) {
    RequestCtx.assert('coop.loan');
    const u = RequestCtx.user();
    const l = await this.prisma.coopLoan.findFirst({ where: { id, companyId: u.companyId } });
    if (!l || l.status !== 'APPLIED') throw new ConflictException('Only a loan not disbursed can be cancelled');
    await this.prisma.coopLoan.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.record('Coop Loan', id, 'CANCEL');
    return this.loan(id);
  }

  /**
   * Payment: the late charge, then the oldest instalments due (interest then principal), then what is left reduces the
   * principal of the next instalments (their interest is not charged). Paid off: the loan closes.
   */
  async pay(id: string, input: z.infer<typeof paySchema>) {
    RequestCtx.assert('coop.loan');
    const u = RequestCtx.user();
    const l = await this.prisma.coopLoan.findFirst({ where: { id, companyId: u.companyId }, include: { schedule: { orderBy: { seq: 'asc' } } } });
    if (!l || l.status !== 'ACTIVE') throw new ConflictException('Only an active loan takes payments');
    if (input.lateFee >= input.amount) throw invalid({ lateFee: 'The late charge is more than the payment' });
    const b = await this.bank(u.companyId, input.bankAccountId);
    const m = await this.prisma.coopMember.findUniqueOrThrow({ where: { id: l.memberId } });
    let left = r2(input.amount - input.lateFee);
    const alloc: { id: string; principal: number; interest: number }[] = [];
    for (const s of l.schedule.filter((x) => x.dueDate <= input.date)) {
      const i = Math.min(left, r2(n(s.interest) - n(s.paidInterest)));
      left = r2(left - i);
      const p = Math.min(left, r2(n(s.principal) - n(s.paidPrincipal)));
      left = r2(left - p);
      if (i > 0 || p > 0) alloc.push({ id: s.id, principal: p, interest: i });
    }
    for (const s of l.schedule.filter((x) => x.dueDate > input.date)) {
      if (left <= 0) break;
      const p = Math.min(left, r2(n(s.principal) - n(s.paidPrincipal)));
      left = r2(left - p);
      if (p > 0) alloc.push({ id: s.id, principal: p, interest: 0 });
    }
    if (left > 0.004) throw invalid({ amount: `More than the loan: ${r2(input.amount - left).toLocaleString('id-ID')} settles it` });
    const principal = r2(alloc.reduce((s, a) => s + a.principal, 0));
    const interest = r2(alloc.reduce((s, a) => s + a.interest, 0));
    const outstanding = r2(n(l.outstanding) - principal);
    await this.prisma.$transaction(async (tx) => {
      const pmt = await tx.coopLoanPayment.create({
        data: {
          loanId: id,
          date: input.date,
          amount: D(input.amount),
          principal: D(principal),
          interest: D(interest),
          lateFee: D(input.lateFee),
          bankAccountId: b.id,
          allocation: alloc,
          createdById: u.id,
        },
      });
      for (const a of alloc) {
        const s = l.schedule.find((x) => x.id === a.id)!;
        const pp = r2(n(s.paidPrincipal) + a.principal);
        const pi = r2(n(s.paidInterest) + a.interest);
        const done = pp >= n(s.principal) - 0.004 && (pi >= n(s.interest) - 0.004 || s.dueDate > input.date);
        await tx.coopLoanInstallment.update({ where: { id: a.id }, data: { paidPrincipal: D(pp), paidInterest: D(pi), paidAt: done ? input.date : null } });
      }
      const j: PostingLine[] = [{ accountId: b.accountId, debit: D(input.amount), description: `${l.number} ${m.number} ${m.name}` }];
      if (principal > 0) j.push({ key: 'COOP_LOANS', credit: D(principal), description: `Principal ${l.number}` });
      if (interest > 0) j.push({ key: 'COOP_LOAN_INTEREST', credit: D(interest), description: `Interest ${l.number}` });
      if (input.lateFee > 0) j.push({ key: 'COOP_LOAN_FEES', credit: D(input.lateFee), description: `Late charge ${l.number}` });
      await this.journal.post(tx, {
        companyId: u.companyId,
        date: input.date,
        description: `Loan payment ${l.number} ${m.number}`,
        reference: l.number,
        sourceType: 'COOP_LOAN_PAY',
        sourceId: pmt.id,
        lines: j,
      });
      await tx.coopLoan.update({ where: { id }, data: { outstanding: D(outstanding), status: outstanding <= 0.004 ? 'PAID' : 'ACTIVE' } });
    });
    await this.audit.record('Coop Loan', id, 'PAY', null, { amount: input.amount, principal, interest });
    return this.loan(id);
  }

  /** the last payment of a loan, reversed */
  async cancelPayment(paymentId: string) {
    RequestCtx.assert('coop.loan');
    const u = RequestCtx.user();
    const p = await this.prisma.coopLoanPayment.findFirst({ where: { id: paymentId, status: 'POSTED', loan: { companyId: u.companyId } }, include: { loan: true } });
    if (!p) throw new NotFoundException('Payment not found');
    const later = await this.prisma.coopLoanPayment.count({ where: { loanId: p.loanId, status: 'POSTED', createdAt: { gt: p.createdAt } } });
    if (later) throw new ConflictException('Cancel the later payments first');
    await this.prisma.$transaction(async (tx) => {
      for (const a of p.allocation as { id: string; principal: number; interest: number }[]) {
        const s = await tx.coopLoanInstallment.findUniqueOrThrow({ where: { id: a.id } });
        await tx.coopLoanInstallment.update({
          where: { id: a.id },
          data: { paidPrincipal: D(r2(n(s.paidPrincipal) - a.principal)), paidInterest: D(r2(n(s.paidInterest) - a.interest)), paidAt: null },
        });
      }
      await this.journal.voidBySource(tx, 'COOP_LOAN_PAY', p.id);
      await tx.coopLoanPayment.update({ where: { id: p.id }, data: { status: 'CANCELLED' } });
      await tx.coopLoan.update({ where: { id: p.loanId }, data: { outstanding: D(r2(n(p.loan.outstanding) + n(p.principal))), status: 'ACTIVE' } });
    });
    await this.audit.record('Coop Loan', p.loanId, 'PAY_CANCEL', null, { amount: n(p.amount) });
    return this.loan(p.loanId);
  }

  // ------------------------------------------------------------------ collectibility and allowance
  async collectibility() {
    RequestCtx.assert('coop.read');
    const companyId = RequestCtx.companyId();
    const rates = parseRates(await this.settings.str('coop.provisionRates', companyId, '0:1,31:10,91:50,181:100'));
    const loans = await this.prisma.coopLoan.findMany({ where: { companyId, status: 'ACTIVE' }, include: { schedule: true } });
    const members = await this.prisma.coopMember.findMany({ where: { id: { in: loans.map((l) => l.memberId) } }, select: { id: true, number: true, name: true } });
    const t = today();
    const rows = loans.map((l) => {
      const o = this.overdue(l.schedule, t);
      const pct = [...rates].reverse().find((r) => o.days >= r.days)?.pct ?? 0;
      return {
        loanId: l.id,
        number: l.number,
        member: members.find((m) => m.id === l.memberId) ?? null,
        outstanding: n(l.outstanding),
        daysOverdue: o.days,
        overdueAmount: o.amount,
        collectibility: collectOf(o.days),
        pct,
        required: r2((n(l.outstanding) * pct) / 100),
      };
    });
    const acc = await this.prisma.accountMapping.findUnique({ where: { companyId_key: { companyId, key: 'COOP_ALLOWANCE' } } });
    const bal = acc?.accountId ? await this.prisma.journalLine.aggregate({ where: { accountId: acc.accountId, entry: { status: 'POSTED', companyId } }, _sum: { debit: true, credit: true } }) : null;
    const current = bal ? r2(n(bal._sum.credit) - n(bal._sum.debit)) : 0;
    const required = r2(rows.reduce((s, r) => s + r.required, 0));
    const outstanding = r2(rows.reduce((s, r) => s + r.outstanding, 0));
    const npl = r2(rows.filter((r) => r.daysOverdue >= 91).reduce((s, r) => s + r.outstanding, 0));
    return {
      rates,
      rows: rows.sort((a, b) => b.daysOverdue - a.daysOverdue),
      outstanding,
      nplPct: outstanding > 0 ? r2((npl / outstanding) * 100) : 0,
      required,
      current,
      delta: r2(required - current),
    };
  }

  async postProvision(input: { date: Date }) {
    RequestCtx.assert('coop.close');
    const u = RequestCtx.user();
    const c = await this.collectibility();
    if (Math.abs(c.delta) < 0.01) throw new ConflictException('The allowance is up to date');
    await this.prisma.$transaction(async (tx) => {
      const rec = await tx.coopProvision.create({
        data: {
          companyId: u.companyId,
          date: input.date,
          required: D(c.required),
          previous: D(c.current),
          delta: D(c.delta),
          detail: c.rows.map((r) => ({ number: r.number, outstanding: r.outstanding, days: r.daysOverdue, pct: r.pct })),
        },
      });
      const lines: PostingLine[] =
        c.delta > 0
          ? [
              { key: 'COOP_PROVISION', debit: D(c.delta), description: 'Loan loss allowance' },
              { key: 'COOP_ALLOWANCE', credit: D(c.delta), description: 'Loan loss allowance' },
            ]
          : [
              { key: 'COOP_ALLOWANCE', debit: D(-c.delta), description: 'Loan loss allowance released' },
              { key: 'COOP_PROVISION', credit: D(-c.delta), description: 'Loan loss allowance released' },
            ];
      await this.journal.post(tx, {
        companyId: u.companyId,
        date: input.date,
        description: `Loan loss allowance to ${c.required.toLocaleString('id-ID')}`,
        sourceType: 'COOP_PROVISION',
        sourceId: rec.id,
        lines,
      });
    });
    await this.audit.record('Coop Provision', u.companyId, 'CREATE', null, { required: c.required, delta: c.delta });
    return this.collectibility();
  }

  /** write-off of a loss loan: out of the allowance (the rest to the provision expense); the claim on the member stays off the books */
  async writeOff(id: string, input: { date: Date }) {
    RequestCtx.assert('coop.close');
    const u = RequestCtx.user();
    const l = await this.prisma.coopLoan.findFirst({ where: { id, companyId: u.companyId } });
    if (!l || l.status !== 'ACTIVE') throw new ConflictException('Only an active loan');
    const c = await this.collectibility();
    const fromAllowance = Math.min(n(l.outstanding), Math.max(0, c.current));
    await this.prisma.$transaction(async (tx) => {
      const j: PostingLine[] = [];
      if (fromAllowance > 0) j.push({ key: 'COOP_ALLOWANCE', debit: D(fromAllowance), description: `Write-off ${l.number}` });
      if (n(l.outstanding) - fromAllowance > 0) j.push({ key: 'COOP_PROVISION', debit: D(r2(n(l.outstanding) - fromAllowance)), description: `Write-off ${l.number} above the allowance` });
      j.push({ key: 'COOP_LOANS', credit: l.outstanding, description: `Write-off ${l.number}` });
      await this.journal.post(tx, {
        companyId: u.companyId,
        date: input.date,
        description: `Loan ${l.number} written off`,
        reference: l.number,
        sourceType: 'COOP_WRITEOFF',
        sourceId: l.id,
        lines: j,
      });
      await tx.coopLoan.update({ where: { id }, data: { status: 'WRITTEN_OFF', notes: `${l.notes ?? ''}\nWritten off ${iso(input.date)}: ${n(l.outstanding)}`.trim() } });
    });
    await this.audit.record('Coop Loan', id, 'WRITE_OFF', null, { outstanding: n(l.outstanding) });
    return this.loan(id);
  }

  // ------------------------------------------------------------------ SHU
  private async split(companyId: string, given?: number[]) {
    const s = given ?? (await this.settings.str('coop.shuSplit', companyId, '25,20,25,10,5,5,10')).split(',').map(Number);
    if (s.length !== 7 || s.some((x) => !Number.isFinite(x) || x < 0)) throw invalid({ split: 'Seven percentages: reserve, capital, transactions, board, staff, education, social' });
    if (Math.abs(s.reduce((a, b) => a + b, 0) - 100) > 0.001) throw invalid({ split: 'The SHU split must add up to 100%' });
    return s;
  }

  /** SHU of a year (income less expenses, before the year-end closing entry) and its split per member */
  async shuPreview(year: number, shuIn?: number, splitIn?: number[]) {
    RequestCtx.assert('coop.read');
    const companyId = RequestCtx.companyId();
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year, 11, 31));
    const pl = await this.prisma.$queryRaw<{ v: Prisma.Decimal | null }[]>`
      SELECT SUM(l.credit - l.debit) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId" JOIN accounts a ON a.id = l."accountId"
      WHERE e."companyId" = ${companyId}::uuid AND e.status = 'POSTED' AND a.type IN ('INCOME', 'EXPENSE') AND e.date >= ${start} AND e.date <= ${end} AND COALESCE(e."sourceType", '') <> 'CLOSING'`;
    const computed = r2(n(pl[0]?.v));
    const shu = shuIn ?? computed;
    const s = await this.split(companyId, splitIn);
    const part = (k: number) => r2((shu * s[k]) / 100);
    // capital: simpanan pokok + wajib at the year end; transactions: loan interest paid + sales to the member in the year
    const members = await this.prisma.coopMember.findMany({ where: { companyId, joinDate: { lte: end }, OR: [{ leftDate: null }, { leftDate: { gt: end } }] }, orderBy: { number: 'asc' } });
    const capProds = await this.prisma.coopSavingProduct.findMany({ where: { companyId, kind: { in: ['PRINCIPAL', 'MANDATORY'] } }, select: { id: true } });
    const accts = await this.prisma.coopSavingAccount.findMany({
      where: { memberId: { in: members.map((m) => m.id) }, productId: { in: capProds.map((p) => p.id) } },
      select: { id: true, memberId: true },
    });
    const cap = await this.prisma.coopSavingTxn.groupBy({ by: ['accountId'], where: { accountId: { in: accts.map((a) => a.id) }, status: 'POSTED', date: { lte: end } }, _sum: { amount: true } });
    const loanInt = await this.prisma.coopLoanPayment.findMany({
      where: { status: 'POSTED', date: { gte: start, lte: end }, loan: { companyId, memberId: { in: members.map((m) => m.id) } } },
      select: { interest: true, loan: { select: { memberId: true } } },
    });
    const custIds = members.map((m) => m.customerId).filter(Boolean) as string[];
    const sales = custIds.length
      ? await this.prisma.tradeDocument.groupBy({
          by: ['customerId'],
          where: { companyId, docType: 'SI', status: { in: ['CONFIRMED', 'PARTIAL', 'COMPLETED'] }, deletedAt: null, date: { gte: start, lte: end }, customerId: { in: custIds } },
          _sum: { subtotal: true, discountTotal: true },
        })
      : [];
    const rows = members.map((m) => {
      const capitalBase = r2(accts.filter((a) => a.memberId === m.id).reduce((s2, a) => s2 + n(cap.find((c) => c.accountId === a.id)?._sum.amount), 0));
      const sale = sales.find((x) => x.customerId === m.customerId);
      const txnBase = r2(loanInt.filter((x) => x.loan.memberId === m.id).reduce((s2, x) => s2 + n(x.interest), 0) + (sale ? n(sale._sum.subtotal) - n(sale._sum.discountTotal) : 0));
      return { memberId: m.id, member: `${m.number} ${m.name}`, capitalBase, txnBase };
    });
    const spread = (total: number, key: 'capitalBase' | 'txnBase') => {
      const base = rows.reduce((s2, r) => s2 + r[key], 0);
      if (base <= 0) return rows.map(() => 0);
      const out = rows.map((r) => r2((total * r[key]) / base));
      const diff = r2(total - out.reduce((a, b) => a + b, 0));
      if (diff !== 0) {
        let k = 0;
        rows.forEach((r, i) => (r[key] > rows[k][key] ? (k = i) : null));
        out[k] = r2(out[k] + diff);
      }
      return out;
    };
    const capParts = spread(part(1), 'capitalBase');
    const txnParts = spread(part(2), 'txnBase');
    // a part with nobody to receive it stays in the reserve
    const capitalPart = r2(capParts.reduce((a, b) => a + b, 0));
    const txnPart = r2(txnParts.reduce((a, b) => a + b, 0));
    const funds = r2(part(3) + part(4) + part(5) + part(6));
    const reserve = r2(shu - capitalPart - txnPart - funds);
    const run = await this.prisma.coopShuRun.findFirst({ where: { companyId, year, status: 'POSTED' } });
    return {
      year,
      computed,
      shu,
      split: Object.fromEntries(SHU_PARTS.map((k, i) => [k, s[i]])),
      reserve,
      capitalPart,
      txnPart,
      funds,
      fundsDetail: { board: part(3), staff: part(4), education: part(5), social: part(6) },
      members: rows.map((r, i) => ({ ...r, capitalShu: capParts[i], txnShu: txnParts[i], total: r2(capParts[i] + txnParts[i]) })).filter((r) => r.total > 0 || r.capitalBase > 0),
      run: run ? { id: run.id, date: iso(run.date), shu: n(run.shu), payout: run.payout } : null,
    };
  }

  /**
   * Distribution decided by the members meeting (RAT): Dr retained earnings / Cr reserve, funds, and the members' SHU
   * (payable, or credited to their voluntary savings). SHU received by members is not taxable to them (UU PPh Art. 4(3)
   * as amended by UU 6/2023).
   */
  async distributeShu(input: z.infer<typeof shuSchema>) {
    RequestCtx.assert('coop.close');
    const u = RequestCtx.user();
    const pv = await this.shuPreview(input.year, input.shu, input.split);
    if (pv.run) throw new ConflictException(`The SHU of ${input.year} is distributed already`);
    let vol: { id: string; memberId: string }[] = [];
    if (input.payout === 'SAVINGS') {
      const prods = await this.prisma.coopSavingProduct.findMany({ where: { companyId: u.companyId, kind: 'VOLUNTARY' } });
      vol = await this.prisma.coopSavingAccount.findMany({ where: { companyId: u.companyId, status: 'ACTIVE', productId: { in: prods.map((p) => p.id) } }, select: { id: true, memberId: true } });
      const missing = pv.members.find((m) => m.total > 0 && !vol.some((v) => v.memberId === m.memberId));
      if (missing) throw new ConflictException(`${missing.member} has no voluntary savings account to take the SHU`);
    }
    const memberTotal = r2(pv.members.reduce((s, m) => s + m.total, 0));
    const run = await this.prisma.$transaction(async (tx) => {
      const r = await tx.coopShuRun.create({
        data: {
          companyId: u.companyId,
          year: input.year,
          date: input.date,
          shu: D(pv.shu),
          split: pv.split,
          reserve: D(pv.reserve),
          capitalPart: D(pv.capitalPart),
          txnPart: D(pv.txnPart),
          funds: D(pv.funds),
          payout: input.payout,
          ratNotes: input.ratNotes ?? null,
          createdById: u.id,
        },
      });
      await tx.coopShuMember.createMany({
        data: pv.members.map((m) => ({ runId: r.id, memberId: m.memberId, capitalBase: D(m.capitalBase), txnBase: D(m.txnBase), capitalShu: D(m.capitalShu), txnShu: D(m.txnShu), total: D(m.total) })),
      });
      if (input.payout === 'SAVINGS')
        for (const m of pv.members.filter((x) => x.total > 0)) await this.move(tx, vol.find((v) => v.memberId === m.memberId)!.id, 'SHU', m.total, input.date, `SHU ${input.year}`, r.id);
      const j: PostingLine[] = [{ key: 'RETAINED_EARNINGS', debit: D(pv.shu), description: `SHU ${input.year}` }];
      if (pv.reserve > 0) j.push({ key: 'COOP_RESERVE', credit: D(pv.reserve), description: `Dana cadangan ${input.year}` });
      if (pv.funds > 0) j.push({ key: 'COOP_FUNDS', credit: D(pv.funds), description: `Board, staff, education, social funds ${input.year}` });
      if (memberTotal > 0) j.push({ key: input.payout === 'SAVINGS' ? 'COOP_SAV_VOLUNTARY' : 'COOP_SHU_PAYABLE', credit: D(memberTotal), description: `SHU ${input.year} to members` });
      await this.journal.post(tx, {
        companyId: u.companyId,
        date: input.date,
        description: `SHU ${input.year} distributed (RAT)`,
        reference: `SHU ${input.year}`,
        sourceType: 'COOP_SHU',
        sourceId: r.id,
        lines: j,
      });
      return r;
    });
    await this.audit.record('Coop SHU', run.id, 'CREATE', null, { year: input.year, shu: pv.shu });
    return this.shuPreview(input.year, input.shu, input.split);
  }

  async cancelShu(runId: string) {
    RequestCtx.assert('coop.close');
    const u = RequestCtx.user();
    const run = await this.prisma.coopShuRun.findFirst({ where: { id: runId, companyId: u.companyId, status: 'POSTED' } });
    if (!run) throw new NotFoundException('SHU run not found');
    await this.prisma.$transaction(async (tx) => {
      for (const t of await tx.coopSavingTxn.findMany({ where: { sourceId: runId, status: 'POSTED', kind: 'SHU' } })) {
        await this.move(tx, t.accountId, 'SHU', -n(t.amount), t.date, `SHU ${run.year} cancelled`, null);
        await tx.coopSavingTxn.update({ where: { id: t.id }, data: { status: 'CANCELLED' } });
      }
      await tx.coopSavingTxn.updateMany({ where: { reference: `SHU ${run.year} cancelled` }, data: { status: 'CANCELLED' } });
      await this.journal.voidBySource(tx, 'COOP_SHU', runId);
      await tx.coopShuRun.update({ where: { id: runId }, data: { status: 'CANCELLED' } });
    });
    await this.audit.record('Coop SHU', runId, 'CANCEL');
    return this.shuPreview(run.year);
  }
}
