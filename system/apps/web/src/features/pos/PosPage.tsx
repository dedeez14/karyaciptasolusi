import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, subscribe } from '@/lib/api';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, EmptyState, Field, Icon, Input, Modal, NumberInput, Select, Spinner, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';
import { chime, CloseShift, draftPayload, DraftList, LineEditor, MemberPicker, minutesAgo, openScreen, PayModal, ProductGrid, ReceiptModal, TotalsView, useDisplayPublisher, useInterval } from './pos-components';
import { OrderScreen } from './OrderScreen';
import type { DraftLine, Member, OpenOrder, Order, Outlet, PosConfig, Product, Shift, Table, Totals } from './pos-types';


/** Point of Sale: shops (scan & pay), counters (pay first, queue number) and restaurants (tables, open bills, courses) */
export default function PosPage() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const cfgQ = useQuery({ queryKey: ['pos', 'config'], queryFn: () => api.get<PosConfig>('/pos/config') });
  const cfg = cfgQ.data;
  const shift = cfg?.session ?? null;
  const outlet = cfg?.outlet ?? null;
  const productsQ = useQuery({ queryKey: ['pos', 'products', outlet?.id], queryFn: () => api.get<Product[]>('/pos/products', { outletId: outlet!.id }), enabled: !!outlet && !!shift, staleTime: 60_000 });
  const [view, setView] = useState<{ kind: 'counter' | 'floor' } | { kind: 'order'; id: string }>({ kind: 'counter' });
  const [closing, setClosing] = useState(false);
  const [bills, setBills] = useState(false);

  useEffect(() => {
    if (outlet) setView(outlet.serviceStyle === 'TABLE' ? { kind: 'floor' } : { kind: 'counter' });
  }, [outlet?.id, outlet?.serviceStyle]); // eslint-disable-line react-hooks/exhaustive-deps

  // live: other tills, waiters and the kitchen change bills
  useEffect(() => {
    if (!outlet || !shift) return;
    return subscribe(`/pos/outlets/${outlet.id}/stream?topics=orders,kitchen`, {
      onEvent: (e) => {
        if (e.event === 'orders' || e.event === 'kitchen') {
          qc.invalidateQueries({ queryKey: ['pos', 'orders', outlet.id] });
          qc.invalidateQueries({ queryKey: ['pos', 'order'] });
          qc.invalidateQueries({ queryKey: ['pos', 'calls', outlet.id] });
        }
        // guests at the tables (QR page): new orders, waiter calls, bill requests
        const d = e.data as { kind?: string; table?: string; type?: string; confirm?: boolean } | undefined;
        if (e.event === 'orders' && d?.kind === 'qr') {
          chime(2);
          toast.success(`QR order from table ${d.table}${d.confirm ? ': confirm and send it to the kitchen' : ''}`);
        }
        if (e.event === 'orders' && d?.kind === 'call') {
          chime(3);
          toast.success(d.type === 'BILL' ? `Table ${d.table} asks for the bill` : `Table ${d.table} calls a waiter`);
        }
      },
    });
  }, [outlet?.id, shift?.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!can('pos.sale.create')) return <EmptyState icon="shield-alert" title="You cannot use the cashier" />;
  if (cfgQ.isLoading || !cfg)
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  if (!cfg.outlets.length)
    return (
      <EmptyState
        icon="store"
        title="No outlet yet"
        description="Create an outlet first: the shop, restaurant or counter that sells, its warehouse, tax mode and service style"
        action={
          <Link to="/r/pos-outlets">
            <Button icon="plus">Create an outlet</Button>
          </Link>
        }
      />
    );
  if (!shift || !outlet) return <OpenShift outlets={cfg.outlets} onOpened={() => qc.invalidateQueries({ queryKey: ['pos'] })} />;

  const products = productsQ.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos'] });
  const home = () => setView(outlet.serviceStyle === 'TABLE' ? { kind: 'floor' } : { kind: 'counter' });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            {view.kind === 'order' && <Button variant="ghost" size="icon" icon="arrow-left" aria-label="Back" onClick={home} />}
            {outlet.name}
          </h1>
          <p className="text-xs text-slate-500">
            Shift {shift.number} · {outlet.mode === 'FNB' ? `Food & beverage${Number(outlet.pbjtRate) ? ` · PBJT ${Number(outlet.pbjtRate)}%` : ''}${Number(outlet.serviceChargePct) ? ` · service ${Number(outlet.serviceChargePct)}%` : ''}` : cfg.vatPayer ? 'Retail, PKP (receipt = faktur pajak digunggung)' : 'Retail, not a VAT payer'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {outlet.serviceStyle === 'TABLE' && view.kind !== 'floor' && (
            <Button variant="outline" icon="armchair" onClick={() => setView({ kind: 'floor' })}>
              Tables
            </Button>
          )}
          {outlet.serviceStyle === 'COUNTER' && (
            <Button variant="outline" icon="receipt" onClick={() => setBills(true)}>
              Open bills
            </Button>
          )}
          <Button variant="outline" icon="monitor" onClick={() => openScreen(`/screen/display?outlet=${outlet.id}`, 'kcs-customer-display')}>
            Customer display
          </Button>
          <Button variant="outline" icon="lock" onClick={() => setClosing(true)}>
            Close shift
          </Button>
        </div>
      </div>
      {view.kind === 'counter' && <CounterScreen cfg={cfg} outlet={outlet} shift={shift} products={products} loading={productsQ.isLoading} onHeld={(id) => setView({ kind: 'order', id })} />}
      {view.kind === 'floor' && <FloorView outlet={outlet} tables={cfg.tables} onOpen={(id) => setView({ kind: 'order', id })} />}
      {view.kind === 'order' && <OrderScreen key={view.id} id={view.id} cfg={cfg} outlet={outlet} shift={shift} products={products} onOpen={(id) => setView({ kind: 'order', id })} onDone={home} />}
      {bills && (
        <OpenBills
          outlet={outlet}
          onClose={() => setBills(false)}
          onOpen={(id) => {
            setBills(false);
            setView({ kind: 'order', id });
          }}
        />
      )}
      {closing && <CloseShift shift={shift} onClose={() => setClosing(false)} onClosed={refresh} />}
    </div>
  );
}

