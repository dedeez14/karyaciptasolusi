import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Activity } from '../../common/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { FileOutputService } from '../files/file-output.service';

/**
 * Import files for DJP Coretax, following the official DJP templates (converter v1.6, Jan 2026):
 * - e-Faktur keluaran: TaxInvoiceBulk (sales invoices with PPN or a 07 / 08 facility, one faktur per transaction code, PKP only)
 * - Bukti potong unifikasi (PPh 23 / 4(2)) we withheld from suppliers: BpuBulk
 * - Bukti potong PPh 21 bulanan for permanent employees (TER): MmPayrollBulk
 * The files are prepared here and uploaded by the user in Coretax, where they are checked, numbered and signed.
 */
const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const el = (name: string, v: unknown) => (v === null || v === undefined || v === '' ? `<${name}/>` : `<${name}>${esc(v)}</${name}>`);
const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
const n2 = (v: unknown) => (Math.round(Number(v ?? 0) * 100) / 100).toFixed(2).replace(/\.00$/, '');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;
/** transaction codes of a facility faktur: 07 tidak dipungut / DTP, 08 dibebaskan (keterangan tambahan and cap fasilitas required) */
const FACILITY = new Set(['07', '08']);

/** our unit codes -> Coretax unit list (UM.0001..UM.0039) */
const UNIT: Record<string, string> = {
  KG: 'UM.0003',
  LTR: 'UM.0007',
  M: 'UM.0013',
  UNIT: 'UM.0018',
  PKG: 'UM.0019',
  SET: 'UM.0019',
  PCS: 'UM.0021',
  BOX: 'UM.0022',
  YEAR: 'UM.0023',
  MON: 'UM.0024',
  WEEK: 'UM.0025',
  DAY: 'UM.0026',
  HR: 'UM.0027',
  PRJ: 'UM.0030',
};

function month(v: string | undefined) {
  if (!v || !/^\d{4}-\d{2}$/.test(v)) throw new BadRequestException('Choose a month (YYYY-MM)');
  const [y, m] = v.split('-').map(Number);
  return { y, m, from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) };
}

