import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';

const UUID = /^[0-9a-f-]{36}$/i;
type Subject = 'LEAD' | 'CUSTOMER' | 'EMPLOYEE';

/**
 * UU 27/2022 Pelindungan Data Pribadi: give a person a copy of their data (access / portability),
 * remove it on request (deletion) and after the retention period. Financial records (invoices, payroll journals)
 * are kept: tax law requires them for 10 years (UU KUP Pasal 28), so only the personal details are blanked.
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
  ) {}

  private check(type: string, id: string): Subject {
    if (!['LEAD', 'CUSTOMER', 'EMPLOYEE'].includes(type)) throw new BadRequestException('Choose lead, customer or employee');
    if (!UUID.test(id)) throw new BadRequestException('Invalid record ID');
    return type as Subject;
  }

  /** everything held about one person, in a portable JSON form (access / portability request) */
  async export(typeRaw: string, id: string) {
    RequestCtx.assert('system.privacy.read');
    const type = this.check(typeRaw, id);
    const companyId = RequestCtx.companyId();
    const dec = (v: string | null | undefined) => (v ? this.crypto.decrypt(v) : null);
    let data: Record<string, unknown>;
    if (type === 'LEAD') {
      const lead = await this.prisma.lead.findFirst({ where: { id, companyId } });
      if (!lead) throw new NotFoundException('Lead not found');
      const [activities, emails] = await Promise.all([
        this.prisma.crmActivity.findMany({ where: { companyId, leadId: id, deletedAt: null }, select: { subject: true, typeCode: true, dueDate: true, notes: true, createdAt: true } }),
        lead.email ? this.prisma.emailRecipient.findMany({ where: { companyId, email: lead.email.toLowerCase() }, select: { campaignId: true, statusCode: true, sentAt: true, openedAt: true, repliedAt: true } }) : [],
      ]);
      data = {
        lead: { code: lead.code, name: lead.name, companyName: lead.companyName, email: lead.email, phone: lead.phone, website: lead.website, address: lead.address, source: lead.sourceCode, status: lead.statusCode, notes: lead.notes, consentAt: lead.consentAt, consentText: lead.consentText, createdAt: lead.createdAt },
        activities,
        emailCampaigns: emails,
      };
    } else if (type === 'CUSTOMER') {
      const c = await this.prisma.customer.findFirst({ where: { id, companyId } });
      if (!c) throw new NotFoundException('Customer not found');
      const activities = await this.prisma.crmActivity.findMany({ where: { companyId, customerId: id, deletedAt: null }, select: { subject: true, typeCode: true, dueDate: true, notes: true, createdAt: true } });
      data = { customer: { code: c.code, name: c.name, contactPerson: c.contactPerson, email: c.email, phone: c.phone, npwp: dec(c.taxId), address: dec(c.address), city: c.city, notes: c.notes, createdAt: c.createdAt }, activities };
    } else {
      RequestCtx.assert('hris.employee.read');
      const e = await this.prisma.employee.findFirst({ where: { id, companyId } });
      if (!e) throw new NotFoundException('Employee not found');
      const [leave, attendance, payslips] = await Promise.all([
        this.prisma.leaveRequest.findMany({ where: { companyId, employeeId: id, deletedAt: null }, select: { startDate: true, endDate: true, days: true, status: true, reason: true } }),
        this.prisma.attendance.findMany({ where: { companyId, employeeId: id, deletedAt: null }, select: { date: true, checkIn: true, checkOut: true, statusCode: true }, orderBy: { date: 'desc' }, take: 400 }),
        this.prisma.payslip.findMany({ where: { employeeId: id, payrollRun: { companyId, deletedAt: null } }, select: { baseSalary: true, totalEarning: true, totalDeduction: true, netPay: true, lines: true, payrollRun: { select: { number: true, periodStart: true, periodEnd: true } } } }),
      ]);
      data = {
        employee: {
          code: e.code, fullName: e.fullName, email: e.email, phone: e.phone, nik: dec(e.identityNo), npwp: dec(e.taxNo), bankName: e.bankName, bankAccountNo: dec(e.bankAccountNo),
          gender: e.genderCode, religion: e.religionCode, maritalStatus: e.maritalCode, ptkp: e.ptkpCode, birthPlace: e.birthPlace, birthDate: e.birthDate, address: dec(e.address),
          joinDate: e.joinDate, endDate: e.endDate, bpjsKesehatanNo: e.bpjsKesNo, bpjsKetenagakerjaanNo: e.bpjsTkNo,
        },
        leave,
        attendance,
        payslips,
      };
    }
    await this.audit.record('Personal Data', id, 'EXPORT', undefined, { subjectType: type });
    return { exportedAt: new Date(), subjectType: type, controller: (await this.prisma.company.findUnique({ where: { id: companyId }, select: { legalName: true, name: true } })) ?? null, data };
  }

  /** blank the personal details of a lead / customer contact (deletion request or end of retention) */
  async anonymize(typeRaw: string, id: string, reason = 'request') {
    const type = this.check(typeRaw, id);
    if (reason === 'request') RequestCtx.assert('system.privacy.update');
    const companyId = RequestCtx.companyId();
    if (type === 'LEAD') {
      const lead = await this.prisma.lead.findFirst({ where: { id, companyId } });
      if (!lead) throw new NotFoundException('Lead not found');
      if (lead.anonymizedAt) return { ok: true, already: true };
      await this.prisma.$transaction(async (tx) => {
        await tx.lead.update({ where: { id }, data: { name: `Removed (${lead.code})`, companyName: null, email: null, phone: null, website: null, address: null, mapsUrl: null, notes: null, consentText: null, anonymizedAt: new Date() } });
        await tx.crmActivity.updateMany({ where: { companyId, leadId: id }, data: { notes: null } });
        if (lead.email) await tx.emailRecipient.updateMany({ where: { companyId, email: lead.email.toLowerCase() }, data: { name: null, data: undefined } });
        await this.audit.record('Lead', id, 'ANONYMIZE', { code: lead.code }, { reason }, tx);
      });
      return { ok: true };
    }
    if (type === 'CUSTOMER') {
      // the company name, NPWP and address stay on issued invoices (tax records); the contact person is removed
      const c = await this.prisma.customer.findFirst({ where: { id, companyId } });
      if (!c) throw new NotFoundException('Customer not found');
      await this.prisma.customer.update({ where: { id }, data: { contactPerson: null, email: null, phone: null, notes: null } });
      await this.audit.record('Customer', id, 'ANONYMIZE', { code: c.code }, { reason, kept: 'name, NPWP and address on tax documents' });
      return { ok: true, kept: 'Company name, NPWP and address are kept because issued invoices must be stored for 10 years (UU KUP Pasal 28).' };
    }
    throw new BadRequestException('Employee data is kept for payroll and tax records (10 years); deactivate the employee instead and remove only what is not needed.');
  }

  /** nightly: leads that never became customers and were untouched for the retention period */
  async purgeInactiveLeads(companyId: string) {
    const months = await this.settings.num('privacy.leadRetentionMonths', companyId, 24);
    if (!months || months <= 0) return 0;
    const before = new Date();
    before.setMonth(before.getMonth() - months);
    const stale = await this.prisma.lead.findMany({ where: { companyId, customerId: null, anonymizedAt: null, deletedAt: null, updatedAt: { lt: before } }, select: { id: true }, take: 500 });
    for (const l of stale) await this.anonymize('LEAD', l.id, 'retention');
    return stale.length;
  }
}
