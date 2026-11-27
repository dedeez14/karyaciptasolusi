import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { Button, Icon, Input, Modal, Spinner } from '@/components/ui';
import { cn } from '@/components/ui/primitives';

interface GuestProduct {
  id: string;
  name: string;
  price: number;
  category: string | null;
  station: string | null;
  soldOut: boolean;
  modifiers: { id: string; name: string; min: number; max: number; options: { id: string; name: string; price: number }[] }[];
}
interface Info {
  company: string;
  outlet: { name: string; mode: string; pricesIncludeTax: boolean; pbjtRate: number; serviceChargePct: number; confirm: boolean; vatPayer: boolean };
  table: { name: string; callType: string | null };
  open: boolean;
  products: GuestProduct[];
  bill: { total: number; serviceCharge: number; localTax: number; taxTotal: number; discount: number; lines: { name: string; qty: number; modifiers: string[]; total: number; status: string }[] } | null;
}
interface CartLine {
  key: string;
  p: GuestProduct;
  qty: number;
  options: { id: string; name: string; price: number }[];
  note: string;
}

const HEADERS = { 'X-Requested-With': 'kcs-web', 'Content-Type': 'application/json' };
const STATUS: Record<string, { label: string; cls: string }> = {
  WAITING: { label: 'Menunggu konfirmasi · waiting', cls: 'bg-slate-100 text-slate-600' },
  ORDERED: { label: 'Dipesan · ordered', cls: 'bg-slate-100 text-slate-600' },
  HELD: { label: 'Nanti · later course', cls: 'bg-violet-50 text-violet-700' },
  NEW: { label: 'Diterima dapur · received', cls: 'bg-amber-50 text-amber-700' },
  PREPARING: { label: 'Sedang dibuat · cooking', cls: 'bg-brand-50 text-brand-700' },
  READY: { label: 'Siap diantar · ready', cls: 'bg-emerald-50 text-emerald-700' },
  SERVED: { label: 'Sudah diantar · served', cls: 'bg-slate-100 text-slate-500' },
  VOID: { label: 'Dibatalkan · cancelled', cls: 'bg-red-50 text-red-600' },
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/v1/public/pos/table/${path}`, { method: body ? 'POST' : 'GET', headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { message?: string }).message || 'Something went wrong. Please ask a waiter.');
  return j as T;
}

/** public page behind the QR code on a table: menu, order to the table's bill, status, call a waiter / ask for the bill */
export default function GuestOrderPage() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pick, setPick] = useState<GuestProduct | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [quote, setQuote] = useState<{ subtotal: number; serviceCharge: number; localTax: number; taxTotal: number; discount: number; total: number } | null>(null);

  const load = useCallback(() => call<Info>(token).then(setInfo, (e: Error) => setError(e.message)), [token]);
  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);
  const payload = cart.map((l) => ({ productId: l.p.id, qty: l.qty, modifiers: l.options.map((o) => ({ optionId: o.id })), note: l.note || null }));
  useEffect(() => {
    if (!cart.length) return setQuote(null);
    const t = setTimeout(() => call<typeof quote>(`${token}/quote`, { lines: payload }).then(setQuote, () => setQuote(null)), 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(payload)]); // eslint-disable-line react-hooks/exhaustive-deps

  const cats = useMemo(() => [...new Set((info?.products ?? []).map((p) => p.category).filter(Boolean) as string[])], [info]);
  const count = cart.reduce((a, l) => a + l.qty, 0);
  const shelf = cart.reduce((a, l) => a + (l.p.price + l.options.reduce((x, o) => x + o.price, 0)) * l.qty, 0);
  const say = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(''), 4000);
  };
  const send = async () => {
    setBusy(true);
    try {
      const r = await call<{ sentToKitchen: boolean }>(`${token}/order`, { lines: payload, name: name || null });
      setCart([]);
      setShowCart(false);
      say(r.sentToKitchen ? 'Pesanan dikirim ke dapur · Order sent to the kitchen' : 'Pesanan terkirim, pelayan akan mengonfirmasi · A waiter will confirm your order');
      load();
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const callStaff = async (type: 'WAITER' | 'BILL') => {
    try {
      await call(`${token}/call`, { type });
      say(type === 'BILL' ? 'Pelayan akan membawakan bill · The bill is on its way' : 'Pelayan segera datang · A waiter is coming');
      load();
    } catch (e) {
      say((e as Error).message);
    }
  };

  if (error)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 p-6 text-center">
        <Icon name="qr-code" className="h-12 w-12 text-slate-400" />
        <p className="text-lg font-semibold">{error}</p>
      </div>
    );
  if (!info)
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  const o = info.outlet;
  const extras = [o.serviceChargePct ? `service ${o.serviceChargePct}%` : '', o.mode === 'FNB' && o.pbjtRate ? `PBJT ${o.pbjtRate}%` : '', o.mode === 'RETAIL' && o.vatPayer ? (o.pricesIncludeTax ? 'PPN included' : 'PPN added') : ''].filter(Boolean).join(' + ');
  const shown = info.products.filter((p) => !cat || p.category === cat);
  return (
    <div className="mx-auto min-h-dvh max-w-lg bg-slate-50 pb-28">
      <header className="sticky top-0 z-10 bg-brand-800 px-4 pt-4 pb-3 text-white shadow">
        <p className="text-xs opacity-80">{info.company}</p>
        <div className="flex items-end justify-between gap-2">
          <h1 className="text-xl font-semibold text-white">{o.name}</h1>
          <span className="rounded-full bg-white/15 px-3 py-1 text-sm">Meja / Table {info.table.name}</span>
        </div>
        {extras && <p className="mt-1 text-[11px] opacity-80">Prices in Rupiah · {extras} added to the bill</p>}
        <div className="scrollbar-thin -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4">
          {[null, ...cats].map((c) => (
            <button key={c ?? 'all'} type="button" onClick={() => setCat(c)} className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-medium', cat === c ? 'bg-white text-brand-800' : 'bg-white/15')}>
              {c ?? 'All'}
            </button>
          ))}
        </div>
      </header>
      {!info.open && <p className="m-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Pemesanan sedang tutup. Ordering is closed at the moment, please ask a waiter.</p>}
      <ul className="grid grid-cols-2 gap-2 p-3">
        {shown.map((p) => (
          <li key={p.id}>
            <button type="button" disabled={p.soldOut || !info.open} onClick={() => (p.modifiers.length ? setPick(p) : setCart((c) => [...c, { key: Math.random().toString(36).slice(2), p, qty: 1, options: [], note: '' }]))} className="flex h-full min-h-24 w-full flex-col justify-between rounded-xl bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 disabled:opacity-50">
              <span className="text-sm font-medium">{p.name}</span>
              <span className="mt-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-brand-700">{fmtMoney(p.price, 0)}</span>
                {p.soldOut ? <span className="text-xs text-red-600">Habis</span> : <Icon name="plus" className="h-4 w-4 text-brand-600" />}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {info.bill && info.bill.lines.length > 0 && (
        <section className="mx-3 mt-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-2 font-semibold">Pesanan meja ini · Your table</h2>
          <ul className="space-y-2 text-sm">
            {info.bill.lines.map((l, i) => (
              <li key={i} className="flex items-start justify-between gap-2">
                <span>
                  {fmtNumber(l.qty)}× {l.name}
                  {l.modifiers.length > 0 && <span className="block text-xs text-slate-500">{l.modifiers.join(', ')}</span>}
                  <span className={cn('mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px]', STATUS[l.status]?.cls)}>{STATUS[l.status]?.label ?? l.status}</span>
                </span>
                <span className="tabular-nums">{fmtMoney(l.total, 0)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex justify-between border-t border-slate-100 pt-2 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{fmtMoney(info.bill.total, 0)}</span>
          </p>
        </section>
      )}
      <div className="mx-3 mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" icon="bell-ring" onClick={() => callStaff('WAITER')}>
          Panggil pelayan
        </Button>
        <Button variant="outline" icon="receipt" disabled={!info.bill} onClick={() => callStaff('BILL')}>
          Minta bill
        </Button>
      </div>
      <p className="mx-3 mt-3 text-center text-[11px] text-slate-400">Pembayaran di kasir · Pay at the cashier. We do not ask for your personal data.</p>

      {flash && <div className="fixed inset-x-3 top-3 z-50 rounded-xl bg-slate-900 p-3 text-center text-sm text-white shadow-lg">{flash}</div>}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg p-3">
          <Button className="h-14 w-full text-base shadow-lg" icon="shopping-cart" onClick={() => setShowCart(true)}>
            {fmtNumber(count)} item · {fmtMoney(shelf, 0)} · Lihat pesanan
          </Button>
        </div>
      )}
      {pick && (
        <OptionsSheet
          p={pick}
          onClose={() => setPick(null)}
          onAdd={(line) => {
            setCart((c) => [...c, line]);
            setPick(null);
          }}
        />
      )}
      {showCart && (
        <Modal
          open
          onClose={() => setShowCart(false)}
          title={`Pesanan · Table ${info.table.name}`}
          footer={
            <Button className="h-12 w-full" icon="send" loading={busy} disabled={!cart.length || !info.open} onClick={send}>
              Kirim pesanan · Send order
            </Button>
          }
        >
          <ul className="divide-y divide-slate-100">
            {cart.map((l) => (
              <li key={l.key} className="flex items-start justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{l.p.name}</span>
                  {(l.options.length > 0 || l.note) && <span className="block text-xs text-slate-500">{[...l.options.map((x) => x.name), l.note].filter(Boolean).join(' · ')}</span>}
                </span>
                <span className="flex items-center gap-1.5">
                  <Button size="icon" variant="outline" icon={l.qty <= 1 ? 'trash-2' : 'minus'} className="h-7 w-7" aria-label="Less" onClick={() => setCart((c) => (l.qty <= 1 ? c.filter((x) => x.key !== l.key) : c.map((x) => (x.key === l.key ? { ...x, qty: x.qty - 1 } : x))))} />
                  <span className="w-5 text-center tabular-nums">{l.qty}</span>
                  <Button size="icon" variant="outline" icon="plus" className="h-7 w-7" aria-label="More" disabled={l.qty >= 20} onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))} />
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-1 text-sm">
            {quote && quote.discount > 0 && (
              <p className="flex justify-between text-emerald-700">
                <span>Promo</span>
                <span className="tabular-nums">−{fmtMoney(quote.discount, 0)}</span>
              </p>
            )}
            {quote && quote.serviceCharge > 0 && (
              <p className="flex justify-between text-slate-500">
                <span>Service {o.serviceChargePct}%</span>
                <span className="tabular-nums">{fmtMoney(quote.serviceCharge, 0)}</span>
              </p>
            )}
            {quote && quote.localTax > 0 && (
              <p className="flex justify-between text-slate-500">
                <span>PBJT {o.pbjtRate}%</span>
                <span className="tabular-nums">{fmtMoney(quote.localTax, 0)}</span>
              </p>
            )}
            {quote && quote.taxTotal > 0 && (
              <p className="flex justify-between text-slate-500">
                <span>PPN</span>
                <span className="tabular-nums">{fmtMoney(quote.taxTotal, 0)}</span>
              </p>
            )}
            <p className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{fmtMoney(quote?.total ?? shelf, 0)}</span>
            </p>
          </div>
          {!info.bill && (
            <div className="mt-3">
              <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Nama (opsional) · Name (optional)" />
            </div>
          )}
          {o.confirm && <p className="mt-2 text-xs text-slate-500">Pelayan akan mengonfirmasi pesanan sebelum dimasak · A waiter confirms before cooking.</p>}
        </Modal>
      )}
    </div>
  );
}

function OptionsSheet({ p, onClose, onAdd }: { p: GuestProduct; onClose: () => void; onAdd: (l: CartLine) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(p.modifiers.filter((g) => g.min > 0 && g.max === 1).map((g) => g.options[0]?.id).filter(Boolean)));
  const [note, setNote] = useState('');
  const toggle = (gid: string, oid: string) =>
    setPicked((s) => {
      const g = p.modifiers.find((x) => x.id === gid)!;
      const next = new Set(s);
      if (next.has(oid)) next.delete(oid);
      else {
        if (g.max === 1) for (const o of g.options) next.delete(o.id);
        else if (g.max > 0 && g.options.filter((o) => next.has(o.id)).length >= g.max) return s;
        next.add(oid);
      }
      return next;
    });
  const ok = p.modifiers.every((g) => g.options.filter((o) => picked.has(o.id)).length >= g.min);
  const options = p.modifiers.flatMap((g) => g.options.filter((o) => picked.has(o.id)));
  return (
    <Modal
      open
      onClose={onClose}
      title={p.name}
      footer={
        <Button className="h-12 w-full" icon="plus" disabled={!ok} onClick={() => onAdd({ key: Math.random().toString(36).slice(2), p, qty: 1, options, note: note.trim() })}>
          Tambah · {fmtMoney(p.price + options.reduce((a, o) => a + o.price, 0), 0)}
        </Button>
      }
    >
      <div className="space-y-4">
        {p.modifiers.map((g) => (
          <div key={g.id}>
            <p className="mb-1.5 text-sm font-medium">
              {g.name} <span className="text-xs font-normal text-slate-500">{g.min > 0 ? 'wajib · required' : 'opsional'}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {g.options.map((o) => (
                <button key={o.id} type="button" onClick={() => toggle(g.id, o.id)} className={cn('rounded-lg px-3 py-2 text-sm ring-1', picked.has(o.id) ? 'bg-brand-600 text-white ring-brand-600' : 'ring-slate-200')}>
                  {o.name}
                  {o.price > 0 && <span className="ml-1 text-xs opacity-80">+{fmtMoney(o.price, 0)}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
        <Input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="Catatan · Note (no ice, not spicy...)" />
      </div>
    </Modal>
  );
}
