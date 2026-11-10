import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { download, openInNewTab } from '@/lib/download';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, confirm, Dropdown, EmptyState, Field, Input, Modal, PageHeader, Spinner, StatusBadge, Textarea, toast } from '@/components/ui';
import { docPath, statusLabel, useDocType, useDocTypes, type TradeDoc } from './useDocTypes';

function EmailModal({ open, onClose, doc, title }: { open: boolean; onClose: () => void; doc: TradeDoc; title: string }) {
  const [form, setForm] = useState({ to: '', cc: '', subject: `${title} ${doc.number}`, message: `Dear ${doc.partnerName ?? 'Sir/Madam'},\n\nPlease find attached ${title.toLowerCase()} ${doc.number}.\n\nBest regards,` });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/documents/${doc.docType}/${doc.id}/email`, form);
      toast.success('E-mail sent and a copy archived in File Manager');
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send by e-mail"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="send" loading={busy} disabled={!form.to} onClick={send}>
            Send
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="To" required>
          <Input type="email" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
        </Field>
        <Field label="Cc">
          <Input type="email" value={form.cc} onChange={(e) => setForm({ ...form, cc: e.target.value })} />
        </Field>
        <Field label="Subject" required>
          <Input value={form.subject} maxLength={200} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </Field>
        <Field label="Message" help="The PDF is attached automatically.">
          <Textarea rows={6} value={form.message} maxLength={5000} onChange={(e) => setForm({ ...form, message: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export default function DocumentViewPage() {
  const { type = '', id = '' } = useParams();
  const { def, isLoading } = useDocType(type);
  const types = useDocTypes().data ?? [];
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [busy, setBusy] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const q = useQuery({ queryKey: ['documents', type.toUpperCase(), 'one', id], queryFn: () => api.get<TradeDoc>(`/documents/${type}/${id}`), enabled: !!def });

  if (isLoading || q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  if (!def) return <EmptyState icon="shield-alert" title="Not available" />;
  if (q.error || !q.data) return <EmptyState icon="file-x" title="Document not found" description={(q.error as Error)?.message} />;
  const d = q.data;
  const label = (code: string) => types.find((t) => t.code === code)?.label ?? code;

  const act = async (name: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(name);
    try {
      await fn();
      toast.success(success);
      qc.invalidateQueries({ queryKey: ['documents'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const doConfirm = async () => {
    const effect = def.stock ? ' Stock will be updated' : '';
    const journal = ['SI', 'PI', 'DO', 'GR', 'ADJ'].includes(def.code) ? ' and journal entries will be posted' : '';
    if (!(await confirm({ title: `Confirm ${d.number}?`, message: `After confirmation the document can no longer be edited.${effect}${journal}.`, confirmText: 'Confirm' }))) return;
    act('confirm', () => api.post(`/documents/${def.code}/${d.id}/confirm`), `${d.number} confirmed`);
  };
  const doCancel = async () => {
    if (!(await confirm({ title: `Cancel ${d.number}?`, message: 'Stock movements and journal entries created by this document will be reversed. This cannot be undone.', confirmText: 'Cancel document', danger: true }))) return;
    act('cancel', () => api.post(`/documents/${def.code}/${d.id}/cancel`), `${d.number} cancelled`);
  };
  const doDelete = async () => {
    if (!(await confirm({ title: `Delete draft ${d.number}?`, confirmText: 'Delete', danger: true }))) return;
    setBusy('delete');
    try {
      await api.delete(`/documents/${def.code}/${d.id}`);
      toast.success('Draft deleted');
      qc.invalidateQueries({ queryKey: ['documents', def.code] });
      navigate(`/documents/${def.code}`, { replace: true });
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  };
  const doConvert = async (target: string) => {
    setBusy(`convert-${target}`);
    try {
      const created = await api.post<TradeDoc>(`/documents/${def.code}/${d.id}/convert/${target}`);
      toast.success(`${label(target)} ${created.number} created as draft`);
      qc.invalidateQueries({ queryKey: ['documents'] });
      navigate(`/documents/${target}/${created.id}/edit`);
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  };
  const pdf = (mode: 'preview' | 'download' | 'save') =>
    act(
      `pdf-${mode}`,
      () => (mode === 'preview' ? openInNewTab(`/documents/${def.code}/${d.id}/pdf`) : download(`/documents/${def.code}/${d.id}/pdf`, mode === 'save' ? { save: 1 } : undefined)),
      mode === 'save' ? 'PDF saved to File Manager' : mode === 'download' ? 'PDF downloaded' : 'PDF opened',
    );

  const isDraft = d.status === 'DRAFT';
  const canConvert = ['CONFIRMED', 'PARTIAL', 'COMPLETED'].includes(d.status);
  const payPerm = def.code === 'SI' ? 'sales.payment.create' : 'purchase.payment.create';
  const canPay = def.payable && ['CONFIRMED', 'PARTIAL'].includes(d.status) && can(payPerm);
  const partnerId = d.customerId ?? d.supplierId;

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {def.label} {d.number}
            <StatusBadge status={d.status} label={statusLabel(def, d.status)} />
          </span>
        }
        subtitle={d.partnerName ?? undefined}
        back={() => navigate(`/documents/${def.code}`)}
        actions={
          <>
            {isDraft && def.can.update && (
              <Button variant="outline" icon="pencil" onClick={() => navigate(`/documents/${def.code}/${d.id}/edit`)}>
                Edit
              </Button>
            )}
            {isDraft && def.can.confirm && (
              <Button icon="check-circle-2" loading={busy === 'confirm'} onClick={doConfirm}>
                Confirm
              </Button>
            )}
            {canConvert &&
              def.convertTo
                .filter((t) => types.find((x) => x.code === t)?.can.create)
                .map((t) => (
                  <Button key={t} variant="outline" icon="arrow-right-circle" loading={busy === `convert-${t}`} onClick={() => doConvert(t)}>
                    Create {label(t)}
                  </Button>
                ))}
            {canPay && (
              <Button variant="success" icon="hand-coins" onClick={() => navigate(`/payments/${def.code === 'SI' ? 'in' : 'out'}/new?partnerId=${partnerId}&invoiceId=${d.id}`)}>
                Record payment
              </Button>
            )}
            <Dropdown
              trigger={<Button variant="outline" icon="more-horizontal" aria-label="More actions" />}
              items={[
                { label: 'Preview PDF', icon: 'eye', onClick: () => pdf('preview'), hidden: !def.can.print },
                { label: 'Download PDF', icon: 'download', onClick: () => pdf('download'), hidden: !def.can.print },
                { label: 'Save PDF to File Manager', icon: 'folder-input', onClick: () => pdf('save'), hidden: !def.can.print },
                { label: 'Send by e-mail', icon: 'mail', onClick: () => setEmailOpen(true), hidden: !def.can.print || !def.partner },
                'divider',
                { label: 'Cancel document', icon: 'ban', danger: true, onClick: doCancel, hidden: !def.can.cancel || d.status === 'CANCELLED' },
                { label: 'Delete draft', icon: 'trash-2', danger: true, onClick: doDelete, hidden: !def.can.delete || !isDraft },
              ]}
            />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Details">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {def.partner && <Info label={def.partyLabel ?? 'Partner'} value={d.partnerName} />}
              <Info label="Date" value={fmtDate(d.date)} />
              {def.dueDate && <Info label={def.code === 'SQ' ? 'Valid until' : 'Due date'} value={fmtDate(d.dueDate)} />}
              {d.warehouseName && <Info label={def.warehouse === 'transfer' ? 'From warehouse' : 'Warehouse'} value={d.warehouseName} />}
              {d.toWarehouseName && <Info label="To warehouse" value={d.toWarehouseName} />}
              <Info label="Reference" value={d.reference} />
              {def.priced && <Info label="Currency" value={`${d.currencyCode}${Number(d.exchangeRate) !== 1 ? ` @ ${fmtNumber(d.exchangeRate, 6)}` : ''}`} />}
              {d.confirmedAt && <Info label="Confirmed at" value={fmtDateTime(d.confirmedAt)} />}
            </dl>
          </Card>

          <Card title="Lines" bodyClass="p-0">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    {def.convertTo.length > 0 && !isDraft && <th className="px-3 py-2 text-right">Processed</th>}
                    {def.priced && <th className="px-3 py-2 text-right">Price</th>}
                    {def.priced && <th className="px-3 py-2 text-right">Disc</th>}
                    {def.priced && def.taxField && <th className="px-3 py-2">Tax</th>}
                    {def.priced && <th className="px-3 py-2 text-right">Amount</th>}
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((l, i) => (
                    <tr key={l.id ?? i} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{l.product?.name ?? l.description}</div>
                        <div className="text-xs text-slate-500">
                          {l.product?.code}
                          {l.product && l.description && l.description !== l.product.name ? ` · ${l.description}` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtNumber(l.qty)} {l.uomCode}
                      </td>
                      {def.convertTo.length > 0 && !isDraft && <td className="px-3 py-2 text-right text-slate-500 tabular-nums">{fmtNumber(l.processedQty)}</td>}
                      {def.priced && <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.unitPrice)}</td>}
                      {def.priced && <td className="px-3 py-2 text-right tabular-nums">{Number(l.discountPct) ? `${fmtNumber(l.discountPct, 2)}%` : ''}</td>}
                      {def.priced && def.taxField && <td className="px-3 py-2 text-xs">{l.taxName}</td>}
                      {def.priced && <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtMoney(Number(l.lineSubtotal) - Number(l.lineDiscount))}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
              {d.lines.map((l, i) => (
                <div key={l.id ?? i} className="px-4 py-3 text-sm">
                  <div className="font-medium">{l.product?.name ?? l.description}</div>
                  <div className="mt-1 flex justify-between text-xs text-slate-500">
                    <span>
                      {fmtNumber(l.qty)} {l.uomCode}
                      {def.priced ? ` × ${fmtMoney(l.unitPrice)}` : ''}
                      {Number(l.discountPct) ? ` (-${fmtNumber(l.discountPct, 2)}%)` : ''}
                    </span>
                    {def.priced && <span className="font-medium text-slate-700 dark:text-slate-200">{fmtMoney(Number(l.lineSubtotal) - Number(l.lineDiscount))}</span>}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {(d.notes || d.terms) && (
            <Card title="Notes & terms">
              {d.notes && <p className="text-sm whitespace-pre-line">{d.notes}</p>}
              {d.terms && <p className="mt-3 text-sm whitespace-pre-line text-slate-500">{d.terms}</p>}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {def.priced && (
            <Card title="Summary">
              <dl className="space-y-2 text-sm">
                <Row label="Subtotal" value={fmtMoney(d.subtotal)} />
                {Number(d.discountTotal) > 0 && <Row label="Discount" value={`-${fmtMoney(d.discountTotal)}`} />}
                <Row label="Tax" value={fmtMoney(d.taxTotal)} />
                <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold dark:border-slate-700">
                  <dt>Total</dt>
                  <dd className="tabular-nums">
                    {d.currencyCode} {fmtMoney(d.grandTotal)}
                  </dd>
                </div>
                {def.payable && (
                  <>
                    <Row label="Paid" value={fmtMoney(d.paidAmount)} />
                    <div className="flex justify-between font-semibold text-red-600">
                      <dt>Balance due</dt>
                      <dd className="tabular-nums">{fmtMoney(d.balance)}</dd>
                    </div>
                  </>
                )}
              </dl>
            </Card>
          )}

          {(d.source || (d.derived?.length ?? 0) > 0) && (
            <Card title="Related documents">
              <ul className="space-y-2 text-sm">
                {d.source && (
                  <li className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">Created from</span>
                    <Link className="font-medium text-brand-700 hover:underline" to={docPath(d.source.docType, d.source.id)}>
                      {label(d.source.docType)} {d.source.number}
                    </Link>
                  </li>
                )}
                {d.derived?.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2">
                    <Link className="font-medium text-brand-700 hover:underline" to={docPath(x.docType, x.id)}>
                      {label(x.docType)} {x.number}
                    </Link>
                    <StatusBadge status={x.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {def.payable && (
            <Card title="Payments">
              {d.payments?.length ? (
                <ul className="space-y-2 text-sm">
                  {d.payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <Link className="text-brand-700 hover:underline" to={`/payments/${def.code === 'SI' ? 'in' : 'out'}/${p.id}`}>
                        {p.number}
                      </Link>
                      <span className="text-slate-500">{fmtDate(p.date)}</span>
                      <span className="font-medium tabular-nums">{fmtMoney(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">No payments yet.</p>
              )}
            </Card>
          )}
          {d.status === 'CANCELLED' && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              <Badge tone="red">Cancelled</Badge> Stock and journal effects of this document were reversed.
            </div>
          )}
        </div>
      </div>
      {emailOpen && <EmailModal open={emailOpen} onClose={() => setEmailOpen(false)} doc={d} title={def.printTitle} />}
    </div>
  );
}

function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium">{value ? String(value) : <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
