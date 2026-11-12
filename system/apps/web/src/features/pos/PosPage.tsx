import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, EmptyState, Field, Icon, Input, Modal, NumberInput, Spinner, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';
import { useTaxRates } from '@/features/documents/LineEditor';
import { ScanInput } from '@/features/inventory/ScanInput';

interface Config {
  mode: 'RETAIL' | 'FNB';
  pricesIncludeTax: boolean;
  vatPayer: boolean;
  pbjtRate: number;
  receiptFooter: string;
  session: Shift | null;
}
interface Shift {
  id: string;
  number: string;
  warehouseId: string;
  cashAccountId: string;
  openingCash: string;
  openedAt: string;
}
interface Product {
  id: string;
  code: string;
  name: string;
  barcode: string | null;
  price: number;
  type: string;
  taxId: string | null;
  category: string | null;
  stock: number | null;
}
interface CartLine {
  p: Product;
  qty: number;
  discountPct: number;
}
type Method = 'CASH' | 'QRIS' | 'CARD' | 'TRANSFER';
const METHODS: { value: Method; label: string; icon: string }[] = [
  { value: 'CASH', label: 'Cash', icon: 'banknote' },
  { value: 'QRIS', label: 'QRIS', icon: 'qr-code' },
  { value: 'CARD', label: 'Card', icon: 'credit-card' },
  { value: 'TRANSFER', label: 'Transfer', icon: 'landmark' },
];
const r2 = (v: number) => Math.round(v * 100) / 100;

/** totals exactly as the server works them out (prices incl. VAT for a PKP retailer; PBJT added for food & beverage) */
function totals(cart: CartLine[], cfg: Config, rates: Record<string, number>) {
  const vatOn = cfg.vatPayer && cfg.mode !== 'FNB';
  let net = 0;
  let tax = 0;
  for (const l of cart) {
    const gross = r2((l.p.price * l.qty * (100 - l.discountPct)) / 100);
    const eff = vatOn && l.p.taxId ? rates[l.p.taxId] ?? 0 : 0;
    const n = eff > 0 && cfg.pricesIncludeTax ? r2((gross * 100) / (100 + eff)) : gross;
    const t = eff > 0 ? (cfg.pricesIncludeTax ? r2(gross - n) : r2((n * eff) / 100)) : 0;
    net += n;
    tax += t;
  }
  const pbjt = cfg.mode === 'FNB' && cfg.pbjtRate > 0 ? r2((net * cfg.pbjtRate) / 100) : 0;
  return { net: r2(net), tax: r2(tax), pbjt, total: r2(net + tax + pbjt) };
}

