import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Tx } from '../../common/prisma/prisma.service';
import { RequestCtx } from '../../common/context/request-context';
import { AccessService } from '../../common/access/access.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { CompanyBootstrapService } from '../system/company-bootstrap.service';
import { ResourceDef } from './resource.types';
import { SYSTEM_LOOKUPS } from './resource.registry';

type Row = Record<string, any>;

/** Resource specific business rules plugged into the generic engine. */
@Injectable()
export class ResourceHooks {
  constructor(
    private readonly bootstrap: CompanyBootstrapService,
    private readonly access: AccessService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** "001/SR/KCS/XI/2026": running number per year / type code / company code / month in roman numerals / year */
  private async letterNumber(type: string, date: Date) {
    const companyId = RequestCtx.companyId();
    const year = date.getUTCFullYear();
    const ABBR: Record<string, string> = { RECOMMENDATION: 'SR', STATEMENT: 'SKET', EMPLOYMENT: 'SKK', INCOME: 'SKP', ASSIGNMENT: 'ST', POWER_OF_ATTORNEY: 'SKU', DECLARATION: 'SPN', APPOINTMENT: 'SK', OFFER: 'OL', CONTRACT: 'PKWT', WARNING: 'SP', REFERENCE: 'SRK', HANDOVER: 'BAST', INVITATION: 'UND', MEMO: 'MEMO', MINUTES: 'NOT', PROJECT_AGREEMENT: 'PKS', NDA: 'NDA', WORK_ORDER: 'SPK', PAYMENT_REMINDER: 'STG', RESIGNATION: 'SPR', LEAVE_PERMIT: 'SIC', OTHER: 'SU' };
    const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { code: true } });
    const seq = await this.prisma.numberSequence.upsert({
      where: { companyId_code: { companyId, code: 'LETTER' } },
      create: { companyId, code: 'LETTER', name: 'Company letters', prefix: '', padding: 3, resetPeriod: 'YEARLY' },
      update: {},
    });
    const period = String(year);
    const row = await this.prisma.numberSequencePeriod.upsert({
      where: { sequenceId_period: { sequenceId: seq.id, period } },
      create: { sequenceId: seq.id, period, nextNumber: 2 },
      update: { nextNumber: { increment: 1 } },
    });
    const n = row.nextNumber - 1;
    return `${String(n).padStart(seq.padding, '0')}/${ABBR[type] ?? 'SU'}/${company?.code ?? 'CO'}/${ROMAN[date.getUTCMonth()]}/${year}`;
  }

  /** Working days between two dates (inclusive): work days from settings, public holidays excluded */
  private async leaveDays(companyId: string, startDate: unknown, endDate: unknown) {
    const start = new Date(startDate as string);
    const end = new Date(endDate as string);
    const work = new Set(
      (await this.settings.str('hris.workDays', companyId, '1,2,3,4,5'))
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((x) => x >= 1 && x <= 7),
    );
    const holidays = await this.prisma.holiday.findMany({ where: { companyId, isActive: true, deletedAt: null, date: { gte: start, lte: end } }, select: { date: true } });
    const off = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
    let n = 0;
    for (const d = new Date(start); d <= end && n < 400; d.setUTCDate(d.getUTCDate() + 1)) {
      const weekday = ((d.getUTCDay() + 6) % 7) + 1;
      if (work.has(weekday) && !off.has(d.toISOString().slice(0, 10))) n++;
    }
    return n;
  }

  private async fillLeaveDays(data: Row) {
    if (data.days) return;
    data.days = await this.leaveDays(RequestCtx.companyId(), data.startDate, data.endDate);
    if (!data.days) throw new BadRequestException({ message: 'Validation failed', errors: { days: 'The selected dates contain no working days' } });
  }

  /** Called after an update payload is parsed (before it is saved) */
  async prepareUpdate(def: ResourceDef, before: Row, data: Row) {
    if (def.key === 'leave-requests' && (data.startDate || data.endDate) && !data.days) {
      const merged = { startDate: data.startDate ?? before.startDate, endDate: data.endDate ?? before.endDate };
      if (new Date(merged.endDate) < new Date(merged.startDate)) throw new BadRequestException('End date must be after start date');
      await this.fillLeaveDays(Object.assign(data, { startDate: merged.startDate, endDate: merged.endDate }));
    }
  }

  async beforeCreate(def: ResourceDef, data: Row) {
    switch (def.key) {
      case 'letters':
        data.number = await this.letterNumber(String(data.letterType ?? 'OTHER'), data.letterDate ? new Date(String(data.letterDate)) : new Date());
        break;
      case 'companies':
        if (!RequestCtx.user().isSuperAdmin) throw new BadRequestException('Only a super administrator can create companies');
        if (data.code) data.code = String(data.code).toUpperCase();
        break;
      case 'leave-requests':
        data.status = 'PENDING';
        if (new Date(data.endDate) < new Date(data.startDate)) throw new BadRequestException('End date must be after start date');
        await this.fillLeaveDays(data);
        break;
      case 'lookups':
        data.category = String(data.category).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        if (SYSTEM_LOOKUPS.has(data.category)) throw new BadRequestException('This is a system list: values can be renamed or re-ordered, but not added');
        data.code = String(data.code).replace(/\s+/g, '_');
        break;
      case 'currencies':
      case 'countries':
        data.code = String(data.code).toUpperCase();
        break;
    }
  }

  async afterCreate(def: ResourceDef, row: Row, tx: Tx) {
    if (def.key === 'companies') {
      await this.bootstrap.bootstrap(tx, row.id, RequestCtx.user().id);
      this.access.invalidateUser();
    }
  }

  async beforeUpdate(def: ResourceDef, before: Row) {
    if (def.key === 'leave-requests' && before.status !== 'PENDING') throw new ConflictException('Only pending leave requests can be edited');
    if (def.key === 'fiscal-periods' && before.isClosed) throw new ConflictException('A closed fiscal period cannot be edited. Reopen it first.');
  }

  async beforeDelete(def: ResourceDef, before: Row) {
    if (def.key === 'leave-requests' && before.status !== 'PENDING') throw new ConflictException('Only pending leave requests can be deleted');
    if (def.key === 'branches' && before.isHeadOffice) throw new ConflictException('The head office branch cannot be deleted');
    if (def.key === 'companies' && before.id === RequestCtx.companyId()) throw new ConflictException('You cannot delete the company you are working in');
    if (def.key === 'lookups' && SYSTEM_LOOKUPS.has(before.category)) throw new ConflictException('System list values cannot be deleted. Deactivate it instead.');
  }
}
