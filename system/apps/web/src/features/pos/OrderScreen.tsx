import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, EmptyState, Field, Icon, Input, Modal, NumberInput, Spinner, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';
import { draftPayload, DraftList, LineEditor, lineLabel, MemberPicker, minutesAgo, PayModal, ProductGrid, ReasonModal, ReceiptModal, TotalsView, useDisplayPublisher } from './pos-components';
import { toTotals, type DraftLine, type Member, type OpenOrder, type Order, type OrderLine, type Outlet, type PosConfig, type Product, type Shift } from './pos-types';

const TICKET_TONE: Record<string, 'gray' | 'amber' | 'blue' | 'green' | 'violet' | 'red'> = { HELD: 'violet', NEW: 'amber', PREPARING: 'blue', READY: 'green', SERVED: 'gray', VOID: 'red' };
const TICKET_LABEL: Record<string, string> = { HELD: 'On hold', NEW: 'Sent', PREPARING: 'Cooking', READY: 'Ready', SERVED: 'Served', VOID: 'Voided' };

/** one open bill: add items, send to the kitchen by course, split / merge / move, print the bill, pay */
export function OrderScreen({ id, cfg, outlet, shift, products, onOpen, onDone }: { id: string; cfg: PosConfig; outlet: Outlet; shift: Shift; products: Product[]; onOpen: (id: string) => void; onDone: () => void }) {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['pos', 'order', id], queryFn: () => api.get<Order>(`/pos/orders/${id}`) });
  const o = q.data;
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [editing, setEditing] = useState<{ product: Product; line?: DraftLine } | null>(null);
  const [paying, setPaying] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'split' | 'merge' | 'move' | 'cancel' | 'edit' | { voidLine: OrderLine }>(null);
  const [voucher, setVoucher] = useState('');
  const publish = useDisplayPublisher(outlet.id);
  const set = (x: Order) => qc.setQueryData(['pos', 'order', id], x);
  const err = (e: unknown) => toast.error(e);

  const add = useMutation({ mutationFn: (send: boolean) => api.post<Order>(`/pos/orders/${id}/lines`, { lines: draft.map(draftPayload), send }), onSuccess: (x, send) => (set(x), setDraft([]), toast.success(send ? 'Sent to the kitchen' : 'Added to the bill')), onError: err });
  const send = useMutation({ mutationFn: () => api.post<Order>(`/pos/orders/${id}/send`), onSuccess: (x) => (set(x), toast.success('Sent to the kitchen')), onError: err });
  const fire = useMutation({ mutationFn: (course: number) => api.post<Order>(`/pos/orders/${id}/fire`, { course }), onSuccess: (x) => (set(x), toast.success('Course fired')), onError: err });
  const update = useMutation({ mutationFn: (body: Record<string, unknown>) => api.put<Order>(`/pos/orders/${id}`, body), onSuccess: (x) => set(x), onError: err });
  const bill = useMutation({ mutationFn: () => api.post(`/pos/orders/${id}/bill`), onSuccess: () => (setReceiptId(id), qc.invalidateQueries({ queryKey: ['pos', 'order', id] })), onError: err });
  const collected = useMutation({ mutationFn: () => api.post(`/pos/orders/${id}/collected`), onSuccess: () => qc.invalidateQueries({ queryKey: ['pos', 'order', id] }), onError: err });

  const active = useMemo(() => (o?.lines ?? []).filter((l) => l.status === 'ACTIVE'), [o]);
  const unsent = active.filter((l) => !l.sentAt);
  const held = (o?.tickets ?? []).filter((t) => t.status === 'HELD');
  const nextCourse = held.length ? Math.min(...held.map((t) => t.course)) : null;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of [...draft]) m.set(l.product.id, (m.get(l.product.id) ?? 0) + l.qty);
    return m;
  }, [draft]);

  useEffect(() => {
    if (!o) return;
    publish({ phase: paying ? 'pay' : 'cart', lines: active.map((l) => ({ name: l.name, qty: Number(l.qty), total: Number(l.unitPrice) * Number(l.qty) * (1 - Number(l.discountPct) / 100), detail: l.modifiers.map((m) => m.name).join(', ') })), totals: toTotals(o), member: o.customer?.memberNo ? { name: o.customer.name, points: o.customer.points } : null });
  }, [o, paying]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading || !o)
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  if (o.status !== 'OPEN')
    return (
      <EmptyState
        icon="receipt"
        title={o.status === 'PAID' ? `Paid · ${o.number}` : 'This bill is closed'}
        action={
          <Button variant="outline" onClick={onDone}>
            Back
          </Button>
        }
      />
    );

  const pick = (p: Product) => {
    if (p.modifiers.length) setEditing({ product: p });
    else
      setDraft((c) => {
        const i = c.findIndex((l) => l.product.id === p.id && !l.modifiers.length && !l.note && l.course === 1);
        if (i >= 0) return c.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
        return [...c, { key: Math.random().toString(36).slice(2), product: p, qty: 1, discountPct: 0, modifiers: [], note: '', course: 1 }];
      });
  };
  const title = o.table ? o.table.name : o.label || o.queueNo || 'Bill';
  const tableService = outlet.serviceStyle === 'TABLE';

  return (
    <>
      <div className="grid grid-cols-1 gap-3 lg:h-[calc(100dvh-13rem)] lg:grid-cols-[1fr_26rem]">
        <ProductGrid products={products} onPick={pick} counts={counts} />
        <Card
          title={
            <span className="flex items-center gap-2">
              {title}
              {o.covers > 0 && <Badge tone="gray">{o.covers} pax</Badge>}
              {o.queueNo && <Badge tone="blue">{o.queueNo}</Badge>}
              {o.billPrintedAt && <Badge tone="amber">Bill printed</Badge>}
            </span>
          }
          subtitle={`${o.label && o.table ? `${o.label} · ` : ''}open ${minutesAgo(o.createdAt)} min`}
          actions={<Button size="sm" variant="ghost" icon="pencil" onClick={() => setDialog('edit')} aria-label="Edit bill" />}
          bodyClass="p-0"
          className="flex min-h-0 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!active.length && !draft.length && <EmptyState icon="utensils" title="Nothing ordered yet" description="Tap the menu to add items" />}
            {active.length > 0 && (
              <ul className="divide-y divide-line">
                {active.map((l) => {
                  const t = o.tickets.find((x) => x.id === l.ticketId);
                  return (
                    <li key={l.id} className="flex items-start justify-between gap-2 px-4 py-2">
                      <div className="min-w-0">
                        <p className="text-sm">
                          <span className="font-medium tabular-nums">{fmtNumber(Number(l.qty))}×</span> {l.name}
                        </p>
                        {lineLabel(l) && <p className="text-xs text-slate-500">{lineLabel(l)}</p>}
                        <p className="mt-0.5 flex flex-wrap gap-1">
                          {(l as OrderLine & { source?: string }).source === 'QR' && <Badge tone="violet">QR</Badge>}
                          {!l.sentAt ? <Badge tone="gray">{(l as OrderLine & { source?: string }).source === 'QR' ? 'Waiting for your OK' : 'Not sent'}</Badge> : t ? <Badge tone={TICKET_TONE[t.status]}>{TICKET_LABEL[t.status]}</Badge> : <Badge tone="gray">Served at counter</Badge>}
                          {l.course > 1 && <Badge tone="violet">Course {l.course}</Badge>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-semibold tabular-nums">{fmtMoney(Number(l.unitPrice) * Number(l.qty) * (1 - Number(l.discountPct) / 100), 0)}</span>
                        {(!l.sentAt || can('pos.sale.void')) && <Button size="icon" variant="ghost" icon="x" className="h-7 w-7 text-slate-400" aria-label={`Remove ${l.name}`} onClick={() => setDialog({ voidLine: l })} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {draft.length > 0 && (
              <div className="border-t-4 border-brand-100">
                <p className="px-4 pt-2 text-xs font-semibold tracking-wide text-brand-700 uppercase">New items</p>
                <DraftList lines={draft} onChange={setDraft} onEdit={(l) => setEditing({ product: l.product, line: l })} />
              </div>
            )}
          </div>
          <div className="space-y-2 border-t border-line p-4">
            {draft.length > 0 ? (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" loading={add.isPending && add.variables === false} onClick={() => add.mutate(false)}>
                  Add, send later
                </Button>
                <Button className="flex-1" icon="send" loading={add.isPending && add.variables === true} onClick={() => add.mutate(true)}>
                  Send {fmtNumber(draft.reduce((a, l) => a + l.qty, 0))}
                </Button>
              </div>
            ) : (
              <>
                {(unsent.length > 0 || nextCourse) && (
                  <div className="flex gap-2">
                    {unsent.length > 0 && (
                      <Button className="flex-1" icon="send" loading={send.isPending} onClick={() => send.mutate()}>
                        Send to kitchen ({unsent.length})
                      </Button>
                    )}
                    {nextCourse && (
                      <Button variant="outline" className="flex-1" icon="flame" loading={fire.isPending} onClick={() => fire.mutate(nextCourse)}>
                        Fire course {nextCourse}
                      </Button>
                    )}
                  </div>
                )}
                <MemberPicker value={o.customer ? ({ ...o.customer, code: '', phone: null } as Member) : null} onChange={(m) => update.mutate({ customerId: m?.id ?? null })} />
                <div className="flex gap-2">
                  <Input value={voucher} onChange={(e) => setVoucher(e.target.value.toUpperCase())} placeholder={o.voucherCode ? `Voucher ${o.voucherCode}` : 'Voucher code'} className="h-8 text-xs" maxLength={40} />
                  {o.voucherCode && !voucher ? (
                    <Button size="sm" variant="outline" onClick={() => update.mutate({ voucherCode: null })}>
                      Remove
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={!voucher.trim()} onClick={() => update.mutate({ voucherCode: voucher.trim() }, { onSuccess: () => setVoucher('') })}>
                      Apply
                    </Button>
                  )}
                </div>
                <TotalsView t={toTotals(o)} outlet={outlet} vatPayer={cfg.vatPayer} />
                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  <Button size="sm" variant="outline" icon="printer" loading={bill.isPending} disabled={!active.length} onClick={() => bill.mutate()}>
                    Bill
                  </Button>
                  <Button size="sm" variant="outline" icon="split" disabled={active.length < 1} onClick={() => setDialog('split')}>
                    Split
                  </Button>
                  <Button size="sm" variant="outline" icon="merge" onClick={() => setDialog('merge')}>
                    Merge
                  </Button>
                  {tableService ? (
                    <Button size="sm" variant="outline" icon="arrow-right-left" onClick={() => setDialog('move')}>
                      Move
                    </Button>
                  ) : o.kitchenStatus === 'READY' ? (
                    <Button size="sm" variant="outline" icon="check" loading={collected.isPending} onClick={() => collected.mutate()}>
                      Picked up
                    </Button>
                  ) : (
                    <span />
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-12" icon="trash-2" aria-label="Cancel bill" onClick={() => setDialog('cancel')} />
                  <Button className="h-12 flex-1 text-base" icon="wallet" disabled={!active.length} onClick={() => setPaying(true)}>
                    Pay {fmtMoney(o.total, 0)}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {editing && (
        <LineEditor
          product={editing.product}
          initial={editing.line}
          showCourse={tableService}
          onClose={() => setEditing(null)}
          onDone={(l) => {
            setDraft((c) => (editing.line ? c.map((x) => (x.key === l.key ? l : x)) : [...c, l]));
            setEditing(null);
          }}
        />
      )}
      {paying && (
        <PayModal
          total={Number(o.total)}
          member={o.customer ? ({ ...o.customer, code: '', phone: null } as Member) : null}
          pointValue={cfg.loyalty.pointValue}
          onClose={() => setPaying(false)}
          onPaid={async (payments) => {
            const x = await api.post<Order>(`/pos/orders/${id}/pay`, { sessionId: shift.id, payments });
            toast.success(`Paid · ${x.number}`);
            publish({ phase: 'done', lines: [], totals: toTotals(x), paid: Number(x.paid), change: Number(x.change), queueNo: x.queueNo });
            setPaying(false);
            setReceiptId(x.id);
            qc.invalidateQueries({ queryKey: ['pos'] });
          }}
        />
      )}
      {receiptId && (
        <ReceiptModal
          id={receiptId}
          onClose={() => {
            setReceiptId(null);
            if (qc.getQueryData<Order>(['pos', 'order', id])?.status !== 'OPEN') onDone();
          }}
        />
      )}
      {dialog === 'split' && <SplitDialog order={o} onClose={() => setDialog(null)} onSplit={(x) => (setDialog(null), qc.invalidateQueries({ queryKey: ['pos', 'order', id] }), onOpen(x.id))} />}
      {dialog === 'merge' && <MergeDialog order={o} outlet={outlet} onClose={() => setDialog(null)} onMerged={(x) => (set(x), setDialog(null))} />}
      {dialog === 'move' && <MoveDialog order={o} cfg={cfg} onClose={() => setDialog(null)} onMoved={(x) => (set(x), setDialog(null))} />}
      {dialog === 'edit' && <EditBill order={o} onClose={() => setDialog(null)} onSave={(body) => update.mutate(body, { onSuccess: () => setDialog(null) })} />}
      {dialog === 'cancel' && (
        <ReasonModal
          title="Cancel this bill"
          action="Cancel bill"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            await api.post(`/pos/orders/${id}/cancel`, { reason });
            toast.success('Bill cancelled');
            qc.invalidateQueries({ queryKey: ['pos'] });
            onDone();
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && 'voidLine' in dialog && (
        <ReasonModal
          title={dialog.voidLine.sentAt ? `Void ${dialog.voidLine.name} (already in the kitchen)` : `Remove ${dialog.voidLine.name}`}
          action={dialog.voidLine.sentAt ? 'Void item' : 'Remove'}
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => set(await api.post<Order>(`/pos/orders/${id}/lines/${dialog.voidLine.id}/void`, { reason }))}
        />
      )}
    </>
  );
}

function SplitDialog({ order, onClose, onSplit }: { order: Order; onClose: () => void; onSplit: (o: Order) => void }) {
  const lines = order.lines.filter((l) => l.status === 'ACTIVE');
  const [qty, setQty] = useState<Record<string, string>>({});
  const chosen = lines.filter((l) => Number(qty[l.id]) > 0).map((l) => ({ lineId: l.id, qty: Math.min(Number(qty[l.id]), Number(l.qty)) }));
  const go = useMutation({ mutationFn: () => api.post<Order>(`/pos/orders/${order.id}/split`, { lines: chosen }), onSuccess: (x) => (toast.success('New bill created'), onSplit(x)), onError: (e) => toast.error(e) });
  return (
    <Modal
      open
      onClose={onClose}
      title="Split the bill"
      footer={
        <Button icon="split" loading={go.isPending} disabled={!chosen.length} onClick={() => go.mutate()}>
          Move to a new bill
        </Button>
      }
    >
      <p className="mb-3 text-xs text-slate-500">Choose what goes on the new bill (for example what one guest pays).</p>
      <ul className="divide-y divide-line rounded-lg ring-1 ring-line">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0">
              {l.name} <span className="text-xs text-slate-500">× {fmtNumber(Number(l.qty))}</span>
            </span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => setQty({ ...qty, [l.id]: String(Number(l.qty)) })}>
                All
              </Button>
              <NumberInput className="h-8 w-16 text-right" min={0} max={Number(l.qty)} value={qty[l.id] ?? ''} onChange={(v) => setQty({ ...qty, [l.id]: v })} aria-label={`Quantity of ${l.name}`} />
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function MergeDialog({ order, outlet, onClose, onMerged }: { order: Order; outlet: Outlet; onClose: () => void; onMerged: (o: Order) => void }) {
  const q = useQuery({ queryKey: ['pos', 'orders', outlet.id], queryFn: () => api.get<OpenOrder[]>('/pos/orders', { outletId: outlet.id }) });
  const go = useMutation({ mutationFn: (fromId: string) => api.post<Order>(`/pos/orders/${order.id}/merge`, { fromId }), onSuccess: (x) => (toast.success('Bills merged'), onMerged(x)), onError: (e) => toast.error(e) });
  const others = (q.data ?? []).filter((x) => x.id !== order.id);
  return (
    <Modal open onClose={onClose} title="Merge another bill into this one">
      {q.isLoading ? (
        <Spinner />
      ) : !others.length ? (
        <EmptyState icon="merge" title="No other open bills" />
      ) : (
        <ul className="divide-y divide-line rounded-lg ring-1 ring-line">
          {others.map((x) => (
            <li key={x.id}>
              <button type="button" disabled={go.isPending} onClick={() => go.mutate(x.id)} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span>{x.label || x.queueNo || 'Bill'}</span>
                <span className="tabular-nums">{fmtMoney(x.total, 0)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function MoveDialog({ order, cfg, onClose, onMoved }: { order: Order; cfg: PosConfig; onClose: () => void; onMoved: (o: Order) => void }) {
  const go = useMutation({ mutationFn: (tableId: string) => api.put<Order>(`/pos/orders/${order.id}`, { tableId }), onSuccess: (x) => (toast.success('Moved'), onMoved(x)), onError: (e) => toast.error(e) });
  return (
    <Modal open onClose={onClose} title="Move to another table">
      <div className="grid grid-cols-4 gap-2">
        {cfg.tables.map((t) => (
          <button key={t.id} type="button" disabled={t.id === order.tableId || go.isPending} onClick={() => go.mutate(t.id)} className={cn('rounded-lg px-2 py-3 text-sm ring-1', t.id === order.tableId ? 'bg-brand-600 text-white ring-brand-600' : 'ring-line hover:bg-slate-50')}>
            {t.name}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function EditBill({ order, onClose, onSave }: { order: Order; onClose: () => void; onSave: (b: Record<string, unknown>) => void }) {
  const [covers, setCovers] = useState(String(order.covers));
  const [label, setLabel] = useState(order.label ?? '');
  return (
    <Modal
      open
      onClose={onClose}
      title="Bill details"
      size="sm"
      footer={
        <Button icon="check" onClick={() => onSave({ covers: Number(covers) || 0, label: label || null })}>
          Save
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label="Guests">
          <NumberInput min={0} max={500} value={covers} onChange={setCovers} />
        </Field>
        <Field label="Bill name">
          <Input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <p className="flex items-center gap-1 text-xs text-slate-500">
          <Icon name="info" className="h-3.5 w-3.5" /> Prices and taxes follow the outlet settings when the bill was opened.
        </p>
      </div>
    </Modal>
  );
}