@Controller('coretax')
export class CoretaxController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly output: FileOutputService,
  ) {}

  private async seller() {
    const companyId = RequestCtx.companyId();
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { taxId: true } });
    const npwp = digits(this.crypto.decrypt(c.taxId));
    if (npwp.length !== 16) throw new BadRequestException('Fill in the company NPWP (16 digits) in System > Companies first');
    const nitku = digits(await this.settings.str('tax.nitku', companyId, '')) || `${npwp}000000`;
    return { companyId, npwp, nitku };
  }

  private send(res: Response, xml: string, name: string) {
    const data = Buffer.from(`<?xml version="1.0" encoding="utf-8" ?>\n${xml}`, 'utf8');
    this.output.send(res, data, name, 'application/xml; charset=utf-8');
  }

  /**
   * e-Faktur keluaran for a month: every confirmed sales invoice with PPN or with lines under a 07 / 08 facility.
   * Coretax takes one transaction code per faktur, so an invoice mixing codes (medicines 04 and medical services 08,
   * a house DTP 07 on the first Rp2 bn and 04 on the rest) becomes one faktur per code. Line values follow the DJP
   * template: 04 = 11/12 of the price at 12%; 05 (besaran tertentu) = the full price at 12% with the PPN charged
   * (1.1% / 2.2%) entered as is; 07 / 08 = 11/12 of the price at 12%, the PPN shown but not collected, with the
   * keterangan tambahan and cap fasilitas of the tax.
   */
  @Get('efaktur')
  @Activity('EXPORT_EFAKTUR')
  async efaktur(@Query('month') m: string, @Res() res: Response) {
    RequestCtx.assert('report.vat-output.view');
    const { from, to } = month(m);
    const s = await this.seller();
    if (!(await this.settings.bool('sales.vatPayer', s.companyId, true))) throw new BadRequestException('Only a VAT payer (PKP) issues tax invoices');
    const taxes = await this.prisma.tax.findMany({ where: { companyId: s.companyId, kind: 'VAT' } });
    const tm = new Map(taxes.map((t) => [t.id, t]));
    const facility = taxes.filter((t) => FACILITY.has(t.trxCode ?? '')).map((t) => t.id);
    const docs = await this.prisma.tradeDocument.findMany({
      where: {
        companyId: s.companyId,
        docType: 'SI',
        deletedAt: null,
        isOpening: false,
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        date: { gte: from, lte: to },
        OR: [{ taxTotal: { gt: 0 } }, ...(facility.length ? [{ lines: { some: { taxId: { in: facility } } } }] : [])],
      },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      orderBy: [{ date: 'asc' }, { number: 'asc' }],
    });
    if (!docs.length) throw new BadRequestException('No sales invoices with PPN or a PPN facility (07 / 08) in this month');
    const unset = [
      ...new Set(
        docs
          .flatMap((d) => d.lines.map((l) => tm.get(l.taxId ?? '')))
          .filter((t) => t && FACILITY.has(t.trxCode ?? '') && (!t.addInfo || !t.facilityStamp))
          .map((t) => t!.code),
      ),
    ];
    if (unset.length) throw new BadRequestException(`Fill in the Coretax keterangan tambahan and cap fasilitas of ${unset.join(', ')} in Master > Taxes`);
    const [customers, products, uoms] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: docs.map((d) => d.customerId!).filter(Boolean) } } }),
      this.prisma.product.findMany({ where: { id: { in: docs.flatMap((d) => d.lines.map((l) => l.productId!)).filter(Boolean) } }, select: { id: true, type: true } }),
      this.prisma.uom.findMany({ where: { companyId: s.companyId }, select: { id: true, code: true } }),
    ]);
    const cm = new Map(customers.map((c) => [c.id, c]));
    const pm = new Map(products.map((p) => [p.id, p]));
    const um = new Map(uoms.map((u) => [u.id, u.code]));
    type Line = (typeof docs)[number]['lines'][number];
    const invoices: string[] = [];
    for (const d of docs) {
      const c = d.customerId ? cm.get(d.customerId) : undefined;
      const npwp = digits(c?.taxId ? this.crypto.decrypt(c.taxId) : '');
      const hasTin = npwp.length === 16;
      const rate = Number(d.exchangeRate) || 1;
      // the lines of the faktur: VAT lines with tax charged, or under a 07 / 08 facility (no tax charged)
      const inScope = d.lines.filter((l) => {
        const t = tm.get(l.taxId ?? '');
        return !!t && Number(l.lineSubtotal) !== 0 && (Number(l.lineTax) !== 0 || FACILITY.has(t.trxCode ?? ''));
      });
      const codeOf = (l: Line) => tm.get(l.taxId!)!.trxCode ?? '04';
      const codes = [...new Set(inScope.map(codeOf))];
      for (const code of codes) {
        const group = inScope.filter((l) => codeOf(l) === code);
        // Coretax takes no negative items: deduction lines (advance recovered on a termin) are netted into the first item of the same tax
        const items = group
          .filter((l) => Number(l.lineSubtotal) > 0)
          .map((l, _, arr) => {
            if (arr.findIndex((x) => x.taxId === l.taxId) !== arr.indexOf(l)) return l;
            const neg = group.filter((x) => x.taxId === l.taxId && Number(x.lineSubtotal) < 0);
            if (!neg.length) return l;
            const less = (k: 'lineSubtotal' | 'lineDiscount' | 'lineTax') => neg.reduce((a, x) => a + Number(x[k]), 0);
            const sub = Number(l.lineSubtotal) + less('lineSubtotal');
            const qty = Number(l.qty) || 1;
            return {
              ...l,
              description: `${l.description ?? 'Item'} (net of ${neg.map((x) => x.description ?? 'deduction').join(', ')})`,
              lineSubtotal: sub as never,
              lineDiscount: (Number(l.lineDiscount) + less('lineDiscount')) as never,
              lineTax: (Number(l.lineTax) + less('lineTax')) as never,
              unitPrice: (sub / qty) as never,
            };
          });
        if (!items.length) continue;
        const head = tm.get(items[0].taxId!)!;
        const fac = FACILITY.has(code);
        const goods = items
          .map((l) => {
            const t = tm.get(l.taxId!)!;
            const base = r2((Number(l.lineSubtotal) - Number(l.lineDiscount)) * rate);
            // 05: the full price is the base and the PPN is the amount charged; 07 / 08: DPP 11/12 at 12%, shown but not collected
            const other = code === '05' ? base : fac ? r2((base * 11) / 12) : r2((base * t.baseNumerator) / t.baseDenominator);
            const vatRate = code === '05' || fac ? 12 : Number(t.rate);
            const vat = fac ? r2((other * 12) / 100) : Number(l.lineTax) * rate;
            return [
              '<GoodService>',
              el('Opt', pm.get(l.productId ?? '')?.type === 'STOCK' ? 'A' : 'B'),
              el('Code', '000000'),
              el('Name', (l.description ?? 'Item').slice(0, 300)),
              el('Unit', UNIT[um.get(l.uomId ?? '') ?? ''] ?? 'UM.0033'),
              el('Price', n2(Number(l.unitPrice) * rate)),
              el('Qty', n2(l.qty)),
              el('TotalDiscount', n2(Number(l.lineDiscount) * rate)),
              el('TaxBase', n2(base)),
              el('OtherTaxBase', n2(other)),
              el('VATRate', vatRate),
              el('VAT', n2(vat)),
              el('STLGRate', Number(l.luxuryRate)),
              el('STLG', n2(Number(l.lineLuxuryTax) * rate)),
              '</GoodService>',
            ].join('');
          })
          .join('');
        invoices.push(
          [
            '<TaxInvoice>',
            el('TaxInvoiceDate', iso(d.date)),
            el('TaxInvoiceOpt', 'Normal'),
            el('TrxCode', code),
            el('AddInfo', fac ? head.addInfo : ''),
            el('CustomDoc', ''),
            el('CustomDocMonthYear', ''),
            el('RefDesc', codes.length > 1 ? `${d.number} (${code})` : d.number),
            el('FacilityStamp', fac ? head.facilityStamp : ''),
            el('SellerIDTKU', s.nitku),
            el('BuyerTin', hasTin ? npwp : '0000000000000000'),
            el('BuyerDocument', hasTin ? 'TIN' : 'Other ID'),
            el('BuyerCountry', 'IDN'),
            el('BuyerDocumentNumber', hasTin ? '-' : (c?.code ?? '-')),
            el('BuyerName', c?.name ?? ''),
            el('BuyerAdress', [c?.address ? this.crypto.decrypt(c.address) : '', c?.city].filter(Boolean).join(', ')),
            el('BuyerEmail', c?.email ?? ''),
            el('BuyerIDTKU', hasTin ? `${npwp}000000` : '000000'),
            `<ListOfGoodService>${goods}</ListOfGoodService>`,
            '</TaxInvoice>',
          ].join(''),
        );
      }
    }
    if (!invoices.length) throw new BadRequestException('No faktur lines in this month');
    this.send(
      res,
      `<TaxInvoiceBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="TaxInvoice.xsd">${el('TIN', s.npwp)}<ListOfTaxInvoice>${invoices.join('')}</ListOfTaxInvoice></TaxInvoiceBulk>`,
      `eFaktur_${m}.xml`,
    );
  }

  /** bukti potong unifikasi (PPh 23 / 4(2)) for the tax we withheld from suppliers in a month */
  @Get('bppu')
  @Activity('EXPORT_BPPU')
  async bppu(@Query('month') m: string, @Res() res: Response) {
    RequestCtx.assert('report.withholding-tax.view');
    const { y, m: mm, from, to } = month(m);
    const s = await this.seller();
    const pays = await this.prisma.payment.findMany({
      where: { companyId: s.companyId, direction: 'OUT', deletedAt: null, status: { not: 'CANCELLED' }, whtAmount: { gt: 0 }, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });
    if (!pays.length) throw new BadRequestException('No tax withheld from suppliers in this month');
    const [suppliers, taxes] = await Promise.all([
      this.prisma.supplier.findMany({ where: { id: { in: pays.map((p) => p.supplierId!).filter(Boolean) } }, select: { id: true, taxId: true } }),
      this.prisma.tax.findMany({ where: { id: { in: pays.map((p) => p.whtTaxId!).filter(Boolean) } } }),
    ]);
    const sm = new Map(suppliers.map((x) => [x.id, digits(x.taxId ? this.crypto.decrypt(x.taxId) : '')]));
    const tm = new Map(taxes.map((t) => [t.id, t]));
    const rows = pays.map((p) => {
      const tin = sm.get(p.supplierId ?? '') ?? '';
      return [
        '<Bpu>',
        el('TaxPeriodMonth', mm),
        el('TaxPeriodYear', y),
        el('CounterpartTin', tin),
        el('IDPlaceOfBusinessActivityOfIncomeRecipient', tin.length === 16 ? `${tin}000000` : ''),
        el('TaxCertificate', 'N/A'),
        el('TaxObjectCode', tm.get(p.whtTaxId ?? '')?.objectCode ?? ''),
        el('TaxBase', n2(p.whtBase)),
        el('Rate', Number(p.whtRate)),
        el('Document', 'PaymentProof'),
        el('DocumentNumber', p.number),
        el('DocumentDate', iso(p.date)),
        el('IDPlaceOfBusinessActivity', s.nitku),
        el('GovTreasurerOpt', 'N/A'),
        '<SP2DNumber xsi:nil="true"/>',
        el('WithholdingDate', iso(p.whtSlipDate ?? p.date)),
        '</Bpu>',
      ].join('');
    });
    this.send(res, `<BpuBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${el('TIN', s.npwp)}<ListOfBpu>${rows.join('')}</ListOfBpu></BpuBulk>`, `BPPU_${m}.xml`);
  }

  /** bukti potong PPh 21 bulanan (BPMP) of permanent employees, from the payroll of a month */
  @Get('bpmp')
  @Activity('EXPORT_BPMP')
  async bpmp(@Query('month') m: string, @Res() res: Response) {
    RequestCtx.assert('hris.payroll.read');
    const { y, m: mm, from, to } = month(m);
    const s = await this.seller();
    const slips = await this.prisma.payslip.findMany({
      where: { payrollRun: { companyId: s.companyId, deletedAt: null, status: { not: 'CANCELLED' }, periodEnd: { gte: from, lte: to } } },
      include: { payrollRun: { select: { payDate: true } } },
    });
    if (!slips.length) throw new BadRequestException('No payroll in this month');
    const emps = await this.prisma.employee.findMany({ where: { id: { in: slips.map((x) => x.employeeId) } }, select: { id: true, identityNo: true, taxNo: true, ptkpCode: true, positionId: true } });
    const positions = new Map(
      (await this.prisma.position.findMany({ where: { id: { in: emps.map((e) => e.positionId!).filter(Boolean) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]),
    );
    // several slips in a month (salary + THR) are one monthly slip with the combined gross
    const by = new Map<string, { gross: number; rate: number; date: Date }>();
    for (const x of slips) {
      const st = (x.statutory ?? {}) as { bruto?: number; terRate?: number; method?: string };
      const cur = by.get(x.employeeId) ?? { gross: 0, rate: 0, date: x.payrollRun.payDate };
      cur.gross += Number(st.bruto ?? x.totalEarning);
      cur.rate = Math.max(cur.rate, Number(st.terRate ?? 0));
      by.set(x.employeeId, cur);
    }
    const rows = emps.map((e) => {
      const v = by.get(e.id)!;
      const tin = digits(this.crypto.decrypt(e.taxNo)) || digits(this.crypto.decrypt(e.identityNo));
      return [
        '<MmPayroll>',
        el('TaxPeriodMonth', mm),
        el('TaxPeriodYear', y),
        el('CounterpartOpt', 'Resident'),
        '<CounterpartPassport xsi:nil="true"/>',
        el('CounterpartTin', tin),
        el('StatusTaxExemption', e.ptkpCode ?? 'TK/0'),
        el('Position', positions.get(e.positionId ?? '') ?? 'Pegawai'),
        el('TaxCertificate', 'N/A'),
        el('TaxObjectCode', '21-100-01'),
        el('Gross', Math.round(v.gross)),
        el('Rate', v.rate),
        el('IDPlaceOfBusinessActivity', s.nitku),
        el('WithholdingDate', iso(v.date)),
        '</MmPayroll>',
      ].join('');
    });
    this.send(res, `<MmPayrollBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${el('TIN', s.npwp)}<ListOfMmPayroll>${rows.join('')}</ListOfMmPayroll></MmPayrollBulk>`, `BPMP_${m}.xml`);
  }
}
