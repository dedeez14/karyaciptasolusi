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
