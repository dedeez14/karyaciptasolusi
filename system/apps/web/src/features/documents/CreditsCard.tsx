import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Button, Card, Field, NumberInput, Select, toast } from '@/components/ui';

interface Credits {
  applications: { id: string; amount: string; date: string; document: { id: string; number: string; docType: string; date: string } | null }[];
  openInvoices: { id: string; number: string; date: string; grandTotal: string; paidAmount: string; balance: string }[];
}

/**
 * Credit / debit note: the invoices it settled and its remaining credit (apply it to another open invoice).
 * Invoice: the notes that settled part of it.
 */
export function CreditsCard({ type, id, isNote, total, used, canApply }: { type: string; id: string; isNote: boolean; total: number; used: number; canApply: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['documents', type, id, 'credits'], queryFn: () => api.get<Credits>(`/documents/${type}/${id}/credits`) });
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const left = Math.round((total - used) * 100) / 100;
  const data = q.data;
  if (!data || (!isNote && !data.applications.length)) return null;
  const inv = data.openInvoices.find((o) => o.id === invoiceId);
  const apply = async () => {
    setBusy(true);
    try {
      await api.post(`/documents/${type}/${id}/apply-credit`, { invoiceId, amount: Number(amount) });
      toast.success(`Credit applied to ${inv?.number ?? 'the invoice'}`);
      setInvoiceId('');
      setAmount('');
      qc.invalidateQueries({ queryKey: ['documents'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={isNote ? 'Credit' : 'Settled by credit / debit notes'} subtitle={isNote ? (left > 0 ? `${fmtMoney(left)} not used yet` : 'Fully used') : undefined}>
      <div className="space-y-4">
        {data.applications.length > 0 && (
          <ul className="divide-y divide-line text-sm">
            {data.applications.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {a.document ? (
                    <Link to={`/documents/${a.document.docType}/${a.document.id}`} className="font-medium text-brand-700 hover:underline">
                      {a.document.number}
                    </Link>
                  ) : (
                    '—'
                  )}
                  <span className="ml-2 text-xs text-slate-500">{fmtDate(a.date)}</span>
                </span>
                <span className="font-medium tabular-nums">{fmtMoney(a.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {isNote && canApply && left > 0 && (
          data.openInvoices.length ? (
            <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
              <Field label="Apply to open invoice">
                <Select
                  value={invoiceId}
                  onChange={(e) => {
                    setInvoiceId(e.target.value);
                    const o = data.openInvoices.find((x) => x.id === e.target.value);
                    if (o) setAmount(String(Math.min(left, Number(o.balance))));
                  }}
                  placeholder="Choose invoice"
                  options={data.openInvoices.map((o) => ({ value: o.id, label: o.number, hint: `${fmtDate(o.date)} · balance ${fmtMoney(o.balance)}` }))}
                />
              </Field>
              <Field label="Amount">
                <NumberInput fixed={2} min={0} value={amount} onChange={setAmount} />
              </Field>
              <Button icon="check" loading={busy} disabled={!invoiceId || !(Number(amount) > 0)} onClick={apply}>
                Apply
              </Button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">No other open invoice of this partner. The remaining credit can be refunded through Cash &amp; Bank or used on a later invoice.</p>
          )
        )}
      </div>
    </Card>
  );
}
