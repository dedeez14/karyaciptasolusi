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
      const regime = await this.settings.str('tax.regime', companyId, 'UMKM_FINAL');
      const finalRate = await this.settings.num('tax.finalRate', companyId, 0.5);
      // a deadline on a Saturday, Sunday, public holiday or collective leave moves to the next working day (PMK 81/2024)
      const holidays = new Set(
        (await this.prisma.holiday.findMany({ where: { companyId, isActive: true, deletedAt: null, date: { gte: addDays(today, -45), lte: addDays(until, 15) } }, select: { date: true } })).map((h) => iso(h.date)),
      );
      const workday = (d: Date) => {
        let x = d;
        for (let i = 0; i < 14 && (x.getUTCDay() === 0 || x.getUTCDay() === 6 || holidays.has(iso(x))); i++) x = addDays(x, 1);
        return x;
      };
      for (let back = 1; back >= 0; back--) {
        const period = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
        const label = `${BULAN[period.getUTCMonth()]} ${period.getUTCFullYear()}`;
        const next = (day: number) => workday(new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, day)));
        const endNext = workday(new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 2, 0)));
        const periodEnd = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1));
        const add = (d: Date, o: Omit<Obligation, 'date' | 'urgency'>) => {
          // past deadlines only while the period just ended (we cannot know whether they were met)
          if (d <= until && (d >= addDays(today, -10) || back === 0)) push(d, o);
        };
        // payroll of the month: PPh 21 withheld and BPJS contributions (employee + company), when calculated by the system
        const slips = await this.prisma.payslip.findMany({ where: { payrollRun: { companyId, deletedAt: null, status: { not: 'CANCELLED' }, periodEnd: { gte: period, lt: periodEnd } } }, select: { statutory: true } });
        const stat = slips.reduce(
          (a, s) => {
            const x = (s.statutory ?? {}) as { pph21?: number; bpjs?: { kes?: number; tk?: number } };
            return { pph21: a.pph21 + num(x.pph21), kes: a.kes + num(x.bpjs?.kes), tk: a.tk + num(x.bpjs?.tk) };
          },
          { pph21: 0, kes: 0, tk: 0 },
        );
        if (employees > 0 && (await on('pph21'))) {
          add(next(15), { kind: 'TAX', title: `Setor PPh Pasal 21 masa ${label}`, detail: 'Pajak penghasilan karyawan yang dipotong dari gaji (kode billing di Coretax)', ...(stat.pph21 ? { amount: r2(stat.pph21) } : {}) });
          add(next(20), { kind: 'TAX', title: `Lapor SPT Masa PPh Pasal 21/26 masa ${label}`, detail: 'Lewat Coretax DJP, bersama bukti potong BPMP' });
        }
        // PPh 23 / 4(2) we withheld from suppliers in the month
        if (await on('unifikasi')) {
          const w = await this.prisma.payment.aggregate({ where: { companyId, direction: 'OUT', deletedAt: null, status: { not: 'CANCELLED' }, whtAmount: { gt: 0 }, date: { gte: period, lt: periodEnd } }, _sum: { whtAmount: true }, _count: { _all: true } });
          if (w._count._all) {
            add(next(15), { kind: 'TAX', title: `Setor PPh 23 / 4(2) yang dipotong masa ${label}`, detail: `${w._count._all} pembayaran ke supplier dengan potongan pajak`, amount: r2(num(w._sum.whtAmount)), link: '/reports/withholding-tax' });
            add(next(20), { kind: 'TAX', title: `Lapor SPT Masa PPh Unifikasi masa ${label}`, detail: 'Terbitkan bukti potong (BPPU) di Coretax untuk setiap supplier', link: '/reports/withholding-tax' });
          }
        }
        if (vatPayer && (await on('efaktur'))) {
          const fakturs = await this.prisma.tradeDocument.count({ where: { companyId, docType: 'SI', deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED'] }, taxTotal: { gt: 0 }, date: { gte: period, lt: periodEnd } } });
          if (fakturs) add(next(20), { kind: 'TAX', title: `Upload e-Faktur masa ${label}`, detail: `${fakturs} invoice dengan PPN harus di-upload dan disetujui di Coretax (PER-11/PJ/2025)`, link: '/reports/vat-output' });
        }
        if (regime === 'UMKM_FINAL' && (await on('pphFinal'))) {
          // estimate: 0.5% of the month's invoiced revenue (before VAT)
          const from = period;
          const to = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1));
          const rev = await this.prisma.tradeDocument.aggregate({ where: { companyId, docType: 'SI', deletedAt: null, status: { in: ['CONFIRMED', 'PARTIAL', 'COMPLETED'] }, date: { gte: from, lt: to } }, _sum: { subtotal: true, discountTotal: true } });
          // sales returns of the month lower the gross turnover
          const ret = await this.prisma.tradeDocument.aggregate({ where: { companyId, docType: 'SR', deletedAt: null, status: { in: ['CONFIRMED', 'PARTIAL', 'COMPLETED'] }, date: { gte: from, lt: to } }, _sum: { subtotal: true, discountTotal: true } });
          // point-of-sale receipts are turnover too (net of VAT and regional tax)
          const pos = await this.prisma.posSale.aggregate({ where: { companyId, status: 'PAID', date: { gte: from, lt: to } }, _sum: { subtotal: true } });
          const omzet = r2(num(rev._sum.subtotal) - num(rev._sum.discountTotal) - (num(ret._sum.subtotal) - num(ret._sum.discountTotal)) + num(pos._sum.subtotal));
          add(next(15), {
            kind: 'TAX',
            title: `Setor PPh Final UMKM ${String(finalRate).replace('.', ',')}% masa ${label}`,
            detail: `Estimasi dari omzet invoice bulan itu Rp ${omzet.toLocaleString('id-ID')} (PP 55/2022 jo. PP 20/2026). Bukti setor ber-NTPN dianggap SPT Masa; potongan 0,5% oleh pelanggan mengurangi setoran.`,
            amount: r2((omzet * finalRate) / 100),
          });
        }
        if (vatPayer && (await on('ppn'))) add(endNext, { kind: 'TAX', title: `Setor & lapor SPT Masa PPN masa ${label}`, detail: 'Paling lambat akhir bulan berikutnya' });
        if (employees > 0 && (await on('bpjs'))) {
          add(next(10), { kind: 'BPJS', title: `Bayar iuran BPJS Kesehatan bulan ${BULAN[(period.getUTCMonth() + 1) % 12]}`, detail: 'Iuran dibayar paling lambat tanggal 10 (4% perusahaan + 1% karyawan)', ...(stat.kes ? { amount: r2(stat.kes) } : {}) });
          add(next(15), { kind: 'BPJS', title: `Bayar iuran BPJS Ketenagakerjaan bulan ${BULAN[(period.getUTCMonth() + 1) % 12]}`, detail: 'JHT, JP, JKK, JKM paling lambat tanggal 15; terlambat didenda 2% per bulan', ...(stat.tk ? { amount: r2(stat.tk) } : {}) });
        }
      }
      // SIINas (Permenperin 13/2025): industrial companies report every quarter by the 10th of the next month
      if ((await on('siinas')) && (await this.prisma.workOrder.count({ where: { companyId, deletedAt: null } }))) {
        for (let k = -1; k <= 4; k++) {
          const q = Math.floor(today.getUTCMonth() / 3) + k; // quarter index relative to this year
          const year = today.getUTCFullYear() + Math.floor(q / 4);
          const quarter = ((q % 4) + 4) % 4; // 0..3
          const due = workday(new Date(Date.UTC(year, quarter * 3 + 3, 10)));
          if (due >= addDays(today, -10) && due <= until) push(due, { kind: 'TAX', title: `Laporan SIINas triwulan ${quarter + 1} ${year}`, detail: 'Data produksi, bahan baku, tenaga kerja dan investasi di siinas.kemenperin.go.id', link: '/manufacturing/summary' });
        }
      }
      if (employees > 0 && (await on('a1'))) {
        for (const y of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
          const d = workday(new Date(Date.UTC(y, 0, 31)));
          if (d >= today && d <= until) push(d, { kind: 'TAX', title: `Berikan bukti potong 1721-A1 tahun ${y - 1} ke karyawan`, detail: 'Paling lambat akhir Januari; dibuat di Coretax (e-Bupot 21)' });
        }
      }
      if (await on('annualTax')) {
        for (const y of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
          const d = workday(new Date(Date.UTC(y, 3, 30)));
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
