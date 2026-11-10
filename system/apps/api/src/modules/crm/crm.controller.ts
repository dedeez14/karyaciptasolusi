import { ConflictException, Controller, NotFoundException, Param, Post } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { RequestCtx } from '../../common/context/request-context';

@Controller('crm')
export class CrmController {
  constructor(private readonly prisma: PrismaService, private readonly sequence: SequenceService, private readonly audit: AuditService, private readonly access: AccessService) {}

  /** Converts a qualified lead into a customer (and an opportunity when it has an estimated value) */
  @Post('leads/:id/convert')
  async convert(@Param('id') id: string) {
    RequestCtx.assert('crm.lead.update');
    RequestCtx.assert('master.customer.create');
    const u = RequestCtx.user();
    const lead = await this.prisma.lead.findFirst({ where: { id, ...(this.access.scopeWhere({ branchField: 'branchId', ownerField: 'ownerId' }) as any), deletedAt: null } });
    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.customerId) throw new ConflictException('Lead is already converted');
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          companyId: u.companyId,
          code: await this.sequence.next('CUSTOMER', u.companyId, new Date(), tx),
          name: lead.companyName || lead.name,
          contactPerson: lead.companyName ? lead.name : null,
          email: lead.email,
          phone: lead.phone,
          industryCode: lead.industryCode,
          notes: lead.notes,
          createdById: u.id,
        },
      });
      let opportunity = null;
      if (Number(lead.estimatedValue) > 0) {
        const stage = await tx.pipelineStage.findFirst({ where: { companyId: u.companyId, isWon: false, isLost: false, deletedAt: null }, orderBy: { sortOrder: 'asc' } });
        opportunity = await tx.opportunity.create({
          data: {
            companyId: u.companyId,
            branchId: lead.branchId,
            code: await this.sequence.next('OPPORTUNITY', u.companyId, new Date(), tx),
            name: `${customer.name} - opportunity`,
            leadId: lead.id,
            customerId: customer.id,
            stageId: stage?.id,
            probability: stage?.probability ?? 0,
            amount: lead.estimatedValue,
            ownerId: lead.ownerId ?? u.id,
            createdById: u.id,
          },
        });
      }
      const converted = await tx.lookupValue.findFirst({ where: { category: 'LEAD_STATUS', code: 'CONVERTED' } });
      const after = await tx.lead.update({ where: { id }, data: { customerId: customer.id, statusCode: converted ? 'CONVERTED' : lead.statusCode, updatedById: u.id } });
      await this.audit.record('Lead', id, 'CONVERT', lead, after, tx);
      return { customer, opportunity };
    });
  }
}
