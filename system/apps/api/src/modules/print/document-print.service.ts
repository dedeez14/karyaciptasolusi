import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round } from '../../common/utils/money';
import type { Prisma } from '@prisma/client';
import { DocTypeDef } from '../documents/document.registry';
import { PdfService, PrintableDocument } from './pdf.service';

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';

/** Maps business records to the single PrintableDocument layout (consistent format for all documents). */
@Injectable()
export class DocumentPrintService {
  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService, private readonly settings: SettingsService, private readonly pdf: PdfService) {}

  private async party(kind: 'customer' | 'supplier', id: string | null) {
    if (!id) return null;
    const p: any = kind === 'customer' ? await this.prisma.customer.findUnique({ where: { id } }) : await this.prisma.supplier.findUnique({ where: { id } });
    if (!p) return null;
    const tax = this.crypto.decrypt(p.taxId);
    return {
      name: p.name,
      lines: [p.contactPerson && `Attn: ${p.contactPerson}`, this.crypto.decrypt(p.address), p.city, [p.phone, p.email].filter(Boolean).join('  ·  '), tax && `NPWP ${tax}`].filter(Boolean) as string[],
    };
  }

  async trade(def: DocTypeDef, doc: any): Promise<PrintableDocument> {
    const companyId = RequestCtx.companyId();
    const locale = await this.settings.str('general.locale', companyId, 'en-US');
    const m = (v: unknown) => this.pdf.money(v, locale);
    const q = (v: unknown) => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(Number(v));
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { currencyCode: true } });

    const parties: PrintableDocument['parties'] = [];
    if (def.partner) {
      const p = await this.party(def.partner, doc.customerId ?? doc.supplierId);
      if (p) parties.push({ label: def.partyLabel ?? (def.partner === 'customer' ? 'Customer' : 'Supplier'), ...p });
    }
    if (def.warehouse === 'transfer') {
      parties.push({ label: 'From Warehouse', name: doc.warehouseName ?? '-', lines: [] });
      parties.push({ label: 'To Warehouse', name: doc.toWarehouseName ?? '-', lines: [] });
    } else if (doc.warehouseName && !def.priced) parties.push({ label: 'Warehouse', name: doc.warehouseName, lines: [] });

    const [term, owner, project] = await Promise.all([
      doc.paymentTermId ? this.prisma.paymentTerm.findUnique({ where: { id: doc.paymentTermId }, select: { name: true } }) : null,
      doc.ownerId ? this.prisma.user.findUnique({ where: { id: doc.ownerId }, select: { fullName: true } }) : null,
      doc.projectId ? this.prisma.project.findUnique({ where: { id: doc.projectId }, select: { name: true } }) : null,
    ]);

    const meta = [
      { label: 'Date', value: fmtDate(doc.date) },
      ...(def.dueDate ? [{ label: def.code === 'SQ' ? 'Valid Until' : 'Due Date', value: fmtDate(doc.dueDate) }] : []),
      { label: 'Reference', value: doc.reference ?? '' },
      ...((def.code === 'SI' || def.code === 'PI') && doc.taxInvoiceNumber ? [{ label: 'Tax Invoice No.', value: doc.taxInvoiceNumber }] : []),
      ...(def.returnOf ? [{ label: 'Original Invoice', value: doc.source?.number ?? doc.reference ?? '' }] : []),
      ...(def.returnOf && doc.taxInvoiceNumber ? [{ label: 'Nota Retur No.', value: doc.taxInvoiceNumber }] : []),
      { label: 'Source', value: doc.source?.number ?? '' },
      { label: 'Payment Term', value: term?.name ?? '' },
      { label: 'Project', value: project?.name ?? '' },
      { label: def.module === 'sales' ? 'Sales Person' : 'Requested By', value: owner?.fullName ?? '' },
      ...(doc.currencyCode !== company.currencyCode ? [{ label: 'Currency', value: `${doc.currencyCode} @ ${doc.exchangeRate}` }] : []),
    ];

    const hasDisc = doc.lines.some((l: any) => Number(l.discountPct) > 0);
    const hasTax = doc.lines.some((l: any) => Number(l.lineTax) > 0);
    const columns: PrintableDocument['columns'] = def.priced
      ? [
          { key: 'no', label: '#', width: 0.4, align: 'center' },
          { key: 'item', label: 'Description', width: 4 },
          { key: 'qty', label: 'Qty', width: 0.9, align: 'right' },
          { key: 'uom', label: 'Unit', width: 0.8 },
          { key: 'price', label: 'Unit Price', width: 1.5, align: 'right' },
          ...(hasDisc ? [{ key: 'disc', label: 'Disc %', width: 0.8, align: 'right' as const }] : []),
          ...(hasTax ? [{ key: 'tax', label: 'Tax', width: 0.7, align: 'center' as const }] : []),
          { key: 'amount', label: 'Amount', width: 1.7, align: 'right' },
        ]
      : [
          { key: 'no', label: '#', width: 0.4, align: 'center' },
          { key: 'code', label: 'Code', width: 1.3 },
          { key: 'item', label: 'Description', width: 4 },
          { key: 'qty', label: 'Qty', width: 1, align: 'right' },
          { key: 'uom', label: 'Unit', width: 0.8 },
        ];
    const rows = doc.lines.map((l: any, i: number) => ({
      no: String(i + 1),
      code: l.product?.code ?? '',
      item: [l.product && def.priced ? `${l.product.name}` : null, l.description && l.description !== l.product?.name ? l.description : null].filter(Boolean).join('\n') || l.description || '',
      qty: q(l.qty),
      uom: l.uomCode ?? '',
      price: m(l.unitPrice),
      disc: Number(l.discountPct) ? `${Number(l.discountPct)}` : '',
      tax: Number(l.taxRate) ? `${Number(l.taxRate)}%` : '',
      amount: m(D(l.lineSubtotal).minus(D(l.lineDiscount))),
    }));

    const totals: PrintableDocument['totals'] = [];
    if (def.priced) {
      totals.push({ label: 'Subtotal', value: m(doc.subtotal) });
      if (D(doc.discountTotal).gt(0)) totals.push({ label: 'Discount', value: `-${m(doc.discountTotal)}` });
      if (D(doc.taxTotal).gt(0)) {
        // PMK 131/2024: show the tax base (DPP) and, for PPN 12%, the "DPP nilai lain" (11/12) the tax is charged on
        const net = D(doc.subtotal).minus(D(doc.discountTotal));
        const taxIds = [...new Set(doc.lines.map((l: any) => l.taxId).filter(Boolean))] as string[];
        const taxes = taxIds.length ? await this.prisma.tax.findMany({ where: { id: { in: taxIds } }, select: { id: true, name: true, rate: true, baseNumerator: true, baseDenominator: true } }) : [];
        const other = taxes.some((t) => t.baseNumerator !== t.baseDenominator);
        totals.push({ label: 'Tax base (DPP)', value: m(net) });
        if (other) {
          const dppNl = doc.lines.reduce((a: Prisma.Decimal, l: any) => {
            const t = taxes.find((x) => x.id === l.taxId);
            return t ? a.plus(D(l.lineSubtotal).minus(D(l.lineDiscount)).times(t.baseNumerator).div(t.baseDenominator)) : a;
          }, D(0));
          totals.push({ label: 'DPP nilai lain (11/12)', value: m(round(dppNl)) });
        }
        const rates = [...new Set(taxes.map((t) => Number(t.rate)))];
        totals.push({ label: rates.length === 1 ? `PPN ${rates[0]}%` : 'PPN', value: m(doc.taxTotal) });
      }
      if (D(doc.luxuryTaxTotal ?? 0).gt(0)) {
        const terms = [...new Set(doc.lines.filter((l: any) => D(l.lineLuxuryTax ?? 0).gt(0)).map((l: any) => `${Number(l.luxuryRate)}% x DPP ${Number(l.luxuryBasePct)}%`))];
        totals.push({ label: `PPnBM${terms.length === 1 ? ` ${terms[0]}` : ''}`, value: m(doc.luxuryTaxTotal) });
      }
      totals.push({ label: `Total (${doc.currencyCode})`, value: m(doc.grandTotal), bold: !def.payable || D(doc.paidAmount).isZero() });
      if (def.payable && D(doc.paidAmount).gt(0)) {
        totals.push({ label: 'Paid', value: `-${m(doc.paidAmount)}` });
        totals.push({ label: 'Balance Due', value: m(D(doc.grandTotal).minus(D(doc.paidAmount))), bold: true });
      }
    }
    // a sales invoice of a company that is not a PKP is not a tax invoice (UU PPN Pasal 14)
    let taxNote = '';
    if (def.code === 'SI') {
      const vatPayer = await this.settings.bool('sales.vatPayer', companyId, true);
      const nib = (await this.settings.str('tax.nib', companyId, '')).trim();
      const pp55 = (await this.settings.str('tax.regime', companyId, 'UMKM_FINAL')) === 'UMKM_FINAL' && (await this.settings.bool('tax.pp55Certificate', companyId, false));
      taxNote = [
        vatPayer ? '' : 'The seller is not a VAT-registered entrepreneur (Non-PKP): this invoice is not a tax invoice (Faktur Pajak) and contains no PPN.',
        pp55 ? 'The seller holds a Surat Keterangan PP 55/2022: income tax withheld on this invoice is the 0.5% final rate, not PPh 23.' : '',
        nib ? `NIB ${nib}.` : '',
      ]
        .filter(Boolean)
        .join(' ');
    }
    if (def.returnOf && D(doc.taxTotal).gt(0)) {
      taxNote = [taxNote, 'PPN on returned goods is corrected with a nota retur made by the buyer in Coretax (PMK 81/2024); it reduces the output VAT of the seller in the month of the return.'].filter(Boolean).join(' ');
    }
    const paidInFull = def.payable && doc.status === 'COMPLETED';
    return {
      title: def.printTitle,
      number: doc.number,
      status: doc.status === 'DRAFT' ? 'Draft' : doc.status === 'CANCELLED' ? 'Cancelled' : paidInFull ? 'Paid' : undefined,
      parties,
      meta,
      columns,
      rows,
      totals,
      amount: def.priced ? { value: Number(doc.grandTotal), currency: doc.currencyCode } : undefined,
      notes: [doc.notes, taxNote].filter(Boolean).join('\n\n') || null,
      terms: doc.terms,
      paymentInfo: def.code === 'SI' ? await this.settings.str('document.paymentInfo', companyId, '') : null,
      // UU 10/2020: an invoice marked paid (it then acknowledges receipt of money) above Rp5.000.000 carries stamp duty
      stampDuty: def.code === 'SI' && paidInFull && doc.currencyCode === 'IDR' && Number(doc.grandTotal) > 5_000_000,
      signatures: def.signatures,
      verify: { k: def.code, id: doc.id, n: doc.number, d: new Date(doc.date).toISOString().slice(0, 10), a: def.priced ? Number(doc.grandTotal) : null, cur: def.priced ? doc.currencyCode : null },
    };
  }

  async payment(p: any): Promise<PrintableDocument> {
    const companyId = RequestCtx.companyId();
    const locale = await this.settings.str('general.locale', companyId, 'en-US');
    const m = (v: unknown) => this.pdf.money(v, locale);
    const isIn = p.direction === 'IN';
    const party = await this.party(isIn ? 'customer' : 'supplier', isIn ? p.customerId : p.supplierId);
    const method = p.paymentMethodId ? await this.prisma.paymentMethod.findUnique({ where: { id: p.paymentMethodId }, select: { name: true } }) : null;
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { currencyCode: true } });
    const allocated = p.allocations.reduce((a: number, x: any) => a + Number(x.amount), 0);
    return {
      title: isIn ? 'Official Receipt' : 'Payment Voucher',
      number: p.number,
      status: p.status === 'CANCELLED' ? 'Cancelled' : undefined,
      parties: party ? [{ label: isIn ? 'Received From' : 'Paid To', ...party }] : [],
      meta: [
        { label: 'Date', value: fmtDate(p.date) },
        { label: 'Method', value: method?.name ?? '' },
        { label: isIn ? 'Deposited To' : 'Paid From', value: p.bankAccountName ?? '' },
        { label: 'Reference', value: p.reference ?? '' },
      ],
      columns: [
        { key: 'no', label: '#', width: 0.4, align: 'center' },
        { key: 'doc', label: 'Invoice', width: 2.5 },
        { key: 'date', label: 'Invoice Date', width: 1.5 },
        { key: 'total', label: 'Invoice Total', width: 1.6, align: 'right' },
        { key: 'amount', label: 'Amount Applied', width: 1.6, align: 'right' },
      ],
      rows: p.allocations.map((a: any, i: number) => ({ no: String(i + 1), doc: a.document.number, date: fmtDate(a.document.date), total: m(a.document.grandTotal), amount: m(a.amount) })),
      totals: [
        { label: 'Applied to Invoices', value: m(allocated) },
        // income tax withheld (PPh 23 / 4(2) / final): settles part of the invoices without cash
        ...(Number(p.whtAmount ?? 0) > 0 ? [{ label: `Tax withheld${p.whtSlipNo ? ` (slip ${p.whtSlipNo})` : ''}`, value: `-${m(p.whtAmount)}` }] : []),
        ...(Number(p.amount) + Number(p.whtAmount ?? 0) - allocated > 0.005 ? [{ label: 'Unapplied (Advance)', value: m(Number(p.amount) + Number(p.whtAmount ?? 0) - allocated) }] : []),
        { label: `Total (${company.currencyCode})`, value: m(p.amount), bold: true },
      ],
      amount: { value: Number(p.amount), currency: company.currencyCode },
      notes: p.notes,
      signatures: isIn ? ['Received by'] : ['Prepared by', 'Approved by', 'Received by'],
      // UU 10/2020: a receipt for more than Rp5.000.000 carries stamp duty
      stampDuty: isIn && company.currencyCode === 'IDR' && Number(p.amount) > 5_000_000,
      verify: { k: isIn ? 'PAY_IN' : 'PAY_OUT', id: p.id, n: p.number, d: new Date(p.date).toISOString().slice(0, 10), a: Number(p.amount), cur: company.currencyCode },
    };
  }

  /** Cash / bank voucher (money in, money out, transfer) - same layout as every other document */
  async cash(t: any): Promise<PrintableDocument> {
    const companyId = RequestCtx.companyId();
    const locale = await this.settings.str('general.locale', companyId, 'en-US');
    const m = (v: unknown) => this.pdf.money(v, locale);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { currencyCode: true } });
    const title = t.type === 'RECEIPT' ? 'Cash Receipt Voucher' : t.type === 'PAYMENT' ? 'Cash Payment Voucher' : 'Bank Transfer Voucher';
    const rows =
      t.type === 'TRANSFER'
        ? [
            { no: '1', account: `To: ${t.toBankAccountName ?? ''}`, desc: t.description, amount: m(t.amount) },
            { no: '2', account: `From: ${t.bankAccountName ?? ''}`, desc: t.description, amount: m(t.amount) },
          ]
        : [{ no: '1', account: t.accountName ?? '', desc: t.description, amount: m(t.amount) }];
    return {
      title,
      number: t.number,
      status: t.status === 'CANCELLED' ? 'Cancelled' : undefined,
      parties: t.partyName ? [{ label: t.type === 'RECEIPT' ? 'Received From' : 'Paid To', name: t.partyName, lines: [] }] : [],
      meta: [
        { label: 'Date', value: fmtDate(t.date) },
        { label: t.type === 'RECEIPT' ? 'Deposited To' : 'Paid From', value: t.type === 'RECEIPT' ? t.bankAccountName ?? '' : t.bankAccountName ?? '' },
        { label: 'Reference', value: t.reference ?? '' },
      ],
      columns: [
        { key: 'no', label: '#', width: 0.4, align: 'center' },
        { key: 'account', label: 'Account', width: 2.4 },
        { key: 'desc', label: 'Description', width: 3 },
        { key: 'amount', label: 'Amount', width: 1.6, align: 'right' },
      ],
      rows,
      totals: [{ label: `Total (${company.currencyCode})`, value: m(t.amount), bold: true }],
      amount: { value: Number(t.amount), currency: company.currencyCode },
      signatures: ['Prepared by', 'Approved by', t.type === 'RECEIPT' ? 'Paid by' : 'Received by'],
      verify: { k: 'CASH', id: t.id, n: t.number, d: new Date(t.date).toISOString().slice(0, 10), a: Number(t.amount), cur: company.currencyCode },
    };
  }
}
