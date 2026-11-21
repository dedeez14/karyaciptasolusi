import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Permission } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { FinanceInsightsService } from './finance.insights';
import { CommercialInsightsService } from './commercial.insights';
import { HrInsightsService } from './hr.insights';

const docsSchema = z.object({
  docType: z.string().regex(/^[A-Z]{2,4}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Read-only aggregates behind the purpose-built master data views.
 * Each route requires the read permission of the underlying resource; nested figures are only
 * returned when the user also holds the permission of that data (journals, stock, payroll, ...).
 */
@Controller('insights')
export class InsightsController {
  constructor(private readonly fin: FinanceInsightsService, private readonly com: CommercialInsightsService, private readonly hr: HrInsightsService) {}

  // ---- accounting / treasury / inventory
  @Permission('accounting.account.read')
  @Get('accounts/tree')
  accounts(@Query('asOf') asOf?: string) {
    return this.fin.accountTree(asOf);
  }

  @Permission('master.bank-account.read')
  @Get('bank-accounts')
  banks(@Query('ids') ids?: string) {
    return this.fin.bankAccounts(ids);
  }

  @Permission('master.warehouse.read')
  @Get('warehouses')
  warehouses() {
    return this.fin.warehouses();
  }

  @Permission('accounting.closing.close')
  @Post('fiscal-periods/:id/close')
  closePeriod(@Param('id') id: string) {
    return this.fin.setPeriodClosed(id, true);
  }

  @Permission('accounting.closing.reopen')
  @Post('fiscal-periods/:id/reopen')
  reopenPeriod(@Param('id') id: string) {
    return this.fin.setPeriodClosed(id, false);
  }

  // ---- customers / suppliers
  @Permission('master.customer.read')
  @Get('customers/:id')
  customer(@Param('id') id: string) {
    return this.com.partner('customer', id);
  }

  @Permission('master.customer.read')
  @Get('customers/:id/documents')
  customerDocs(@Param('id') id: string, @Query(new ZodPipe(docsSchema)) q: z.infer<typeof docsSchema>) {
    return this.com.partnerDocuments('customer', id, q);
  }

  @Permission('master.supplier.read')
  @Get('suppliers/:id')
  supplier(@Param('id') id: string) {
    return this.com.partner('supplier', id);
  }

  @Permission('master.supplier.read')
  @Get('suppliers/:id/documents')
  supplierDocs(@Param('id') id: string, @Query(new ZodPipe(docsSchema)) q: z.infer<typeof docsSchema>) {
    return this.com.partnerDocuments('supplier', id, q);
  }

  // ---- products
  @Permission('master.product.read')
  @Get('products/stock')
  productStock(@Query('ids') ids?: string) {
    return this.com.productStock(ids);
  }

  @Permission('master.product.read')
  @Get('products/:id')
  product(@Param('id') id: string) {
    return this.com.product(id);
  }

  // ---- CRM / projects
  @Permission('crm.campaign.read')
  @Get('campaigns')
  campaigns() {
    return this.com.campaigns();
  }

  @Permission('master.project.read')
  @Get('projects/stats')
  projectStats(@Query('ids') ids?: string) {
    return this.com.projectStats(ids);
  }

  @Permission('master.project.read')
  @Get('projects/:id')
  project(@Param('id') id: string) {
    return this.com.project(id);
  }

  // ---- HR
  @Permission('hris.employee.read')
  @Get('employees/:id')
  employee(@Param('id') id: string, @Query('month') month?: string) {
    return this.hr.employee(id, month);
  }

  @Permission('hris.department.read')
  @Get('departments')
  departments() {
    return this.hr.departments();
  }

  @Permission('hris.leave.read')
  @Get('leave/calendar')
  leave(@Query('month') month?: string, @Query('status') status?: string) {
    return this.hr.leaveCalendar(month, status);
  }
}
