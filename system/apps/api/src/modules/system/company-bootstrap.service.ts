import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Tx } from '../../common/prisma/prisma.service';
import {
  ACCOUNT_MAPPING_TEMPLATE,
  COA_TEMPLATE,
  LEAVE_TEMPLATE,
  PAYMENT_TERM_TEMPLATE,
  POSITION_TEMPLATE,
  SALARY_COMPONENT_TEMPLATE,
  SEQUENCE_TEMPLATE,
  SIMPLE_TEMPLATE,
  STAGE_TEMPLATE,
  TAX_TEMPLATE,
  TASK_STAGE_TEMPLATE,
} from './templates/company-template';

type Db = Tx | PrismaClient;

/**
 * Provisions a new company with a complete, ready-to-use default setup
 * (head office, chart of accounts, posting accounts, numbering, taxes, ...).
 * Idempotent: only missing records are created. Used by the seed and by "Create Company".
 */
@Injectable()
export class CompanyBootstrapService {
  async bootstrap(db: Db, companyId: string, userId?: string) {
    const c = { companyId, createdById: userId };

    let ho = await db.branch.findFirst({ where: { companyId, isHeadOffice: true } });
    if (!ho) ho = await db.branch.create({ data: { ...c, code: 'HO', name: 'Head Office', isHeadOffice: true } });

    // Chart of accounts (parents first)
    const ids = new Map<string, string>();
    for (const a of await db.account.findMany({ where: { companyId }, select: { id: true, code: true } })) ids.set(a.code, a.id);
    for (const [code, name, type, parent, isGroup] of COA_TEMPLATE) {
      if (ids.has(code)) continue;
      const row = await db.account.create({ data: { ...c, code, name, type, isGroup: !!isGroup, parentId: parent ? ids.get(parent) : null } });
      ids.set(code, row.id);
    }
    for (const [key, name, code] of ACCOUNT_MAPPING_TEMPLATE) {
      await db.accountMapping.upsert({ where: { companyId_key: { companyId, key } }, create: { ...c, key, name, accountId: ids.get(code) }, update: {} });
    }
    for (const [code, name, prefix, resetPeriod] of SEQUENCE_TEMPLATE) {
      await db.numberSequence.upsert({ where: { companyId_code: { companyId, code } }, create: { companyId, code, name, prefix, resetPeriod, padding: 5 }, update: {} });
    }
    for (const [code, name, rate] of TAX_TEMPLATE) {
      await db.tax.upsert({ where: { companyId_code: { companyId, code } }, create: { ...c, code, name, rate, salesAccountId: ids.get('2-1300'), purchaseAccountId: ids.get('1-1500') }, update: {} });
    }
    for (const [code, name, days] of PAYMENT_TERM_TEMPLATE) {
      await db.paymentTerm.upsert({ where: { companyId_code: { companyId, code } }, create: { ...c, code, name, days }, update: {} });
    }
    const simple: [keyof typeof SIMPLE_TEMPLATE, any][] = [
      ['uom', db.uom],
      ['paymentMethod', db.paymentMethod],
      ['customerGroup', db.customerGroup],
      ['supplierGroup', db.supplierGroup],
      ['productCategory', db.productCategory],
      ['department', db.department],
      ['costCenter', db.costCenter],
    ];
    for (const [key, delegate] of simple) {
      for (const [code, name] of SIMPLE_TEMPLATE[key]) {
        await delegate.upsert({ where: { companyId_code: { companyId, code } }, create: { ...c, code, name }, update: {} });
      }
    }
    for (const [code, name, probability, isWon, isLost] of STAGE_TEMPLATE) {
      await db.pipelineStage.upsert({ where: { companyId_code: { companyId, code } }, create: { ...c, code, name, probability, isWon, isLost, sortOrder: isLost ? 1000 : isWon ? 900 : probability }, update: {} });
    }
    for (const [code, name, levelCode] of POSITION_TEMPLATE) {
      await db.position.upsert({ where: { companyId_code: { companyId, code } }, create: { ...c, code, name, levelCode }, update: {} });
    }
    for (const [code, name, daysPerYear, isPaid] of LEAVE_TEMPLATE) {
      await db.leaveType.upsert({ where: { companyId_code: { companyId, code } }, create: { ...c, code, name, daysPerYear, isPaid }, update: {} });
    }
    for (const [code, name, kind, calcType, amount] of SALARY_COMPONENT_TEMPLATE) {
      await db.salaryComponent.upsert({
        where: { companyId_code: { companyId, code } },
        create: { ...c, code, name, kind, calcType, amount, accountId: kind === 'DEDUCTION' ? ids.get('2-1500') : ids.get('6-1100') },
        update: {},
      });
    }
    await db.warehouse.upsert({ where: { companyId_code: { companyId, code: 'WH-MAIN' } }, create: { ...c, code: 'WH-MAIN', name: 'Main Warehouse', branchId: ho.id }, update: {} });
    await db.bankAccount.upsert({ where: { companyId_code: { companyId, code: 'CASH' } }, create: { ...c, code: 'CASH', name: 'Petty Cash', isCash: true, accountId: ids.get('1-1100') }, update: {} });
    await db.bankAccount.upsert({ where: { companyId_code: { companyId, code: 'BANK-01' } }, create: { ...c, code: 'BANK-01', name: 'Operational Bank Account', accountId: ids.get('1-1200') }, update: {} });

    let order = 0;
    for (const [code, name, color, isDone] of TASK_STAGE_TEMPLATE) {
      order += 10;
      await db.taskStage.upsert({ where: { companyId_code: { companyId, code } }, create: { ...c, code, name, color, isDone, sortOrder: order }, update: {} });
    }

    const year = new Date().getFullYear();
    await db.fiscalPeriod.upsert({
      where: { companyId_name: { companyId, name: `FY ${year}` } },
      create: { ...c, name: `FY ${year}`, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
      update: {},
    });
    return ho;
  }
}
