import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Tx } from '../../common/prisma/prisma.service';
import { RequestCtx } from '../../common/context/request-context';
import { AccessService } from '../../common/access/access.service';
import { CompanyBootstrapService } from '../system/company-bootstrap.service';
import { ResourceDef } from './resource.types';
import { SYSTEM_LOOKUPS } from './resource.registry';

type Row = Record<string, any>;

/** Resource specific business rules plugged into the generic engine. */
@Injectable()
export class ResourceHooks {
  constructor(private readonly bootstrap: CompanyBootstrapService, private readonly access: AccessService) {}

  async beforeCreate(def: ResourceDef, data: Row) {
    switch (def.key) {
      case 'companies':
        if (!RequestCtx.user().isSuperAdmin) throw new BadRequestException('Only a super administrator can create companies');
        if (data.code) data.code = String(data.code).toUpperCase();
        break;
      case 'leave-requests':
        data.status = 'PENDING';
        if (new Date(data.endDate) < new Date(data.startDate)) throw new BadRequestException('End date must be after start date');
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