function OpenShift({ outlets, onOpened }: { outlets: PosConfig['outlets']; onOpened: () => void }) {
  const [f, setF] = useState({ outletId: outlets.length === 1 ? outlets[0].id : '', cashAccountId: null as string | null, openingCash: '0' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const open = useMutation({
    mutationFn: () => api.post('/pos/sessions', { ...f, openingCash: Number(f.openingCash) || 0 }),
    onSuccess: () => {
      toast.success('Shift opened');
      onOpened();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });
  return (
    <div className="mx-auto max-w-md py-8">
      <Card title="Open a cashier shift" subtitle="Count the cash in the drawer before you start">
        <div className="space-y-4">
          <Field label="Outlet" required error={errors.outletId}>
            <Select value={f.outletId} onChange={(e) => setF({ ...f, outletId: e.target.value })} placeholder="Choose the outlet" options={outlets.map((o) => ({ value: o.id, label: `${o.name} · ${o.mode === 'FNB' ? 'food & beverage' : 'retail'}, ${o.serviceStyle === 'TABLE' ? 'table service' : 'counter'}` }))} />
          </Field>
          <Field label="Cash drawer (cash account)" required error={errors.cashAccountId}>
            <AsyncSelect resource="bank-accounts" value={f.cashAccountId} onChange={(v) => setF({ ...f, cashAccountId: v })} />
          </Field>
          <Field label="Opening cash">
            <NumberInput fixed={2} min={0} value={f.openingCash} onChange={(v) => setF({ ...f, openingCash: v })} />
          </Field>
          <Button className="w-full" icon="lock-open" loading={open.isPending} disabled={!f.outletId || !f.cashAccountId} onClick={() => open.mutate()}>
            Open shift
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ counter (shop / cafe)
function CounterScreen({ cfg, outlet, shift, products, loading, onHeld }: { cfg: PosConfig; outlet: Outlet; shift: Shift; products: Product[]; loading: boolean; onHeld: (orderId: string) => void }) {
  const qc = useQueryClient();
  const [cart, setCart] = useState<DraftLine[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [voucher, setVoucher] = useState('');
  const [voucherInput, setVoucherInput] = useState('');
  const [orderType, setOrderType] = useState<'TAKEAWAY' | 'DINE_IN'>('TAKEAWAY');
  const [label, setLabel] = useState('');
  const [editing, setEditing] = useState<{ product: Product; line?: DraftLine } | null>(null);
  const [paying, setPaying] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [showCart, setShowCart] = useState(false);
  const fnb = outlet.mode === 'FNB';
  const publish = useDisplayPublisher(outlet.id);

  const body = { outletId: outlet.id, customerId: member?.id ?? null, voucherCode: voucher || null, lines: cart.map(draftPayload) };
  const quoteQ = useQuery({
    queryKey: ['pos', 'quote', JSON.stringify(body)],
    queryFn: () => api.post<Totals>('/pos/quote', body).then((t) => ({ ...t, lines: t.lines?.map((x, i) => ({ ...x, key: cart[i]?.key ?? x.key })) })),
    enabled: cart.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
  useEffect(() => {
    if (quoteQ.error && voucher) {
      toast.error(quoteQ.error);
      setVoucher('');
    }
  }, [quoteQ.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals: Totals = cart.length && quoteQ.data ? quoteQ.data : { discount: 0, subtotal: 0, serviceCharge: 0, taxTotal: 0, localTax: 0, total: 0, promotions: [] };
  const count = cart.reduce((a, l) => a + l.qty, 0);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart) m.set(l.product.id, (m.get(l.product.id) ?? 0) + l.qty);
    return m;
  }, [cart]);

  useEffect(() => {
    publish(
      cart.length
        ? { phase: paying ? 'pay' : 'cart', lines: cart.map((l) => ({ name: l.product.name, qty: l.qty, total: (l.product.price + l.modifiers.reduce((a, m) => a + m.price, 0)) * l.qty * (1 - l.discountPct / 100), detail: l.modifiers.map((m) => m.name).join(', ') })), totals, member: member ? { name: member.name, points: member.points } : null }
        : { phase: 'idle', lines: [] },
    );
  }, [cart, totals.total, paying, member]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (p: Product) => {
    if (p.modifiers.length) setEditing({ product: p });
    else
      setCart((c) => {
        const i = c.findIndex((l) => l.product.id === p.id && !l.modifiers.length && !l.note && !l.discountPct);
        if (i >= 0) return c.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
        return [...c, { key: Math.random().toString(36).slice(2), product: p, qty: 1, discountPct: 0, modifiers: [], note: '', course: 1 }];
      });
  };
  const reset = () => {
    setCart([]);
    setMember(null);
    setVoucher('');
    setVoucherInput('');
    setLabel('');
    setShowCart(false);
  };
  const hold = useMutation({
    mutationFn: () => api.post<Order>('/pos/orders', { ...body, orderType: fnb ? orderType : 'RETAIL', label: label || null, send: false }),
    onSuccess: (o) => {
      toast.success('Bill saved: open it again from Open bills');
      reset();
      qc.invalidateQueries({ queryKey: ['pos', 'orders'] });
      onHeld(o.id);
    },
    onError: (e) => toast.error(e),
  });

  const panel = (
    <Card
      title={`Cart${count ? ` · ${fmtNumber(count)} item(s)` : ''}`}
      actions={
        cart.length > 0 && (
          <Button size="sm" variant="ghost" icon="trash-2" onClick={reset}>
            Clear
          </Button>
        )
      }
      bodyClass="p-0"
      className="flex h-full flex-col"
    >
      {fnb && (
        <div className="flex gap-2 border-b border-line p-3">
          {(['TAKEAWAY', 'DINE_IN'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setOrderType(t)} className={cn('flex-1 rounded-lg py-1.5 text-xs font-medium ring-1', orderType === t ? 'bg-brand-600 text-white ring-brand-600' : 'ring-line')}>
              {t === 'TAKEAWAY' ? 'Take away' : 'Eat here'}
            </button>
          ))}
          <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Name" className="h-8 w-28 text-xs" />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">{!cart.length ? <EmptyState icon="shopping-cart" title="Empty" description="Tap a product or scan a barcode" /> : <DraftList lines={cart} totals={quoteQ.data} onChange={setCart} onEdit={(l) => setEditing({ product: l.product, line: l })} />}</div>
      <div className="space-y-2 border-t border-line p-4">
        <MemberPicker value={member} onChange={setMember} />
        <div className="flex gap-2">
          <Input value={voucherInput} onChange={(e) => setVoucherInput(e.target.value.toUpperCase())} placeholder="Voucher code" className="h-8 text-xs" maxLength={40} />
          <Button size="sm" variant="outline" disabled={!voucherInput.trim() || !cart.length} onClick={() => setVoucher(voucherInput.trim())}>
            Apply
          </Button>
        </div>
        <TotalsView t={totals} outlet={outlet} vatPayer={cfg.vatPayer} />
        <div className="flex gap-2 pt-1">
          {fnb && (
            <Button variant="outline" className="h-12" icon="clock" disabled={!cart.length} loading={hold.isPending} onClick={() => hold.mutate()}>
              Hold
            </Button>
          )}
          <Button className="h-12 flex-1 text-base" icon="wallet" disabled={!cart.length || quoteQ.isFetching} onClick={() => setPaying(true)}>
            Pay {fmtMoney(totals.total, 0)}
          </Button>
        </div>
      </div>
    </Card>
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-3 lg:h-[calc(100dvh-13rem)] lg:grid-cols-[1fr_24rem]">
        <ProductGrid products={products} loading={loading} onPick={pick} counts={counts} />
        <div className="hidden min-h-0 lg:block">{panel}</div>
      </div>
      <div className="fixed inset-x-0 bottom-16 z-30 border-t border-line bg-white p-3 lg:hidden">
        <Button className="h-12 w-full text-base" icon="shopping-cart" onClick={() => setShowCart(true)} disabled={!cart.length}>
          {count ? `${fmtNumber(count)} item(s) · ${fmtMoney(totals.total, 0)}` : 'Cart is empty'}
        </Button>
      </div>
      {showCart && (
        <Modal open onClose={() => setShowCart(false)} title="Cart" size="md">
          <div className="-m-5">{panel}</div>
        </Modal>
      )}
      {editing && (
        <LineEditor
          product={editing.product}
          initial={editing.line}
          showCourse={false}
          onClose={() => setEditing(null)}
          onDone={(l) => {
            setCart((c) => (editing.line ? c.map((x) => (x.key === l.key ? l : x)) : [...c, l]));
            setEditing(null);
          }}
        />
      )}
      {paying && (
        <PayModal
          total={totals.total}
          member={member}
          pointValue={cfg.loyalty.pointValue}
          onClose={() => setPaying(false)}
          onPaid={async (payments) => {
            const sale = await api.post<Order>('/pos/sales', { sessionId: shift.id, orderType: fnb ? orderType : 'RETAIL', customerId: member?.id ?? null, voucherCode: voucher || null, label: label || null, lines: cart.map(draftPayload), payments });
            toast.success(`Paid · ${sale.number}${sale.queueNo ? ` · queue ${sale.queueNo}` : ''}`);
            publish({ phase: 'done', lines: [], totals, paid: Number(sale.paid), change: Number(sale.change), queueNo: sale.queueNo });
            reset();
            setPaying(false);
            setReceiptId(sale.id);
            qc.invalidateQueries({ queryKey: ['pos', 'products'] });
          }}
        />
      )}
      {receiptId && <ReceiptModal id={receiptId} onClose={() => setReceiptId(null)} />}
    </>
  );
}

function OpenBills({ outlet, onClose, onOpen }: { outlet: Outlet; onClose: () => void; onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['pos', 'orders', outlet.id], queryFn: () => api.get<OpenOrder[]>('/pos/orders', { outletId: outlet.id }) });
  return (
    <Modal open onClose={onClose} title="Open bills">
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <EmptyState icon="receipt" title="No open bills" />
      ) : (
        <ul className="divide-y divide-line rounded-lg ring-1 ring-line">
          {q.data.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => onOpen(o.id)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-slate-50">
                <span>
                  <span className="font-medium">{o.label || o.queueNo || 'Bill'}</span>
                  <span className="block text-xs text-slate-500">
                    {o.items} item(s) · {minutesAgo(o.createdAt)} min
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{fmtMoney(o.total, 0)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ floor plan (table service)
function FloorView({ outlet, tables, onOpen }: { outlet: Outlet; tables: Table[]; onOpen: (orderId: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pos', 'orders', outlet.id], queryFn: () => api.get<OpenOrder[]>('/pos/orders', { outletId: outlet.id }), refetchInterval: 60_000 });
  const [, tick] = useState(0);
  useInterval(() => tick((x) => x + 1), 30_000);
  const [newFor, setNewFor] = useState<Table | 'tab' | null>(null);
  const [choose, setChoose] = useState<OpenOrder[] | null>(null);
  const orders = q.data ?? [];
  const byTable = useMemo(() => {
    const m = new Map<string, OpenOrder[]>();
    for (const o of orders) if (o.tableId) m.set(o.tableId, [...(m.get(o.tableId) ?? []), o]);
    return m;
  }, [orders]);
  const areas = useMemo(() => [...new Set(tables.map((t) => t.area || 'Tables'))], [tables]);
  const tabs = orders.filter((o) => !o.tableId);
  const callsQ = useQuery({ queryKey: ['pos', 'calls', outlet.id], queryFn: () => api.get<{ id: string; name: string; callType: 'WAITER' | 'BILL'; calledAt: string }[]>(`/pos/outlets/${outlet.id}/calls`), refetchInterval: 60_000 });
  const calls = new Map((callsQ.data ?? []).map((c) => [c.id, c]));
  const clearCall = async (id: string) => {
    await api.post(`/pos/tables/${id}/call/clear`).catch((e) => toast.error(e));
    qc.invalidateQueries({ queryKey: ['pos', 'calls', outlet.id] });
  };
  const tap = (t: Table) => {
    const list = byTable.get(t.id) ?? [];
    if (!list.length) setNewFor(t);
    else if (list.length === 1) onOpen(list[0].id);
    else setChoose(list);
  };
  if (!tables.length)
    return (
      <EmptyState
        icon="armchair"
        title="No tables at this outlet"
        description="Add the tables in Point of Sale > Tables"
        action={
          <Link to="/r/pos-tables">
            <Button icon="plus">Add tables</Button>
          </Link>
        }
      />
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-white ring-1 ring-line" /> Free
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-brand-100 ring-1 ring-brand-300" /> Seated
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-amber-100 ring-1 ring-amber-300" /> Bill printed
        </span>
        <span className="flex items-center gap-1">
          <Icon name="bell-ring" className="h-3.5 w-3.5 text-emerald-600" /> Food ready
        </span>
        <Button size="sm" variant="outline" icon="plus" className="ml-auto" onClick={() => setNewFor('tab')}>
          Take away / tab
        </Button>
      </div>
      {areas.map((a) => (
        <div key={a}>
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{a}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {tables
              .filter((t) => (t.area || 'Tables') === a)
              .map((t) => {
                const list = byTable.get(t.id) ?? [];
                const total = list.reduce((s, o) => s + o.total, 0);
                const printed = list.some((o) => o.billPrintedAt);
                const ready = list.some((o) => o.kitchenStatus === 'READY');
                const covers = list.reduce((s, o) => s + o.covers, 0);
                const qr = list.reduce((s, o) => s + (o.qrPending ?? 0), 0);
                const called = calls.get(t.id);
                return (
                  <button key={t.id} type="button" onClick={() => tap(t)} className={cn('relative flex aspect-square flex-col items-center justify-center rounded-xl p-2 text-center ring-1 transition active:scale-[0.98]', !list.length ? 'bg-white ring-line' : printed ? 'bg-amber-50 ring-amber-300' : 'bg-brand-50 ring-brand-300')}>
                    {ready && <Icon name="bell-ring" className="absolute top-1.5 right-1.5 h-4 w-4 text-emerald-600" />}
                    {qr > 0 && <span className="absolute top-1.5 left-1.5 flex items-center gap-0.5 rounded-full bg-violet-600 px-1.5 text-[10px] font-semibold text-white"><Icon name="qr-code" className="h-3 w-3" />{qr}</span>}
                    {called && (
                      <span
                        role="button"
                        tabIndex={0}
                        title="Done: clear the call"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearCall(t.id);
                        }}
                        className="absolute inset-x-1 bottom-1 animate-pulse rounded-md bg-red-600 px-1 py-0.5 text-[10px] font-semibold text-white"
                      >
                        {called.callType === 'BILL' ? 'Bill please' : 'Waiter!'} ✕
                      </span>
                    )}
                    <span className="text-base font-semibold">{t.name}</span>
                    {list.length ? (
                      <>
                        <span className="text-xs font-medium tabular-nums">{fmtMoney(total, 0)}</span>
                        <span className="text-[11px] text-slate-500">
                          {covers || '-'} pax · {minutesAgo(list[0].createdAt)}′{list.length > 1 ? ` · ${list.length} bills` : ''}
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px] text-slate-400">{t.seats} seats</span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
      {tabs.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Take away / tabs</p>
          <div className="flex flex-wrap gap-2">
            {tabs.map((o) => (
              <button key={o.id} type="button" onClick={() => onOpen(o.id)} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm ring-1 ring-line">
                <span className="font-medium">{o.label || o.queueNo || 'Bill'}</span>
                <span className="tabular-nums">{fmtMoney(o.total, 0)}</span>
                {o.kitchenStatus === 'READY' && <Badge tone="green">Ready</Badge>}
              </button>
            ))}
          </div>
        </div>
      )}
      {choose && (
        <Modal open onClose={() => setChoose(null)} title="Bills at this table" size="sm">
          <ul className="divide-y divide-line rounded-lg ring-1 ring-line">
            {choose.map((o) => (
              <li key={o.id}>
                <button type="button" className="flex w-full justify-between px-3 py-2 text-sm hover:bg-slate-50" onClick={() => onOpen(o.id)}>
                  <span>{o.label || 'Bill'}</span>
                  <span className="tabular-nums">{fmtMoney(o.total, 0)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {newFor && (
        <NewBill
          outlet={outlet}
          table={newFor === 'tab' ? null : newFor}
          onClose={() => setNewFor(null)}
          onCreated={(id) => {
            setNewFor(null);
            qc.invalidateQueries({ queryKey: ['pos', 'orders', outlet.id] });
            onOpen(id);
          }}
        />
      )}
    </div>
  );
}

function NewBill({ outlet, table, onClose, onCreated }: { outlet: Outlet; table: Table | null; onClose: () => void; onCreated: (id: string) => void }) {
  const [covers, setCovers] = useState(table ? Math.min(table.seats, 2) : 0);
  const [label, setLabel] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<Order>('/pos/orders', { outletId: outlet.id, orderType: table ? 'DINE_IN' : 'TAKEAWAY', tableId: table?.id ?? null, covers, label: label || null, lines: [] }),
    onSuccess: (o) => onCreated(o.id),
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={table ? `Seat ${table.name}` : 'New take-away / tab'}
      size="sm"
      footer={
        <Button icon="check" loading={create.isPending} disabled={!table && !label.trim()} onClick={() => create.mutate()}>
          Open bill
        </Button>
      }
    >
      <div className="space-y-3">
        {table && (
          <Field label="Guests">
            <div className="grid grid-cols-6 gap-1.5">
              {Array.from({ length: Math.max(6, table.seats) }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" onClick={() => setCovers(n)} className={cn('h-10 rounded-lg text-sm ring-1', covers === n ? 'bg-brand-600 text-white ring-brand-600' : 'ring-line')}>
                  {n}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label={table ? 'Bill name (optional)' : 'Name'} required={!table}>
          <Input autoFocus={!table} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="Customer name" />
        </Field>
      </div>
    </Modal>
  );
}
