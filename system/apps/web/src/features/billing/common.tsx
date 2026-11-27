import { Badge, type Tone } from '@/components/ui';
import { useLookupLabel } from '@/hooks/useLookups';
import type { DocTypeDef } from '@/features/documents/useDocTypes';

export type SubState = 'ACTIVE' | 'DUE' | 'PAUSED' | 'ENDED';

export interface SubscriptionRow {
  id: string;
  code: string;
  name: string;
  customerId: string;
  customerName: string | null;
  intervalCode: string;
  intervalCount: number;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  currencyCode: string;
  autoConfirm: boolean;
  autoEmail: boolean;
  isActive: boolean;
  lastRunAt: string | null;
  amount: string;
  state: SubState;
}

export interface SubscriptionLine {
  id: string;
  lineNo: number;
  productId: string | null;
  description: string | null;
  qty: string;
  uomId: string | null;
  unitPrice: string;
  discountPct: string;
  taxId: string | null;
  product: { id: string; code: string; name: string } | null;
  uomCode: string | null;
  taxName: string | null;
}

export interface SubscriptionDetail extends Omit<SubscriptionRow, 'amount'> {
  projectId: string | null;
  paymentTermId: string | null;
  emailTo: string | null;
  notes: string | null;
  lastInvoiceId: string | null;
  createdAt: string;
  customerEmail: string | null;
  projectName: string | null;
  paymentTermName: string | null;
  amounts: { net: string; tax: string; total: string };
  upcoming: string[];
  lines: SubscriptionLine[];
  invoices: {
    id: string;
    number: string;
    date: string;
    dueDate: string | null;
    status: string;
    grandTotal: string;
    paidAmount: string;
  }[];
}

export interface RunResult {
  subscriptionId: string;
  code: string;
  invoiceId?: string;
  invoiceNumber?: string;
  confirmed?: boolean;
  emailed?: boolean;
  error?: string;
  warning?: string;
}

const STATE: Record<SubState, { tone: Tone; label: string }> = {
  ACTIVE: { tone: 'green', label: 'Active' },
  DUE: { tone: 'amber', label: 'Due' },
  PAUSED: { tone: 'gray', label: 'Paused' },
  ENDED: { tone: 'red', label: 'Ended' },
};
export const SUB_STATES = Object.keys(STATE) as SubState[];
export const stateLabel = (s: SubState) => STATE[s]?.label ?? s;

export function StateBadge({ state }: { state: SubState }) {
  const s = STATE[state] ?? { tone: 'gray' as Tone, label: state };
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

/** "Monthly", "Every 2 × Quarterly" ... labels come from Master Data > BILLING_INTERVAL */
export function useIntervalText() {
  const label = useLookupLabel('BILLING_INTERVAL');
  return (code: string, count: number) => (count > 1 ? `Every ${count} × ${label(code)}` : label(code));
}

/** Line editor behaviour of a subscription: priced like a sales invoice (sale price & sales tax) */
export const SUBSCRIPTION_LINE_DEF: DocTypeDef = {
  code: 'SI',
  label: 'Subscription',
  printTitle: 'Invoice',
  module: 'sales',
  permission: 'sales.subscription',
  partner: 'customer',
  priced: true,
  priceField: 'salePrice',
  taxField: 'saleTaxId',
  warehouse: 'none',
  convertTo: [],
  can: {
    create: false,
    update: false,
    delete: false,
    confirm: false,
    print: false,
    cancel: false,
  },
};

/** Toast text for one generated invoice */
export function runMessage(r: RunResult) {
  if (r.error) return r.error;
  const parts = [`Invoice ${r.invoiceNumber} created`];
  if (r.confirmed) parts.push('confirmed');
  if (r.emailed) parts.push('e-mailed');
  return parts.join(', ') + (r.warning ? `. ${r.warning}` : '');
}
