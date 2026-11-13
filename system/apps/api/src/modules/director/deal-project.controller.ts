import { BadRequestException, Body, ConflictException, Controller, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Activity } from '../../common/decorators';
import { RequestCtx } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { ResourceService } from '../resources/resource.service';
import { MilestoneController } from '../projects/milestone.controller';

const PRESETS: Record<string, [string, number, string][]> = {
  '30-40-30': [
    ['Uang muka', 30, 'Setelah perjanjian ditandatangani'],
    ['Termin 2 - demo / versi uji', 40, 'Setelah demo disetujui'],
    ['Pelunasan', 30, 'Setelah BAST ditandatangani'],
  ],
  '50-50': [
    ['Uang muka', 50, 'Setelah perjanjian ditandatangani'],
    ['Pelunasan', 50, 'Setelah BAST ditandatangani'],
  ],
  '100': [['Pembayaran penuh', 100, 'Setelah BAST ditandatangani']],
  none: [],
};
const body = z.object({
  preset: z.enum(['30-40-30', '50-50', '100', 'none']).default('30-40-30'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

/**
 * A won deal becomes a project in one step: the project for the customer with the deal amount as contract value,
 * billing milestones from a payment scheme, and the deal moved to the won stage.
 */
@Controller('crm/opportunities')
export class DealProjectController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly resources: ResourceService,
    private readonly milestones: MilestoneController,
  ) {}

  @Post(':id/to-project')
  @Activity('crm.opportunity.to-project')
  async toProject(@Param('id', ParseUUIDPipe) id: string, @Body() raw: unknown) {
    RequestCtx.assert('crm.opportunity.update');
    RequestCtx.assert('master.project.create');
    const r = body.safeParse(raw ?? {});
    if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Invalid data');
    const companyId = RequestCtx.companyId();
    const o = await this.prisma.opportunity.findFirst({ where: { ...(this.access.scopeWhere({ branchField: 'branchId', ownerField: 'ownerId' }) as Prisma.OpportunityWhereInput), id, deletedAt: null } });
    if (!o) throw new NotFoundException('Deal not found');

    // the customer: on the deal, or the customer its lead was converted into
    let customerId = o.customerId;
    if (!customerId && o.leadId) customerId = (await this.prisma.lead.findFirst({ where: { id: o.leadId, companyId }, select: { customerId: true } }))?.customerId ?? null;
    if (!customerId) throw new ConflictException('Set the customer of the deal first (or convert its lead to a customer)');

    const existing = await this.prisma.project.findFirst({ where: { companyId, deletedAt: null, description: { contains: `[deal:${o.code}]` } }, select: { id: true, code: true } });
    if (existing) throw new ConflictException(`Deal ${o.code} already has project ${existing.code}`);

    const amount = Number(o.amount);
    const project = await this.resources.create('projects', {
      name: o.name,
      customerId,
      startDate: r.data.startDate || new Date().toISOString().slice(0, 10),
      contractValue: amount,
      description: `Dari deal ${o.code} [deal:${o.code}]${o.notes ? `\n\n${o.notes}` : ''}`,
    });
    const projectId = String(project.id);

    const parts = PRESETS[r.data.preset];
    if (amount > 0 && parts.length) {
      const ms = parts.map(([name, pct, trigger]) => ({ name, percent: pct, amount: Math.round(amount * pct) / 100, trigger }));
      const diff = Math.round((amount - ms.reduce((a, m) => a + m.amount, 0)) * 100) / 100;
      ms[ms.length - 1].amount = Math.round((ms[ms.length - 1].amount + diff) * 100) / 100;
      await this.milestones.save(projectId, { contractValue: amount, milestones: ms });
    }

    // move the deal to the won stage
    const won = await this.prisma.pipelineStage.findFirst({ where: { companyId, isWon: true, deletedAt: null }, orderBy: { sortOrder: 'asc' }, select: { id: true } }).catch(() => null);
    await this.prisma.opportunity.update({ where: { id: o.id }, data: { ...(won ? { stageId: won.id } : {}), probability: 100, customerId, updatedById: RequestCtx.user().id } });
    await this.audit.record('Opportunity', o.id, 'TO_PROJECT', undefined, { project: project.code, projectId, amount, preset: r.data.preset });
    return { projectId, code: project.code, customerId };
  }
}
