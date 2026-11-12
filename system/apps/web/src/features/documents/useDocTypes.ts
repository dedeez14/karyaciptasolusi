import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface DocTypeDef {
  code: string;
  label: string;
  printTitle: string;
  module: 'sales' | 'purchase' | 'inventory';
  permission: string;
  partner: 'customer' | 'supplier' | null;
  priced: boolean;
  priceField?: 'salePrice' | 'purchasePrice';
  taxField?: 'saleTaxId' | 'purchaseTaxId';
  warehouse: 'none' | 'optional' | 'required' | 'transfer';
  stock?: 'in' | 'out' | 'adjust' | 'transfer';
  convertTo: string[];
  payable?: boolean;
  dueDate?: boolean;
  stockItemsOnly?: boolean;
  partyLabel?: string;
  /** return / credit note of this invoice type */
  returnOf?: 'SI' | 'PI';
  can: { create: boolean; update: boolean; delete: boolean; confirm: boolean; cancel: boolean; print: boolean };
}

export interface DocLine {
  id?: string;
  lineNo?: number;
  productId: string | null;
  description: string | null;
  qty: string | number;
  uomId: string | null;
  unitPrice: string | number;
  discountPct: string | number;
  taxId: string | null;
  taxRate?: string | number;
  lineSubtotal?: string;
  lineDiscount?: string;
  lineTax?: string;
  lineTotal?: string;
  sourceLineId?: string | null;
  processedQty?: string;
  product?: { id: string; code: string; name: string; type: string } | null;
  uomCode?: string | null;
  taxName?: string | null;
}

export interface DocLink {
  id: string;
  docType: string;
  number: string;
  status: string;
  date?: string;
  grandTotal?: string;
}

export interface TradeDoc {
  id: string;
  docType: string;
  number: string;
  date: string;
  dueDate: string | null;
  status: string;
  customerId: string | null;
  supplierId: string | null;
  warehouseId: string | null;
  toWarehouseId: string | null;
  paymentTermId: string | null;
  projectId: string | null;
  opportunityId: string | null;
  ownerId: string | null;
  sourceId: string | null;
  currencyCode: string;
  exchangeRate: string;
  reference: string | null;
  /** Nomor Faktur Pajak (SI / PI) */
  taxInvoiceNumber?: string | null;
  /** go-live opening balance document */
  isOpening?: boolean;
  notes: string | null;
  terms: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  paidAmount: string;
  balance: string;
  partnerName: string | null;
  partnerEmail?: string | null;
  /** approval workflow state (lists only; absent when the document needs no approval) */
  approval?: { status: 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED'; level: number | null } | null;
  warehouseName?: string | null;
  toWarehouseName?: string | null;
  confirmedAt?: string | null;
  createdAt?: string;
  lines: DocLine[];
  source?: DocLink | null;
  derived?: DocLink[];
  payments?: { id: string; number: string; date: string; amount: string }[];
}

export function useDocTypes() {
  return useQuery({ queryKey: ['doc-types'], queryFn: () => api.get<DocTypeDef[]>('/documents/types'), staleTime: 5 * 60_000 });
}

export function useDocType(type: string | undefined) {
  const q = useDocTypes();
  const def = q.data?.find((d) => d.code === (type ?? '').toUpperCase());
  return { def, isLoading: q.isLoading, error: q.error };
}

export const DOC_STATUSES = ['DRAFT', 'CONFIRMED', 'PARTIAL', 'COMPLETED', 'CANCELLED'];

export function statusLabel(def: DocTypeDef | undefined, status: string) {
  if (def?.payable) {
    if (status === 'CONFIRMED') return 'Unpaid';
    if (status === 'PARTIAL') return 'Partially paid';
    if (status === 'COMPLETED') return 'Paid';
  }
  return undefined;
}

/** Route for any document type code (used for source/derived links) */
export const docPath = (type: string, id: string) => `/documents/${type}/${id}`;
