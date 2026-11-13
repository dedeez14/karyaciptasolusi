import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round } from '../../common/utils/money';
import { SettingsService } from '../../common/settings/settings.service';
import { JournalService } from '../accounting/journal.service';
import { localClock } from './pos-pricing';

const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f-]{36}$/i;
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === '' ? null : v), s.nullable().optional());
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const modifierGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  minSelect: z.coerce.number().int().min(0).max(20).default(0),
  maxSelect: z.coerce.number().int().min(0).max(20).default(1),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  options: z
    .array(z.object({ id: opt(z.uuid()), name: z.string().trim().min(1).max(80), price: z.coerce.number().min(0).max(1e10).default(0), productId: opt(z.uuid()), qty: z.coerce.number().positive().max(1e6).default(1), isActive: z.boolean().default(true) }))
    .min(1, 'Add at least one option')
    .max(60),
});
export const productSetupSchema = z.object({ posStation: opt(z.string().trim().max(30)), modifierGroupIds: z.array(z.uuid()).max(20).default([]) });
export const priceItemsSchema = z.object({ items: z.array(z.object({ productId: z.uuid(), price: z.coerce.number().min(0).max(1e12) })).max(5000) });
export const promotionSchema = z
  .object({
    code: z.string().trim().min(1).max(30),
    name: z.string().trim().min(1).max(120),
    type: z.enum(['ITEM_PERCENT', 'ITEM_AMOUNT', 'BUY_X_GET_Y', 'BILL_PERCENT', 'BILL_AMOUNT']),
    value: z.coerce.number().min(0).max(1e12).default(0),
    buyQty: z.coerce.number().int().min(0).max(1000).default(0),
    getQty: z.coerce.number().int().min(0).max(1000).default(0),
    minSpend: z.coerce.number().min(0).max(1e12).default(0),
    maxDiscount: z.coerce.number().min(0).max(1e12).default(0),
    productIds: z.array(z.uuid()).max(500).default([]),
    categoryIds: z.array(z.uuid()).max(200).default([]),
    outletIds: z.array(z.uuid()).max(200).default([]),
    membersOnly: z.boolean().default(false),
    voucherCode: opt(z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/, '3-40 letters / digits')),
    startDate: opt(z.coerce.date()),
    endDate: opt(z.coerce.date()),
    days: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([]),
    timeFrom: opt(hhmm),
    timeTo: opt(hhmm),
    maxUses: z.coerce.number().int().min(0).max(1e9).default(0),
    isActive: z.boolean().default(true),
  })
  .superRefine((p, ctx) => {
    if ((p.type === 'ITEM_PERCENT' || p.type === 'BILL_PERCENT') && (p.value <= 0 || p.value > 100)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage between 0 and 100' });
    if ((p.type === 'ITEM_AMOUNT' || p.type === 'BILL_AMOUNT') && p.value <= 0) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter the discount amount' });
    if (p.type === 'BUY_X_GET_Y' && (p.buyQty < 1 || p.getQty < 1)) ctx.addIssue({ code: 'custom', path: ['buyQty'], message: 'Buy and get quantities of at least 1' });
    if (!!p.timeFrom !== !!p.timeTo) ctx.addIssue({ code: 'custom', path: ['timeTo'], message: 'Give both times of the happy hour' });
    if (p.startDate && p.endDate && p.endDate < p.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Ends before it starts' });
  });
export const memberSchema = z.object({
  name: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(6).max(50),
  email: opt(z.email().max(150)),
  /** UU 27/2022 Art. 20-22: explicit, recorded consent for processing (membership) */
  consent: z.literal(true, { error: 'The member must agree to the processing of their data' }),
  /** separate consent for promotional messages */
  marketingConsent: z.boolean().default(false),
});
export const pointsAdjustSchema = z.object({ points: z.coerce.number().int().min(-1e7).max(1e7).refine((v) => v !== 0, 'Not zero'), reason: z.string().trim().min(3).max(120) });

/** POS master data that needs more than a plain form: modifiers, menu set-up, price list items, promotions, members */
@Injectable()
export class PosSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
  ) {}

  /**
   * Points are deferred revenue at their redemption value (SAK EP: award credits). A manual grant defers more
   * revenue, a deduction or lapsed points release it: Dr / Cr Sales vs Deferred revenue - loyalty points.
   */
  private async postPoints(tx: Prisma.TransactionClient, companyId: string, customerId: string, points: number, reason: string, sourceId: string) {
    const value = D(await this.settings.num('pos.loyaltyPointValue', companyId, 0));
    const amount = round(value.times(Math.abs(points)));
    if (amount.lte(0)) return;
    const tz = (await this.settings.str('general.timezone', companyId, 'Asia/Jakarta')) || 'Asia/Jakarta';
    const date = new Date(localClock(new Date(), tz).date);
    await this.journal.post(tx, {
      companyId,
      branchId: null,
      date,
      description: `Loyalty points: ${reason}`.slice(0, 200),
      reference: 'POINTS',
      sourceType: 'POS_POINTS',
      sourceId,
      lines:
        points > 0
          ? [
              { key: 'SALES', debit: amount, description: `${points} points granted` },
              { key: 'LOYALTY_DEFERRED', credit: amount, customerId },
            ]
          : [
              { key: 'LOYALTY_DEFERRED', debit: amount, customerId },
              { key: 'SALES', credit: amount, description: `${-points} points released` },
            ],
    });
  }

  // ---------------------------------------------------------------- modifiers
  async modifierGroups() {
    RequestCtx.assert('pos.setup');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.posModifierGroup.findMany({ where: { companyId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { options: { orderBy: [{ sortOrder: 'asc' }] }, _count: { select: { products: true } } } });
    return rows.map((g) => ({ ...g, products: g._count.products, options: g.options.map((o) => ({ ...o, price: n(o.price), qty: n(o.qty) })) }));
  }

  private async checkProducts(ids: (string | null | undefined)[]) {
    const list = [...new Set(ids.filter(Boolean) as string[])];
    if (!list.length) return;
    const found = await this.prisma.product.count({ where: { id: { in: list }, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (found !== list.length) throw new BadRequestException('A product was not found');
  }

  async saveModifierGroup(id: string | null, input: z.infer<typeof modifierGroupSchema>) {
    RequestCtx.assert('pos.setup');
    const companyId = RequestCtx.companyId();
    if (input.maxSelect > 0 && input.minSelect > input.maxSelect) throw new BadRequestException({ message: 'Validation failed', errors: { minSelect: 'More than the maximum' } });
    await this.checkProducts(input.options.map((o) => o.productId));
    const group = id ? await this.prisma.posModifierGroup.findFirst({ where: { id, companyId } }) : null;
    if (id && !group) throw new NotFoundException('Modifier group not found');
    const saved = await this.prisma.$transaction(async (tx) => {
      const g = group
        ? await tx.posModifierGroup.update({ where: { id: group.id }, data: { name: input.name, minSelect: input.minSelect, maxSelect: input.maxSelect, sortOrder: input.sortOrder, isActive: input.isActive } })
        : await tx.posModifierGroup.create({ data: { companyId, name: input.name, minSelect: input.minSelect, maxSelect: input.maxSelect, sortOrder: input.sortOrder, isActive: input.isActive } });
      const keep = input.options.filter((o) => o.id).map((o) => o.id!);
      // receipts keep the option name and price they were sold with, so removed options do not change history
      await tx.posModifierOption.deleteMany({ where: { groupId: g.id, id: { notIn: keep } } });
      for (const [i, o] of input.options.entries()) {
        const data = { name: o.name, price: D(o.price), productId: o.productId ?? null, qty: D(o.qty), sortOrder: i, isActive: o.isActive };
        if (o.id) {
          const r = await tx.posModifierOption.updateMany({ where: { id: o.id, groupId: g.id }, data });
          if (!r.count) throw new BadRequestException('An option does not belong to this group');
        } else await tx.posModifierOption.create({ data: { ...data, groupId: g.id } });
      }
      return g;
    });
    await this.audit.record('POS Modifier Group', saved.id, id ? 'UPDATE' : 'CREATE', undefined, { name: input.name, options: input.options.length });
    return saved;
  }

  async deleteModifierGroup(id: string) {
    RequestCtx.assert('pos.setup');
    const r = await this.prisma.posModifierGroup.deleteMany({ where: { id, companyId: RequestCtx.companyId() } });
    if (!r.count) throw new NotFoundException('Modifier group not found');
    await this.audit.record('POS Modifier Group', id, 'DELETE');
    return { ok: true };
  }

  // ---------------------------------------------------------------- menu set-up
  async menu(search?: string) {
    RequestCtx.assert('pos.setup');
    const companyId = RequestCtx.companyId();
    const s = (search ?? '').trim();
    const rows = await this.prisma.product.findMany({
      where: { companyId, deletedAt: null, isActive: true, isSellable: true, ...(s ? { OR: [{ name: { contains: s, mode: 'insensitive' } }, { code: { contains: s, mode: 'insensitive' } }] } : {}) },
      select: { id: true, code: true, name: true, type: true, salePrice: true, posStation: true, category: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take: 500,
    });
    const ids = rows.map((r) => r.id);
    const [links, recipes] = await Promise.all([
      this.prisma.posProductModifier.findMany({ where: { productId: { in: ids } }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.bom.findMany({ where: { companyId, productId: { in: ids }, isActive: true, deletedAt: null }, select: { id: true, code: true, productId: true, backflushOnSale: true } }),
    ]);
    return rows.map((r) => ({
      ...r,
      salePrice: n(r.salePrice),
      category: r.category?.name ?? null,
      modifierGroupIds: links.filter((l) => l.productId === r.id).map((l) => l.groupId),
      recipe: recipes.find((b) => b.productId === r.id && b.backflushOnSale) ?? null,
      boms: recipes.filter((b) => b.productId === r.id).map((b) => ({ id: b.id, code: b.code, backflushOnSale: b.backflushOnSale })),
    }));
  }

  async saveProductSetup(productId: string, input: z.infer<typeof productSetupSchema>) {
    RequestCtx.assert('pos.setup');
    const companyId = RequestCtx.companyId();
    const p = await this.prisma.product.findFirst({ where: { id: productId, companyId, deletedAt: null } });
    if (!p) throw new NotFoundException('Product not found');
    if (input.modifierGroupIds.length && (await this.prisma.posModifierGroup.count({ where: { id: { in: input.modifierGroupIds }, companyId } })) !== new Set(input.modifierGroupIds).size) throw new BadRequestException('A modifier group was not found');
    await this.prisma.$transaction([
      this.prisma.product.update({ where: { id: p.id }, data: { posStation: input.posStation ?? null } }),
      this.prisma.posProductModifier.deleteMany({ where: { productId: p.id } }),
      this.prisma.posProductModifier.createMany({ data: [...new Set(input.modifierGroupIds)].map((groupId, i) => ({ productId: p.id, groupId, sortOrder: i })) }),
    ]);
    await this.audit.record('Product', p.id, 'POS_SETUP', { posStation: p.posStation }, { posStation: input.posStation ?? null, modifierGroups: input.modifierGroupIds.length });
    return { ok: true };
  }

  /** marks a BOM as the recipe used when the product is sold (backflush) */
  async setRecipe(bomId: string, on: boolean) {
    RequestCtx.assert('pos.setup');
    const companyId = RequestCtx.companyId();
    const b = await this.prisma.bom.findFirst({ where: { id: bomId, companyId, deletedAt: null } });
    if (!b) throw new NotFoundException('Bill of materials not found');
    await this.prisma.$transaction([
      ...(on ? [this.prisma.bom.updateMany({ where: { companyId, productId: b.productId, id: { not: b.id } }, data: { backflushOnSale: false } })] : []),
      this.prisma.bom.update({ where: { id: b.id }, data: { backflushOnSale: on } }),
    ]);
    await this.audit.record('Bill of Materials', b.id, 'RECIPE', { backflushOnSale: b.backflushOnSale }, { backflushOnSale: on });
    return { ok: true };
  }

  // ---------------------------------------------------------------- price lists
  async priceItems(priceListId: string) {
    RequestCtx.assert('pos.setup');
    const pl = await this.prisma.priceList.findFirst({ where: { id: priceListId, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!pl) throw new NotFoundException('Price list not found');
    const items = await this.prisma.priceListItem.findMany({ where: { priceListId } });
    return { priceList: pl, items: items.map((i) => ({ productId: i.productId, price: n(i.price) })) };
  }

  async savePriceItems(priceListId: string, input: z.infer<typeof priceItemsSchema>) {
    RequestCtx.assert('pos.setup');
    const pl = await this.prisma.priceList.findFirst({ where: { id: priceListId, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!pl) throw new NotFoundException('Price list not found');
    const ids = [...new Set(input.items.map((i) => i.productId))];
    if (ids.length !== input.items.length) throw new BadRequestException('A product is listed twice');
    await this.checkProducts(ids);
    await this.prisma.$transaction([
      this.prisma.priceListItem.deleteMany({ where: { priceListId } }),
      this.prisma.priceListItem.createMany({ data: input.items.map((i) => ({ priceListId, productId: i.productId, price: D(i.price) })) }),
    ]);
    await this.audit.record('Price List', priceListId, 'UPDATE_PRICES', undefined, { items: input.items.length });
    return { ok: true };
  }

  // ---------------------------------------------------------------- promotions
  async promotions() {
    RequestCtx.assert('pos.setup');
    const rows = await this.prisma.posPromotion.findMany({ where: { companyId: RequestCtx.companyId(), deletedAt: null }, orderBy: [{ isActive: 'desc' }, { code: 'asc' }] });
    return rows.map((p) => ({ ...p, value: n(p.value), minSpend: n(p.minSpend), maxDiscount: n(p.maxDiscount) }));
  }

  async savePromotion(id: string | null, input: z.infer<typeof promotionSchema>) {
    RequestCtx.assert('pos.setup');
    const companyId = RequestCtx.companyId();
    await this.checkProducts(input.productIds);
    if (input.categoryIds.length && (await this.prisma.productCategory.count({ where: { id: { in: input.categoryIds }, companyId } })) !== new Set(input.categoryIds).size) throw new BadRequestException('A category was not found');
    if (input.outletIds.length && (await this.prisma.posOutlet.count({ where: { id: { in: input.outletIds }, companyId } })) !== new Set(input.outletIds).size) throw new BadRequestException('An outlet was not found');
    const dup = await this.prisma.posPromotion.findFirst({ where: { companyId, deletedAt: null, ...(id ? { id: { not: id } } : {}), OR: [{ code: input.code }, ...(input.voucherCode ? [{ voucherCode: input.voucherCode }] : [])] } });
    if (dup) throw new ConflictException(dup.code === input.code ? 'This code is already used' : 'This voucher code is already used');
    const data = { ...input, value: D(input.value), minSpend: D(input.minSpend), maxDiscount: D(input.maxDiscount), voucherCode: input.voucherCode ?? null, startDate: input.startDate ?? null, endDate: input.endDate ?? null, timeFrom: input.timeFrom ?? null, timeTo: input.timeTo ?? null };
    const u = RequestCtx.user();
    let saved;
    if (id) {
      const old = await this.prisma.posPromotion.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!old) throw new NotFoundException('Promotion not found');
      saved = await this.prisma.posPromotion.update({ where: { id }, data: { ...data, updatedById: u.id } });
      await this.audit.record('POS Promotion', id, 'UPDATE', { value: old.value.toString(), isActive: old.isActive }, { value: input.value, isActive: input.isActive });
    } else {
      saved = await this.prisma.posPromotion.create({ data: { ...data, companyId, createdById: u.id } });
      await this.audit.record('POS Promotion', saved.id, 'CREATE', undefined, { code: input.code, type: input.type });
    }
    return saved;
  }

  // ---------------------------------------------------------------- members
  async members(search?: string) {
    if (!RequestCtx.can('pos.member.manage')) RequestCtx.assert('pos.sale.create');
    const companyId = RequestCtx.companyId();
    const s = (search ?? '').trim();
    const rows = await this.prisma.customer.findMany({
      where: { companyId, deletedAt: null, memberNo: { not: null }, ...(s ? { OR: [{ name: { contains: s, mode: 'insensitive' } }, { phone: { contains: s } }, { memberNo: { contains: s, mode: 'insensitive' } }] } : {}) },
      orderBy: { name: 'asc' },
      take: 100,
      select: { id: true, code: true, name: true, phone: true, email: true, memberNo: true, points: true, memberSince: true, marketingConsent: true },
    });
    return rows;
  }

  /** registers a member (a customer with a member number) after recorded consent */
  async createMember(input: z.infer<typeof memberSchema>) {
    if (!RequestCtx.can('pos.member.manage')) RequestCtx.assert('pos.sale.create');
    const u = RequestCtx.user();
    const companyId = u.companyId;
    const exists = await this.prisma.customer.findFirst({ where: { companyId, deletedAt: null, phone: input.phone, memberNo: { not: null } } });
    if (exists) throw new ConflictException(`This phone number is already member ${exists.memberNo}`);
    const now = new Date();
    const c = await this.prisma.$transaction(async (tx) => {
      const code = await this.sequence.next('CUSTOMER', companyId, now, tx);
      const memberNo = await this.sequence.next('POS_MEMBER', companyId, now, tx);
      return tx.customer.create({ data: { companyId, code, name: input.name, phone: input.phone, email: input.email ?? null, memberNo, memberSince: now, consentAt: now, marketingConsent: input.marketingConsent, createdById: u.id } });
    });
    await this.audit.record('Customer', c.id, 'MEMBER_JOIN', undefined, { memberNo: c.memberNo, consentAt: now.toISOString(), marketingConsent: input.marketingConsent });
    return { id: c.id, code: c.code, name: c.name, phone: c.phone, memberNo: c.memberNo, points: c.points };
  }

  async member(id: string) {
    if (!RequestCtx.can('pos.member.manage')) RequestCtx.assert('pos.sale.create');
    if (!UUID.test(id)) throw new NotFoundException('Member not found');
    const c = await this.prisma.customer.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null, memberNo: { not: null } }, select: { id: true, code: true, name: true, phone: true, email: true, memberNo: true, points: true, memberSince: true, consentAt: true, marketingConsent: true } });
    if (!c) throw new NotFoundException('Member not found');
    const history = await this.prisma.posPointEntry.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { ...c, history };
  }

  async adjustPoints(id: string, input: z.infer<typeof pointsAdjustSchema>) {
    RequestCtx.assert('pos.member.manage');
    const u = RequestCtx.user();
    const c = await this.prisma.customer.findFirst({ where: { id, companyId: u.companyId, deletedAt: null, memberNo: { not: null } } });
    if (!c) throw new NotFoundException('Member not found');
    if (c.points + input.points < 0) throw new BadRequestException(`The member has ${c.points} points`);
    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id }, data: { points: { increment: input.points } } });
      const e = await tx.posPointEntry.create({ data: { companyId: u.companyId, customerId: id, points: input.points, reason: input.reason, createdById: u.id } });
      await this.postPoints(tx, u.companyId, id, input.points, input.reason, e.id);
    });
    await this.audit.record('Customer', id, 'POINTS_ADJUST', { points: c.points }, { points: c.points + input.points, reason: input.reason });
    return this.member(id);
  }

  /** member stops: membership and marketing consent are withdrawn (UU PDP Art. 9); points lapse */
  async endMembership(id: string) {
    RequestCtx.assert('pos.member.manage');
    const u = RequestCtx.user();
    const c = await this.prisma.customer.findFirst({ where: { id, companyId: u.companyId, deletedAt: null, memberNo: { not: null } } });
    if (!c) throw new NotFoundException('Member not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id }, data: { memberNo: null, marketingConsent: false, consentAt: null, points: 0 } });
      if (c.points > 0) {
        const e = await tx.posPointEntry.create({ data: { companyId: u.companyId, customerId: id, points: -c.points, reason: 'Membership ended', createdById: u.id } });
        await this.postPoints(tx, u.companyId, id, -c.points, 'membership ended', e.id);
      }
    });
    await this.audit.record('Customer', id, 'MEMBER_END', { memberNo: c.memberNo, points: c.points }, { memberNo: null });
    return { ok: true };
  }
}
