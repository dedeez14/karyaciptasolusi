import { Controller, Get, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestCtx } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { AccessService } from '../../common/access/access.service';

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v ?? 0) || 0;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utcDay = (d = new Date()) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export interface Obligation {
  date: string;
  kind: 'TAX' | 'BPJS' | 'CONTRACT' | 'RECEIVABLE' | 'PAYABLE' | 'MILESTONE' | 'SUBSCRIPTION';
  title: string;
  detail?: string;
  amount?: number;
  link?: string;
  /** OVERDUE, SOON (within 7 days) or LATER */
  urgency: 'OVERDUE' | 'SOON' | 'LATER';
}

/**
 * The director's calendar of obligations: statutory deadlines (monthly tax payment and filing, BPJS contributions,
 * annual corporate tax return) and business deadlines from the data (contracts ending, invoices and bills due,
 * milestones to invoice, recurring billing). Statutory items can be switched off in Settings > Obligations.
 */
@Controller('director/obligations')
export class ObligationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list(@Query('days') daysRaw?: string) {
    const companyId = RequestCtx.companyId();
    const days = Math.min(120, Math.max(14, Number(daysRaw) || 60));
    const today = utcDay();
    const until = addDays(today, days);
    const out: Obligation[] = [];
    const urgency = (d: Date): Obligation['urgency'] => (d < today ? 'OVERDUE' : d <= addDays(today, 7) ? 'SOON' : 'LATER');
    const push = (d: Date, o: Omit<Obligation, 'date' | 'urgency'>) => out.push({ ...o, date: iso(d), urgency: urgency(d) });
    const on = (k: string, fallback = true) => this.settings.bool(`obligations.${k}`, companyId, fallback);
    const scope = this.access.scopeWhere({ branchField: 'branchId' });