/** Point of Sale: cashier screen (touch, scanner, camera), split payments and thermal receipts */
export default function PosPage() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const rates = useTaxRates();
  const cfgQ = useQuery({ queryKey: ['pos', 'config'], queryFn: () => api.get<Config>('/pos/config') });
  const cfg = cfgQ.data;
  const shift = cfg?.session ?? null;
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [closing, setClosing] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [showCart, setShowCart] = useState(false);
  const productsQ = useQuery({ queryKey: ['pos', 'products', shift?.warehouseId], queryFn: () => api.get<Product[]>('/pos/products', { warehouseId: shift!.warehouseId }), enabled: !!shift, staleTime: 60_000 });
  const products = productsQ.data ?? [];
  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean) as string[])].sort(), [products]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products.filter((p) => (!category || p.category === category) && (!s || p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s)));
  }, [products, search, category]);
  const t = cfg ? totals(cart, cfg, rates) : { net: 0, tax: 0, pbjt: 0, total: 0 };
  const count = cart.reduce((a, l) => a + l.qty, 0);

  const add = (p: Product) =>
    setCart((c) => {
      const i = c.findIndex((l) => l.p.id === p.id);
      if (i >= 0) return c.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { p, qty: 1, discountPct: 0 }];
    });
  const scan = (code: string) => {
    const p = products.find((x) => x.barcode === code || x.code.toLowerCase() === code.toLowerCase());
    if (p) add(p);
    else toast.error(`No product with barcode or code "${code}"`);
  };
  const setQty = (id: string, qty: number) => setCart((c) => (qty <= 0 ? c.filter((l) => l.p.id !== id) : c.map((l) => (l.p.id === id ? { ...l, qty } : l))));

  if (!can('pos.sale.create')) return <EmptyState icon="shield-alert" title="You cannot use the cashier" />;
  if (cfgQ.isLoading || !cfg)
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  if (!shift) return <OpenShift onOpened={() => qc.invalidateQueries({ queryKey: ['pos'] })} />;

  const cartPanel = (
    <Card
      title={`Cart${count ? ` · ${fmtNumber(count)} item(s)` : ''}`}
      actions={
        cart.length > 0 && (
          <Button size="sm" variant="ghost" icon="trash-2" onClick={() => setCart([])}>
            Clear
          </Button>
        )
      }
      bodyClass="p-0"
      className="flex h-full flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!cart.length ? (
          <EmptyState icon="shopping-cart" title="Empty" description="Tap a product or scan a barcode" />
        ) : (
          <ul className="divide-y divide-line">
            {cart.map((l) => (
              <li key={l.p.id} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-sm font-medium">{l.p.name}</span>
                  <span className="text-sm font-semibold tabular-nums">{fmtMoney((l.p.price * l.qty * (100 - l.discountPct)) / 100, 0)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Button size="icon" variant="outline" icon="minus" className="h-7 w-7" onClick={() => setQty(l.p.id, l.qty - 1)} aria-label="Less" />
                  <span className="w-8 text-center text-sm tabular-nums">{fmtNumber(l.qty)}</span>
                  <Button size="icon" variant="outline" icon="plus" className="h-7 w-7" onClick={() => setQty(l.p.id, l.qty + 1)} aria-label="More" />
                  <span className="text-xs text-slate-500">× {fmtMoney(l.p.price, 0)}</span>
                  <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
                    Disc %
                    <NumberInput
                      min={0}
                      max={100}
                      value={l.discountPct ? String(l.discountPct) : ''}
                      onChange={(v) => setCart((c) => c.map((x) => (x.p.id === l.p.id ? { ...x, discountPct: Math.min(100, Math.max(0, Number(v) || 0)) } : x)))}
                      className="h-7 w-16 px-1 text-right text-xs"
                      aria-label={`Discount for ${l.p.name}`}
                    />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1 border-t border-line p-4 text-sm">
        <div className="mb-2">
          <AsyncSelect resource="customers" value={customerId} onChange={setCustomerId} placeholder="Walk-in customer" className="h-8 text-xs" />
        </div>
        {t.tax > 0 && (
          <>
            <div className="flex justify-between text-slate-500">
              <span>DPP</span>
              <span className="tabular-nums">{fmtMoney(t.net, 0)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>PPN{cfg.pricesIncludeTax ? ' (included)' : ''}</span>
              <span className="tabular-nums">{fmtMoney(t.tax, 0)}</span>
            </div>
          </>
        )}
        {t.pbjt > 0 && (
          <div className="flex justify-between text-slate-500">
            <span>PBJT {cfg.pbjtRate}%</span>
            <span className="tabular-nums">{fmtMoney(t.pbjt, 0)}</span>
          </div>
        )}
        <div className="flex justify-between pt-1 text-lg font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{fmtMoney(t.total, 0)}</span>
        </div>
        <Button className="mt-2 h-12 w-full text-base" icon="wallet" disabled={!cart.length} onClick={() => setPaying(true)}>
          Pay {fmtMoney(t.total, 0)}
        </Button>
      </div>
    </Card>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Cashier</h1>
          <p className="text-xs text-slate-500">
            Shift {shift.number} · {cfg.mode === 'FNB' ? 'Food & beverage (PBJT)' : cfg.vatPayer ? 'Retail, PKP (receipt = faktur pajak digunggung)' : 'Retail, not a VAT payer'}
          </p>
        </div>
        <Button variant="outline" icon="lock" onClick={() => setClosing(true)}>
          Close shift
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:h-[calc(100dvh-13rem)] lg:grid-cols-[1fr_24rem]">
        <div className="flex min-h-0 flex-col gap-3">
          <ScanInput onScan={scan} />
          <div className="flex gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products" className="h-9" />
          </div>
          {categories.length > 0 && (
            <div className="scrollbar-thin flex gap-1.5 overflow-x-auto pb-1">
              {[null, ...categories].map((c) => (
                <button key={c ?? 'all'} type="button" onClick={() => setCategory(c)} className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-medium', category === c ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-line')}>
                  {c ?? 'All'}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {productsQ.isLoading ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {shown.map((p) => {
                  const inCart = cart.find((l) => l.p.id === p.id)?.qty ?? 0;
                  const out = p.stock !== null && p.stock <= 0;
                  return (
                    <button key={p.id} type="button" onClick={() => add(p)} className={cn('card relative flex min-h-24 flex-col justify-between p-3 text-left transition hover:shadow-pop active:scale-[0.98]', inCart && 'ring-2 ring-brand-500')}>
                      {inCart > 0 && <span className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-1 text-xs font-semibold text-white">{fmtNumber(inCart)}</span>}
                      <span className="line-clamp-2 text-sm font-medium text-slate-900">{p.name}</span>
                      <span className="mt-2 flex items-end justify-between gap-1">
                        <span className="text-sm font-semibold text-brand-700 tabular-nums">{fmtMoney(p.price, 0)}</span>
                        {p.stock !== null && <span className={cn('text-[11px]', out ? 'font-medium text-red-600' : 'text-slate-400')}>{out ? 'out' : fmtNumber(p.stock)}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="hidden min-h-0 lg:block">{cartPanel}</div>
      </div>

      {/* phones: the cart is a bar at the bottom that opens as a sheet */}
      <div className="fixed inset-x-0 bottom-16 z-30 border-t border-line bg-white p-3 lg:hidden">
        <Button className="h-12 w-full text-base" icon="shopping-cart" onClick={() => setShowCart(true)} disabled={!cart.length}>
          {count ? `${fmtNumber(count)} item(s) · ${fmtMoney(t.total, 0)}` : 'Cart is empty'}
        </Button>
      </div>
      {showCart && (
        <Modal open onClose={() => setShowCart(false)} title="Cart" size="md">
          <div className="-m-5">{cartPanel}</div>
        </Modal>
      )}

      {paying && (
        <PayModal
          total={t.total}
          onClose={() => setPaying(false)}
          onPaid={async (payments) => {
            const sale = await api.post<{ id: string; number: string }>('/pos/sales', { sessionId: shift.id, customerId, lines: cart.map((l) => ({ productId: l.p.id, qty: l.qty, discountPct: l.discountPct })), payments });
            toast.success(`Paid · ${sale.number}`);
            setCart([]);
            setCustomerId(null);
            setPaying(false);
            setShowCart(false);
            setReceiptId(sale.id);
            qc.invalidateQueries({ queryKey: ['pos', 'products'] });
          }}
        />
      )}
      {receiptId && <ReceiptModal id={receiptId} onClose={() => setReceiptId(null)} />}
      {closing && <CloseShift shift={shift} onClose={() => setClosing(false)} onClosed={() => qc.invalidateQueries({ queryKey: ['pos'] })} />}
    </div>
  );
}

function OpenShift({ onOpened }: { onOpened: () => void }) {
  const [f, setF] = useState({ warehouseId: null as string | null, cashAccountId: null as string | null, openingCash: '0' });
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
          <Field label="Sell from warehouse" required error={errors.warehouseId}>
            <AsyncSelect resource="warehouses" value={f.warehouseId} onChange={(v) => setF({ ...f, warehouseId: v })} />
          </Field>
          <Field label="Cash drawer (cash account)" required error={errors.cashAccountId}>
            <AsyncSelect resource="bank-accounts" value={f.cashAccountId} onChange={(v) => setF({ ...f, cashAccountId: v })} />
          </Field>
          <Field label="Opening cash">
            <NumberInput fixed={2} min={0} value={f.openingCash} onChange={(v) => setF({ ...f, openingCash: v })} />
          </Field>
          <Button className="w-full" icon="lock-open" loading={open.isPending} disabled={!f.warehouseId || !f.cashAccountId} onClick={() => open.mutate()}>
            Open shift
          </Button>
        </div>
      </Card>
    </div>
  );
}

function PayModal({ total, onClose, onPaid }: { total: number; onClose: () => void; onPaid: (p: { method: Method; amount: number; reference?: string }[]) => Promise<void> }) {
  const [rows, setRows] = useState<{ method: Method; amount: string; reference: string }[]>([{ method: 'CASH', amount: String(total), reference: '' }]);
  const [busy, setBusy] = useState(false);
  const paid = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const change = r2(paid - total);
  // exact amount, the next round banknote amounts, and the usual notes the customer may hand over
  const quick = [...new Set([total, ...[5000, 10000, 20000, 50000, 100000].map((d) => Math.ceil(total / d) * d), Math.ceil(total / 100000) * 100000 + 50000, Math.ceil(total / 100000) * 100000 + 100000])].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 5);
  const pay = async () => {
    setBusy(true);
    try {
      await onPaid(rows.filter((r) => Number(r.amount) > 0).map((r) => ({ method: r.method, amount: Number(r.amount), ...(r.reference ? { reference: r.reference } : {}) })));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Payment"
      footer={
        <Button className="h-12 w-full text-base" icon="check" loading={busy} disabled={paid < total - 0.005} onClick={pay}>
          {change > 0 ? `Complete · change ${fmtMoney(change, 0)}` : 'Complete sale'}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-4 text-center">
          <p className="text-xs text-slate-500">Amount due</p>
          <p className="text-3xl font-semibold tabular-nums">{fmtMoney(total, 0)}</p>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-line p-3">
            <div className="grid grid-cols-4 gap-1.5">
              {METHODS.map((m) => (
                <button key={m.value} type="button" onClick={() => setRows((x) => x.map((y, k) => (k === i ? { ...y, method: m.value } : y)))} className={cn('flex flex-col items-center gap-1 rounded-lg py-2 text-xs font-medium', r.method === m.value ? 'bg-brand-600 text-white' : 'bg-slate-50 text-slate-600')}>
                  <Icon name={m.icon} className="h-4 w-4" />
                  {m.label}
                </button>
              ))}
            </div>
            <NumberInput fixed={2} min={0} value={r.amount} onChange={(v) => setRows((x) => x.map((y, k) => (k === i ? { ...y, amount: v } : y)))} className="h-11 text-right text-lg" aria-label="Amount" />
            {r.method === 'CASH' ? (
              <div className="flex flex-wrap gap-1.5">
                {quick.map((v) => (
                  <Button key={v} size="sm" variant="outline" onClick={() => setRows((x) => x.map((y, k) => (k === i ? { ...y, amount: String(v) } : y)))}>
                    {fmtMoney(v, 0)}
                  </Button>
                ))}
              </div>
            ) : (
              <Input value={r.reference} maxLength={60} onChange={(e) => setRows((x) => x.map((y, k) => (k === i ? { ...y, reference: e.target.value } : y)))} placeholder="Approval / reference no. (optional)" />
            )}
            {rows.length > 1 && (
              <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setRows((x) => x.filter((_, k) => k !== i))}>
                Remove this payment
              </button>
            )}
          </div>
        ))}
        {rows.length < 4 && paid < total && (
          <Button variant="outline" size="sm" icon="plus" onClick={() => setRows((x) => [...x, { method: 'QRIS', amount: String(r2(total - paid)), reference: '' }])}>
            Split: add another payment
          </Button>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Paid</span>
          <span className="font-semibold tabular-nums">{fmtMoney(paid, 0)}</span>
        </div>
      </div>
    </Modal>
  );
}

interface Receipt {
  number: string;
  soldAt: string;
  cashier: string;
  subtotal: string;
  taxTotal: string;
  localTax: string;
  total: string;
  paid: string;
  change: string;
  status: string;
  pbjtRate: number;
  payments: { method: string; amount: number; reference?: string }[];
  lines: { name: string; qty: string; unitPrice: string; discountPct: string; lineTotal: string }[];
  seller: { name: string; address: string; phone: string | null; npwp: string | null; vatPayer: boolean };
  footer: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** thermal receipt (58 / 80 mm). For a PKP retailer it carries what a faktur pajak digunggung needs: seller name, address, NPWP, goods, price incl. PPN and the PPN */
function receiptHtml(r: Receipt, width: 58 | 80) {
  const money = (v: unknown) => Number(v).toLocaleString('id-ID', { maximumFractionDigits: 0 });
  const row = (a: string, b: string, bold = false) => `<div class="row${bold ? ' b' : ''}"><span>${a}</span><span>${b}</span></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.number)}</title><style>
@page { size: ${width}mm auto; margin: 3mm; }
body { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: ${width === 58 ? 10 : 11.5}px; color: #000; margin: 0; width: ${width - 6}mm; }
.c { text-align: center; } .row { display: flex; justify-content: space-between; gap: 6px; } .b { font-weight: 700; }
hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; } .small { font-size: ${width === 58 ? 9 : 10}px; }
</style></head><body>
<div class="c b">${esc(r.seller.name)}</div>
<div class="c small">${esc(r.seller.address)}${r.seller.phone ? `<br>Telp ${esc(r.seller.phone)}` : ''}${r.seller.npwp ? `<br>NPWP ${esc(r.seller.npwp)}` : ''}</div>
<hr>
${row(esc(r.number), new Date(r.soldAt).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}
${row('Kasir', esc(r.cashier))}
<hr>
${r.lines
  .map(
    (l) =>
      `<div>${esc(l.name)}</div>${row(`&nbsp;${Number(l.qty).toLocaleString('id-ID')} x ${money(l.unitPrice)}${Number(l.discountPct) ? ` (-${Number(l.discountPct)}%)` : ''}`, money(Number(l.lineTotal)))}`,
  )
  .join('')}
<hr>
${Number(r.taxTotal) > 0 ? row('DPP', money(r.subtotal)) + row('PPN', money(r.taxTotal)) : ''}
${Number(r.localTax) > 0 ? row('Subtotal', money(r.subtotal)) + row(`PBJT ${r.pbjtRate}%`, money(r.localTax)) : ''}
${row('TOTAL', money(r.total), true)}
${r.payments.map((p) => row(p.method === 'CASH' ? 'Tunai' : p.method, money(p.amount))).join('')}
${Number(r.change) > 0 ? row('Kembali', money(r.change)) : ''}
<hr>
${r.seller.vatPayer && Number(r.taxTotal) > 0 ? '<div class="c small">Harga sudah termasuk PPN. Struk ini berlaku sebagai faktur pajak (digunggung).</div>' : ''}
${r.status === 'VOID' ? '<div class="c b">*** DIBATALKAN ***</div>' : ''}
<div class="c small">${esc(r.footer)}</div>
</body></html>`;
}

function printReceipt(r: Receipt, width: 58 | 80) {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(receiptHtml(r, width));
  doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 2000);
  }, 200);
}

function ReceiptModal({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['pos', 'receipt', id], queryFn: () => api.get<Receipt>(`/pos/sales/${id}/receipt`) });
  const r = q.data;
  return (
    <Modal
      open
      onClose={onClose}
      title={r ? `Receipt ${r.number}` : 'Receipt'}
      size="sm"
      footer={
        <>
          <Button variant="outline" icon="printer" disabled={!r} onClick={() => r && printReceipt(r, 58)}>
            58 mm
          </Button>
          <Button icon="printer" disabled={!r} onClick={() => r && printReceipt(r, 80)}>
            Print 80 mm
          </Button>
        </>
      }
    >
      {!r ? (
        <Spinner />
      ) : (
        <div className="space-y-1 text-sm">
          <p className="text-center text-2xl font-semibold tabular-nums">{fmtMoney(r.total, 0)}</p>
          {Number(r.change) > 0 && <p className="text-center text-lg text-emerald-700">Change {fmtMoney(r.change, 0)}</p>}
          <p className="text-center text-xs text-slate-500">
            {r.lines.length} line(s) · {r.payments.map((p) => p.method).join(' + ')}
          </p>
          <Badge tone="green">Paid</Badge>
        </div>
      )}
    </Modal>
  );
}

function CloseShift({ shift, onClose, onClosed }: { shift: Shift; onClose: () => void; onClosed: () => void }) {
  const q = useQuery({ queryKey: ['pos', 'shift', shift.id], queryFn: () => api.get<{ expectedCash: string; totals: { count: number; voided: number; sales: number; byMethod: Record<string, number> } }>(`/pos/sessions/${shift.id}`) });
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const close = useMutation({
    mutationFn: () => api.post(`/pos/sessions/${shift.id}/close`, { countedCash: Number(counted) || 0, notes }),
    onSuccess: () => {
      toast.success('Shift closed');
      onClosed();
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  const d = q.data;
  const diff = d ? (Number(counted) || 0) - Number(d.expectedCash) : 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Close shift ${shift.number}`}
      footer={
        <Button icon="lock" loading={close.isPending} disabled={counted === ''} onClick={() => close.mutate()}>
          Close shift
        </Button>
      }
    >
      {!d ? (
        <Spinner />
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Receipts</p>
              <p className="text-lg font-semibold">
                {d.totals.count}
                {d.totals.voided ? <span className="text-xs font-normal text-red-600"> · {d.totals.voided} voided</span> : null}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Sales</p>
              <p className="text-lg font-semibold tabular-nums">{fmtMoney(d.totals.sales, 0)}</p>
            </div>
          </div>
          <ul className="space-y-1">
            {Object.entries(d.totals.byMethod).map(([m, v]) => (
              <li key={m} className="flex justify-between">
                <span className="text-slate-500">{m === 'CASH' ? 'Cash (after change)' : m}</span>
                <span className="tabular-nums">{fmtMoney(v, 0)}</span>
              </li>
            ))}
            <li className="flex justify-between border-t border-line pt-1 font-medium">
              <span>Expected in drawer (incl. opening {fmtMoney(shift.openingCash, 0)})</span>
              <span className="tabular-nums">{fmtMoney(d.expectedCash, 0)}</span>
            </li>
          </ul>
          <Field label="Cash counted in the drawer" required>
            <NumberInput fixed={2} min={0} value={counted} onChange={setCounted} />
          </Field>
          {counted !== '' && Math.abs(diff) > 0.005 && <p className={cn('text-sm font-medium', diff < 0 ? 'text-red-600' : 'text-amber-600')}>{diff < 0 ? `Short ${fmtMoney(-diff, 0)}` : `Over ${fmtMoney(diff, 0)}`}: posted as cash over / short</p>}
          <Field label="Notes">
            <Input value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
