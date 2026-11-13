export type Direction = 'in' | 'out';

export interface PaymentRow {
  id: string;
  number: string;
  date: string;
  direction: 'IN' | 'OUT';
  customerId: string | null;
  supplierId: string | null;
  bankAccountId: string;
  paymentMethodId: string | null;
  amount: string;
  /** income tax withheld (PPh 23 / 4(2) / final) */
  whtAmount?: string;
  whtBase?: string;
  whtRate?: string;
  whtSlipNo?: string | null;
  whtSlipDate?: string | null;
  reference: string | null;
  notes: string | null;
  status: string;
  partnerName: string | null;
  bankAccountName: string | null;
  createdAt: string;
}

export interface PaymentDetail extends PaymentRow {
  allocations: { id: string; documentId: string; amount: string; document: { id: string; number: string; date: string; grandTotal: string; paidAmount: string; docType: string } }[];
}

export const dirMeta = (d: string) =>
  d === 'out'
    ? { dir: 'out' as const, title: 'Supplier Payments', singular: 'Supplier Payment', partner: 'Supplier', partnerResource: 'suppliers', invoiceType: 'PI', perm: 'purchase.payment' }
    : { dir: 'in' as const, title: 'Customer Receipts', singular: 'Customer Receipt', partner: 'Customer', partnerResource: 'customers', invoiceType: 'SI', perm: 'sales.payment' };