    // ---------- statutory, monthly: for the previous month and the current one (deadlines in the next month)
    const statutory = RequestCtx.can('accounting.journal.read') || RequestCtx.can('hris.payroll.read') || RequestCtx.user().isSuperAdmin;
    if (statutory) {
      const employees = await this.prisma.employee.count({ where: { companyId, deletedAt: null, isActive: true } });
      const vatPayer = await this.settings.bool('sales.vatPayer', companyId, true);
      for (let back = 1; back >= 0; back--) {
        const period = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
        const label = `${BULAN[period.getUTCMonth()]} ${period.getUTCFullYear()}`;
        const next = (day: number) => new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, day));
        const endNext = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 2, 0));
        const add = (d: Date, o: Omit<Obligation, 'date' | 'urgency'>) => {
          // past deadlines only while the period just ended (we cannot know whether they were met)
          if (d <= until && (d >= addDays(today, -10) || back === 0)) push(d, o);
        };
        if (employees > 0 && (await on('pph21'))) {
          add(next(15), { kind: 'TAX', title: `Setor PPh Pasal 21 masa ${label}`, detail: 'Pajak penghasilan karyawan yang dipotong dari gaji' });
          add(next(20), { kind: 'TAX', title: `Lapor SPT Masa PPh Pasal 21/26 masa ${label}`, detail: 'Lewat Coretax DJP' });
        }
        if (await on('pphFinal')) {
          // estimate: 0.5% of the month's invoiced revenue (before VAT)
          const from = period;
          const to = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1));
          const rev = await this.prisma.tradeDocument.aggregate({ where: { companyId, docType: 'SI', deletedAt: null, status: { in: ['CONFIRMED', 'PARTIAL', 'COMPLETED'] }, date: { gte: from, lt: to } }, _sum: { subtotal: true, discountTotal: true } });
          const omzet = r2(num(rev._sum.subtotal) - num(rev._sum.discountTotal));
          add(next(15), {
            kind: 'TAX',
            title: `Setor PPh Final UMKM 0,5% masa ${label}`,
            detail: `Estimasi dari omzet invoice bulan itu Rp ${omzet.toLocaleString('id-ID')}. Pastikan perusahaan masih memenuhi syarat tarif ini.`,
            amount: r2(omzet * 0.005),
          });
        }
        if (vatPayer && (await on('ppn'))) add(endNext, { kind: 'TAX', title: `Setor & lapor SPT Masa PPN masa ${label}`, detail: 'Paling lambat akhir bulan berikutnya' });
        if (employees > 0 && (await on('bpjs'))) {
          add(next(10), { kind: 'BPJS', title: `Bayar iuran BPJS Kesehatan bulan ${BULAN[(period.getUTCMonth() + 1) % 12]}`, detail: 'Iuran dibayar paling lambat tanggal 10' });
          add(next(15), { kind: 'BPJS', title: `Bayar iuran BPJS Ketenagakerjaan bulan ${BULAN[(period.getUTCMonth() + 1) % 12]}`, detail: 'Iuran dibayar paling lambat tanggal 15' });
        }
      }
      if (await on('annualTax')) {
        for (const y of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
          const d = new Date(Date.UTC(y, 3, 30));
          if (d >= today && d <= until) push(d, { kind: 'TAX', title: `Lapor SPT Tahunan PPh Badan tahun pajak ${y - 1}`, detail: 'Paling lambat akhir bulan keempat setelah tahun pajak berakhir' });
        }
      }
    }

    // ---------- contracts of employees that end soon: notice of extension at least 7 days before
    if (RequestCtx.can('hris.employee.read')) {
      const ending = await this.prisma.employee.findMany({
        where: { ...(scope as Prisma.EmployeeWhereInput), companyId, deletedAt: null, isActive: true, endDate: { not: null, gte: addDays(today, -7), lte: addDays(until, 7) } },
        select: { id: true, fullName: true, endDate: true, employmentCode: true },
      });
      for (const e of ending) {
        const notice = addDays(e.endDate!, -7);
        push(notice < today && e.endDate! >= today ? today : notice, {
          kind: 'CONTRACT',
          title: `Kontrak ${e.fullName} berakhir ${e.endDate!.toISOString().slice(0, 10).split('-').reverse().join('/')}`,
          detail: 'Putuskan perpanjangan dan beri tahu karyawan secara tertulis paling lambat 7 hari sebelumnya; siapkan uang kompensasi bila tidak diperpanjang.',
          link: `/employees/${e.id}`,
        });
      }
    }

    // ---------- invoices and bills due
    const types = [...(RequestCtx.can('sales.invoice.read') ? ['SI'] : []), ...(RequestCtx.can('purchase.invoice.read') ? ['PI'] : [])];
    if (types.length) {
      const docs = await this.prisma.tradeDocument.findMany({
        where: { ...(scope as Prisma.TradeDocumentWhereInput), companyId, deletedAt: null, docType: { in: types }, status: { in: ['CONFIRMED', 'PARTIAL'] }, dueDate: { not: null, lte: until } },
        select: { id: true, docType: true, number: true, dueDate: true, grandTotal: true, paidAmount: true },
        orderBy: { dueDate: 'asc' },
        take: 200,
      });
      for (const d of docs) {
        const open = r2(num(d.grandTotal) - num(d.paidAmount));
        if (open <= 0.005) continue;
        push(d.dueDate!, d.docType === 'SI'
          ? { kind: 'RECEIVABLE', title: `Invoice ${d.number} jatuh tempo`, detail: 'Tagih pelanggan / kirim pengingat', amount: open, link: `/documents/SI/${d.id}` }
          : { kind: 'PAYABLE', title: `Bayar tagihan ${d.number}`, amount: open, link: `/documents/PI/${d.id}` });
      }
    }

    // ---------- milestones to invoice and recurring billing
    if (RequestCtx.can('master.project.read')) {
      const ms = await this.prisma.projectMilestone.findMany({ where: { companyId, deletedAt: null, invoiceId: null, dueDate: { not: null, lte: until } }, take: 100 });
      const projects = ms.length ? await this.prisma.project.findMany({ where: { id: { in: [...new Set(ms.map((m) => m.projectId))] }, deletedAt: null }, select: { id: true, code: true } }) : [];
      const pmap = new Map(projects.map((p) => [p.id, p]));
      for (const m of ms) {
        const p = pmap.get(m.projectId);
        if (p) push(m.dueDate!, { kind: 'MILESTONE', title: `Tagih termin "${m.name}" proyek ${p.code}`, amount: r2(num(m.amount)), link: `/projects/${p.id}#milestones` });
      }
    }
    if (RequestCtx.can('sales.subscription.read')) {
      const subs = await this.prisma.subscription.findMany({ where: { companyId, isActive: true, deletedAt: null, nextRunDate: { lte: until } }, select: { id: true, name: true, nextRunDate: true }, take: 100 });
      for (const s of subs) push(s.nextRunDate, { kind: 'SUBSCRIPTION', title: `Invoice berulang: ${s.name}`, detail: 'Dibuat otomatis oleh sistem pada pagi hari', link: `/billing/subscriptions/${s.id}` });
    }

    out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
    return {
      asOf: iso(today),
      until: iso(until),
      counts: { overdue: out.filter((o) => o.urgency === 'OVERDUE').length, soon: out.filter((o) => o.urgency === 'SOON').length, total: out.length },
      items: out,
    };
  }
}
