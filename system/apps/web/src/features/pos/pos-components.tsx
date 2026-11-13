import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { Badge, Button, Checkbox, EmptyState, Field, Icon, Input, Modal, NumberInput, Spinner, Textarea, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';
import { ScanInput } from '@/features/inventory/ScanInput';
import type { DisplayState, DraftLine, Member, Method, Outlet, Payment, Product, Shift, Totals } from './pos-types';

export const r2 = (v: number) => Math.round(v * 100) / 100;
export const newKey = () => Math.random().toString(36).slice(2, 10);
export const draftPayload = (l: DraftLine) => ({ productId: l.product.id, qty: l.qty, discountPct: l.discountPct, modifiers: l.modifiers.map((m) => ({ optionId: m.optionId })), note: l.note || null, course: l.course });
export const minutesAgo = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
export const lineLabel = (l: { modifiers: { name: string }[]; note?: string | null }) => [...l.modifiers.map((m) => m.name), l.note ? `“${l.note}”` : ''].filter(Boolean).join(' · ');

// ------------------------------------------------------------------ customer display
/** sends what the customer should see to every display of the outlet (throttled) */
export function useDisplayPublisher(outletId: string | undefined) {
  const last = useRef<{ t: number; timer: ReturnType<typeof setTimeout> | null; state: DisplayState | null }>({ t: 0, timer: null, state: null });
  return useMemo(() => {
    const flush = () => {
      const s = last.current.state;
      last.current.timer = null;
      last.current.t = Date.now();
      if (outletId && s) api.post(`/pos/outlets/${outletId}/display`, { state: s }).catch(() => undefined);
    };
    return (state: DisplayState) => {
      last.current.state = state;
      if (last.current.timer) return;
      const wait = Math.max(0, 300 - (Date.now() - last.current.t));
      last.current.timer = setTimeout(flush, wait);
    };
  }, [outletId]);
}

/** short chime without audio files (WebAudio) */
export function chime(times = 2) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = i % 2 ? 660 : 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.35);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.35 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.35 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.35);
      o.stop(ctx.currentTime + i * 0.35 + 0.32);
    }
    setTimeout(() => ctx.close(), times * 400 + 200);
  } catch {
    /* audio not available */
  }
}

export const openScreen = (path: string, name: string) => window.open(path, name, 'popup,width=1200,height=760');

// ------------------------------------------------------------------ product grid
export function ProductGrid({ products, loading, onPick, counts }: { products: Product[]; loading?: boolean; onPick: (p: Product) => void; counts: Map<string, number> }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean) as string[])].sort(), [products]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products.filter((p) => (!category || p.category === category) && (!s || p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s)));
  }, [products, search, category]);
  const scan = (code: string) => {
    const p = products.find((x) => x.barcode === code || x.code.toLowerCase() === code.toLowerCase());
    if (p) onPick(p);
    else toast.error(`No product with barcode or code "${code}"`);
  };
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <ScanInput onScan={scan} />
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search menu / products" className="h-9" />
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
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : !shown.length ? (
          <EmptyState icon="search" title="Nothing found" />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map((p) => {
              const n = counts.get(p.id) ?? 0;
              const out = p.stock !== null && p.stock <= 0;
              return (
                <button key={p.id} type="button" aria-label={`${p.name}, ${fmtMoney(p.price, 0)}`} onClick={() => onPick(p)} className={cn('card relative flex min-h-24 flex-col justify-between p-3 text-left transition hover:shadow-pop active:scale-[0.98]', n > 0 && 'ring-2 ring-brand-500')}>
                  {n > 0 && <span className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-1 text-xs font-semibold text-white">{fmtNumber(n)}</span>}
                  <span className="line-clamp-2 text-sm font-medium text-slate-900">{p.name}</span>
                  <span className="mt-2 flex items-end justify-between gap-1">
                    <span className="text-sm font-semibold text-brand-700 tabular-nums">{fmtMoney(p.price, 0)}</span>
                    <span className="flex items-center gap-1">
                      {p.modifiers.length > 0 && <Icon name="list-plus" className="h-3.5 w-3.5 text-slate-400" />}
                      {p.station && <Icon name="chef-hat" className="h-3.5 w-3.5 text-slate-400" />}
                      {p.stock !== null && <span className={cn('text-[11px]', out ? 'font-medium text-red-600' : 'text-slate-400')}>{out ? 'out' : fmtNumber(p.stock)}</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ modifiers / line editor
export function LineEditor({ product, initial, showCourse, onClose, onDone }: { product: Product; initial?: DraftLine; showCourse: boolean; onClose: () => void; onDone: (l: DraftLine) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(initial?.modifiers.map((m) => m.optionId) ?? product.modifiers.filter((g) => g.min > 0 && g.max === 1).map((g) => g.options[0]?.id).filter(Boolean)));
  const [qty, setQty] = useState(String(initial?.qty ?? 1));
  const [note, setNote] = useState(initial?.note ?? '');
  const [course, setCourse] = useState(initial?.course ?? 1);
  const [discount, setDiscount] = useState(String(initial?.discountPct || ''));
  const toggle = (gid: string, oid: string, max: number) =>
    setPicked((s) => {
      const g = product.modifiers.find((x) => x.id === gid)!;
      const next = new Set(s);
      if (next.has(oid)) next.delete(oid);
      else {
        if (max === 1) for (const o of g.options) next.delete(o.id);
        else if (max > 0 && g.options.filter((o) => next.has(o.id)).length >= max) return s;
        next.add(oid);
      }
      return next;
    });
  const errors = product.modifiers.filter((g) => g.options.filter((o) => picked.has(o.id)).length < g.min);
  const mods = product.modifiers.flatMap((g) => g.options.filter((o) => picked.has(o.id)).map((o) => ({ optionId: o.id, name: o.name, price: o.price })));
  const unit = product.price + mods.reduce((a, m) => a + m.price, 0);
  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      footer={
        <Button className="h-11 w-full" icon="check" disabled={errors.length > 0 || !(Number(qty) > 0)} onClick={() => onDone({ key: initial?.key ?? newKey(), product, qty: Number(qty), discountPct: Number(discount) || 0, modifiers: mods, note: note.trim(), course })}>
          {initial ? 'Update' : 'Add'} · {fmtMoney(unit * (Number(qty) || 0) * (1 - (Number(discount) || 0) / 100), 0)}
        </Button>
      }
    >
      <div className="space-y-4">
        {product.modifiers.map((g) => (
          <div key={g.id}>
            <p className="mb-1.5 text-sm font-medium">
              {g.name}{' '}
              <span className="text-xs font-normal text-slate-500">
                {g.min > 0 ? (g.max === 1 ? 'choose 1' : `choose at least ${g.min}`) : g.max > 0 ? `optional, up to ${g.max}` : 'optional'}
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {g.options.map((o) => (
                <button key={o.id} type="button" onClick={() => toggle(g.id, o.id, g.max)} className={cn('rounded-lg px-3 py-2 text-sm ring-1', picked.has(o.id) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-line')}>
                  {o.name}
                  {o.price > 0 && <span className="ml-1 text-xs opacity-80">+{fmtMoney(o.price, 0)}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Quantity">
            <NumberInput min={0} decimals={3} value={qty} onChange={setQty} />
          </Field>
          <Field label="Discount %">
            <NumberInput min={0} max={100} value={discount} onChange={setDiscount} />
          </Field>
          {showCourse && (
            <Field label="Course">
              <div className="flex gap-1">
                {[1, 2, 3].map((c) => (
                  <button key={c} type="button" onClick={() => setCourse(c)} className={cn('h-10 flex-1 rounded-lg text-sm ring-1', course === c ? 'bg-brand-600 text-white ring-brand-600' : 'ring-line')}>
                    {c}
                  </button>
                ))}
              </div>
            </Field>
          )}
        </div>
        <Field label="Note for the kitchen">
          <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="No ice, less sugar, allergy..." />
        </Field>
      </div>
    </Modal>
  );
}

/** the editable list of lines not saved yet */
export function DraftList({ lines, totals, onChange, onEdit }: { lines: DraftLine[]; totals?: Totals; onChange: (lines: DraftLine[]) => void; onEdit: (l: DraftLine) => void }) {
  const set = (key: string, qty: number) => onChange(qty <= 0 ? lines.filter((l) => l.key !== key) : lines.map((l) => (l.key === key ? { ...l, qty } : l)));
  return (
    <ul className="divide-y divide-line">
      {lines.map((l) => {
        const t = totals?.lines?.find((x) => x.key === l.key);
        const shelf = (l.product.price + l.modifiers.reduce((a, m) => a + m.price, 0)) * l.qty * (1 - l.discountPct / 100);
        return (
          <li key={l.key} className="px-4 py-2.5">
            <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => onEdit(l)}>
              <span className="min-w-0">
                <span className="text-sm font-medium">{l.product.name}</span>
                {lineLabel(l) && <span className="block text-xs text-slate-500">{lineLabel(l)}</span>}
                {l.course > 1 && <Badge tone="violet">Course {l.course}</Badge>}
              </span>
              <span className="text-right">
                <span className="block text-sm font-semibold tabular-nums">{fmtMoney(shelf, 0)}</span>
                {!!t?.promoDiscount && <span className="block text-xs text-emerald-700 tabular-nums">−{fmtMoney(t.promoDiscount, 0)}</span>}
              </span>
            </button>
            <div className="mt-1 flex items-center gap-2">
              <Button size="icon" variant="outline" icon={l.qty <= 1 ? 'trash-2' : 'minus'} className="h-7 w-7" onClick={() => set(l.key, l.qty - 1)} aria-label="Less" />
              <span className="w-8 text-center text-sm tabular-nums">{fmtNumber(l.qty)}</span>
              <Button size="icon" variant="outline" icon="plus" className="h-7 w-7" onClick={() => set(l.key, l.qty + 1)} aria-label="More" />
              {l.discountPct > 0 && <span className="text-xs text-slate-500">−{fmtNumber(l.discountPct)}%</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ totals
export function TotalsView({ t, outlet, vatPayer }: { t: Totals; outlet: Outlet; vatPayer: boolean }) {
  const row = (label: string, v: number, cls = 'text-slate-500') => (
    <div className={cn('flex justify-between', cls)}>
      <span>{label}</span>
      <span className="tabular-nums">{fmtMoney(v, 0)}</span>
    </div>
  );
  return (
    <div className="space-y-1 text-sm">
      {t.promotions.map((p) => (
        <div key={p.promotionId} className="flex justify-between text-emerald-700">
          <span className="flex items-center gap-1">
            <Icon name="ticket" className="h-3.5 w-3.5" />
            {p.name}
          </span>
          <span className="tabular-nums">−{fmtMoney(p.amount, 0)}</span>
        </div>
      ))}
      {t.serviceCharge > 0 && row(`Service ${Number(outlet.serviceChargePct)}%`, t.serviceCharge)}
      {t.taxTotal > 0 && (
        <>
          {row('DPP', t.subtotal)}
          {row(`PPN${outlet.pricesIncludeTax ? ' (included)' : ''}`, t.taxTotal)}
        </>
      )}
      {t.localTax > 0 && row(`PBJT ${Number(outlet.pbjtRate)}%`, t.localTax)}
      {outlet.mode === 'RETAIL' && !vatPayer && t.total > 0 && <p className="text-[11px] text-slate-400">Not a VAT payer (non-PKP): no PPN</p>}
      <div className="flex justify-between pt-1 text-lg font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{fmtMoney(t.total, 0)}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ members
export function MemberPicker({ value, onChange }: { value: Member | null; onChange: (m: Member | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-xs ring-1 ring-line hover:bg-slate-50">
        <Icon name="id-card" className="h-4 w-4 text-slate-400" />
        {value ? (
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{value.name}</span> {value.memberNo && <span className="text-slate-500">· {value.memberNo} · {fmtNumber(value.points)} pts</span>}
          </span>
        ) : (
          <span className="flex-1 text-slate-500">Walk-in customer · add member</span>
        )}
        {value && (
          <span
            role="button"
            tabIndex={0}
            className="text-slate-400 hover:text-red-600"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
          >
            <Icon name="x" className="h-4 w-4" />
          </span>
        )}
      </button>
      {open && (
        <MemberDialog
          onClose={() => setOpen(false)}
          onPick={(m) => {
            onChange(m);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function MemberDialog({ onClose, onPick }: { onClose: () => void; onPick: (m: Member) => void }) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['pos', 'members', search], queryFn: () => api.get<Member[]>('/pos/members', { search }), enabled: !adding });
  const [f, setF] = useState({ name: '', phone: '', email: '', consent: false, marketingConsent: false });
  const create = useMutation({ mutationFn: () => api.post<Member>('/pos/members', { ...f, email: f.email || null }), onSuccess: (m) => onPick(m), onError: (e) => toast.error(e) });
  return (
    <Modal
      open
      onClose={onClose}
      title={adding ? 'New member' : 'Member'}
      footer={
        adding ? (
          <>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Back
            </Button>
            <Button icon="user-plus" loading={create.isPending} disabled={!f.name.trim() || f.phone.trim().length < 6 || !f.consent} onClick={() => create.mutate()}>
              Register
            </Button>
          </>
        ) : (
          <Button variant="outline" icon="user-plus" onClick={() => setAdding(true)}>
            New member
          </Button>
        )
      }
    >
      {adding ? (
        <div className="space-y-3">
          <Field label="Name" required>
            <Input value={f.name} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Mobile number" required>
            <Input value={f.phone} maxLength={50} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label="E-mail">
            <Input value={f.email} maxLength={150} type="email" onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <Checkbox checked={f.consent} onChange={(v) => setF({ ...f, consent: v })} label="The customer agrees that we keep their name, number and purchases to run the membership and points (UU 27/2022 on personal data protection)" />
            <Checkbox checked={f.marketingConsent} onChange={(v) => setF({ ...f, marketingConsent: v })} label="The customer also wants to receive promotions (optional, can be withdrawn at any time)" />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, mobile number or member number" />
          {q.isLoading ? (
            <Spinner />
          ) : !q.data?.length ? (
            <EmptyState icon="id-card" title="No member found" />
          ) : (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg ring-1 ring-line">
              {q.data.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => onPick(m)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <span>
                      <span className="font-medium">{m.name}</span>
                      <span className="block text-xs text-slate-500">
                        {m.memberNo} · {m.phone}
                      </span>
                    </span>
                    <Badge tone="blue">{fmtNumber(m.points)} pts</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ payment
const METHODS: { value: Method; label: string; icon: string }[] = [
  { value: 'CASH', label: 'Cash', icon: 'banknote' },
  { value: 'QRIS', label: 'QRIS', icon: 'qr-code' },
  { value: 'CARD', label: 'Card', icon: 'credit-card' },
  { value: 'TRANSFER', label: 'Transfer', icon: 'landmark' },
  { value: 'POINTS', label: 'Points', icon: 'gift' },
];

export function PayModal({ total, member, pointValue, onClose, onPaid }: { total: number; member: Member | null; pointValue: number; onClose: () => void; onPaid: (p: Payment[]) => Promise<void> }) {
  const [rows, setRows] = useState<{ method: Method; amount: string; reference: string }[]>([{ method: 'CASH', amount: String(total), reference: '' }]);
  const [busy, setBusy] = useState(false);
  const paid = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const change = r2(paid - total);
  const pointsMax = member?.memberNo && pointValue > 0 ? member.points * pointValue : 0;
  const methods = METHODS.filter((m) => m.value !== 'POINTS' || pointsMax > 0);
  const quick = [...new Set([total, ...[5000, 10000, 20000, 50000, 100000].map((d) => Math.ceil(total / d) * d), Math.ceil(total / 100000) * 100000 + 50000, Math.ceil(total / 100000) * 100000 + 100000])].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 5);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((x) => x.map((y, k) => (k === i ? { ...y, ...patch } : y)));
  const pointsUsed = rows.filter((r) => r.method === 'POINTS').reduce((a, r) => a + (Number(r.amount) || 0), 0);
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
        <Button className="h-12 w-full text-base" icon="check" loading={busy} disabled={paid < total - 0.005 || pointsUsed > pointsMax + 0.005} onClick={pay}>
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
            <div className={cn('grid gap-1.5', methods.length === 5 ? 'grid-cols-5' : 'grid-cols-4')}>
              {methods.map((m) => (
                <button key={m.value} type="button" onClick={() => set(i, { method: m.value, ...(m.value === 'POINTS' ? { amount: String(Math.min(pointsMax, total)) } : {}) })} className={cn('flex flex-col items-center gap-1 rounded-lg py-2 text-xs font-medium', r.method === m.value ? 'bg-brand-600 text-white' : 'bg-slate-50 text-slate-600')}>
                  <Icon name={m.icon} className="h-4 w-4" />
                  {m.label}
                </button>
              ))}
            </div>
            <NumberInput fixed={2} min={0} value={r.amount} onChange={(v) => set(i, { amount: v })} className="h-11 text-right text-lg" aria-label="Amount" />
            {r.method === 'CASH' ? (
              <div className="flex flex-wrap gap-1.5">
                {quick.map((v) => (
                  <Button key={v} size="sm" variant="outline" onClick={() => set(i, { amount: String(v) })}>
                    {fmtMoney(v, 0)}
                  </Button>
                ))}
              </div>
            ) : r.method === 'POINTS' ? (
              <p className="text-xs text-slate-500">
                {member?.name} has {fmtNumber(member?.points ?? 0)} points = {fmtMoney(pointsMax, 0)}
              </p>
            ) : (
              <Input value={r.reference} maxLength={60} onChange={(e) => set(i, { reference: e.target.value })} placeholder="Approval / reference no. (optional)" />
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

// ------------------------------------------------------------------ reasons
export function ReasonModal({ title, action = 'Confirm', onClose, onSubmit }: { title: string; action?: string; onClose: () => void; onSubmit: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <Button
          variant="danger"
          loading={busy}
          disabled={reason.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(reason.trim());
              onClose();
            } catch (e) {
              toast.error(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {action}
        </Button>
      }
    >
      <Field label="Reason" required>
        <Textarea autoFocus rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ------------------------------------------------------------------ receipts
export interface Receipt {
  number: string | null;
  status: string;
  soldAt: string;
  createdAt: string;
  cashier: string;
  orderType: string;
  table: string | null;
  queueNo: string | null;
  covers: number;
  label: string | null;
  subtotal: string;
  discount: string;
  serviceCharge: string;
  taxTotal: string;
  localTax: string;
  total: string;
  paid: string;
  change: string;
  pointsEarned: number;
  pointsRedeemed: number;
  payments: { method: string; amount: number }[];
  promotions: { name: string; amount: number }[];
  lines: { name: string; qty: string; unitPrice: string; discountPct: string; promoDiscount: string; lineTotal: string; modifiers: { name: string }[]; note: string | null }[];
  seller: { name: string; address: string; phone: string | null; npwp: string | null; vatPayer: boolean };
  outlet: { name: string; mode: string; pbjtRate: number; serviceChargePct: number } | null;
  customer: { name: string; memberNo: string | null; points: number } | null;
  footer: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const PAY_LABEL: Record<string, string> = { CASH: 'Tunai', QRIS: 'QRIS', CARD: 'Kartu', TRANSFER: 'Transfer', POINTS: 'Poin' };

/** thermal receipt (58 / 80 mm). For a PKP retailer it carries what a faktur pajak digunggung needs (PER-11/PJ/2025 Art. 52): seller name, address, NPWP, goods, price incl. PPN, PPN */
function receiptHtml(r: Receipt, width: 58 | 80) {
  const money = (v: unknown) => Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 });
  const row = (a: string, b: string, bold = false) => `<div class="row${bold ? ' b' : ''}"><span>${a}</span><span>${b}</span></div>`;
  const bill = r.status === 'OPEN';
  const when = new Date(bill ? r.createdAt : r.soldAt).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.number ?? 'Bill')}</title><style>
@page { size: ${width}mm auto; margin: 3mm; }
body { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: ${width === 58 ? 10 : 11.5}px; color: #000; margin: 0; width: ${width - 6}mm; }
.c { text-align: center; } .row { display: flex; justify-content: space-between; gap: 6px; } .b { font-weight: 700; }
hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; } .small { font-size: ${width === 58 ? 9 : 10}px; } .big { font-size: 26px; font-weight: 700; }
</style></head><body>
<div class="c b">${esc(r.seller.name)}</div>
${r.outlet ? `<div class="c">${esc(r.outlet.name)}</div>` : ''}
<div class="c small">${esc(r.seller.address)}${r.seller.phone ? `<br>Telp ${esc(r.seller.phone)}` : ''}${r.seller.npwp ? `<br>NPWP ${esc(r.seller.npwp)}` : ''}</div>
<hr>
${bill ? '<div class="c b">TAGIHAN / BILL — belum lunas</div>' : ''}
${r.queueNo ? `<div class="c small">Nomor antrean</div><div class="c big">${esc(r.queueNo)}</div>` : ''}
${row(esc(r.number ?? '-'), when)}
${row('Kasir', esc(r.cashier))}
${r.table ? row('Meja', `${esc(r.table)}${r.covers ? ` · ${r.covers} org` : ''}`) : ''}
${r.label ? row('Nama', esc(r.label)) : ''}
${r.customer?.memberNo ? row('Member', `${esc(r.customer.name)} (${esc(r.customer.memberNo)})`) : ''}
<hr>
${r.lines
  .map(
    (l) =>
      `<div>${esc(l.name)}</div>${l.modifiers?.length ? `<div class="small">&nbsp;+ ${esc(l.modifiers.map((m) => m.name).join(', '))}</div>` : ''}${row(`&nbsp;${Number(l.qty).toLocaleString('id-ID')} x ${money(l.unitPrice)}${Number(l.discountPct) ? ` (-${Number(l.discountPct)}%)` : ''}`, money(Number(l.unitPrice) * Number(l.qty) * (1 - Number(l.discountPct) / 100)))}`,
  )
  .join('')}
<hr>
${r.promotions.map((p) => row(esc(p.name), `-${money(p.amount)}`)).join('')}
${Number(r.serviceCharge) > 0 ? row(`Service ${r.outlet?.serviceChargePct ?? ''}%`, money(r.serviceCharge)) : ''}
${Number(r.taxTotal) > 0 ? row('DPP', money(r.subtotal)) + row('PPN', money(r.taxTotal)) : ''}
${Number(r.localTax) > 0 ? row(`PBJT ${r.outlet?.pbjtRate ?? ''}%`, money(r.localTax)) : ''}
${row('TOTAL', money(r.total), true)}
${bill ? '' : r.payments.map((p) => row(PAY_LABEL[p.method] ?? p.method, money(p.amount))).join('')}
${!bill && Number(r.change) > 0 ? row('Kembali', money(r.change)) : ''}
${r.pointsEarned || r.pointsRedeemed ? `<hr>${r.pointsRedeemed ? row('Poin dipakai', String(r.pointsRedeemed)) : ''}${r.pointsEarned ? row('Poin didapat', String(r.pointsEarned)) : ''}${r.customer ? row('Saldo poin', String(r.customer.points)) : ''}` : ''}
<hr>
${!bill && r.seller.vatPayer && Number(r.taxTotal) > 0 ? '<div class="c small">Harga sudah termasuk PPN. Struk ini berlaku sebagai faktur pajak (digunggung).</div>' : ''}
${r.status === 'VOID' ? '<div class="c b">*** DIBATALKAN ***</div>' : ''}
<div class="c small">${esc(r.footer)}</div>
</body></html>`;
}

export function printReceipt(r: Receipt, width: 58 | 80) {
  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0' });
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

export function ReceiptModal({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['pos', 'receipt', id], queryFn: () => api.get<Receipt>(`/pos/sales/${id}/receipt`) });
  const r = q.data;
  const bill = r?.status === 'OPEN';
  return (
    <Modal
      open
      onClose={onClose}
      title={r ? (bill ? 'Bill' : `Receipt ${r.number}`) : 'Receipt'}
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
        <div className="space-y-2 text-center text-sm">
          {r.queueNo && (
            <div>
              <p className="text-xs text-slate-500">Queue number</p>
              <p className="text-4xl font-bold tracking-wide">{r.queueNo}</p>
            </div>
          )}
          <p className="text-2xl font-semibold tabular-nums">{fmtMoney(r.total, 0)}</p>
          {!bill && Number(r.change) > 0 && <p className="text-lg text-emerald-700">Change {fmtMoney(r.change, 0)}</p>}
          <p className="text-xs text-slate-500">
            {r.lines.length} line(s){!bill && ` · ${r.payments.map((p) => PAY_LABEL[p.method] ?? p.method).join(' + ')}`}
            {r.pointsEarned ? ` · +${r.pointsEarned} points` : ''}
          </p>
          <Badge tone={bill ? 'amber' : r.status === 'VOID' ? 'red' : 'green'}>{bill ? 'Not paid yet' : r.status === 'VOID' ? 'Voided' : 'Paid'}</Badge>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ shift closing
export function CloseShift({ shift, onClose, onClosed }: { shift: Shift; onClose: () => void; onClosed: () => void }) {
  const q = useQuery({ queryKey: ['pos', 'shift', shift.id], queryFn: () => api.get<{ expectedCash: string; openBills: number; totals: { count: number; voided: number; sales: number; serviceCharge: number; byMethod: Record<string, number> } }>(`/pos/sessions/${shift.id}`) });
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
          {d.openBills > 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              {d.openBills} open bill(s) at this outlet are not paid yet. They stay open and can be paid in the next shift.
            </p>
          )}
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
                <span className="text-slate-500">{m === 'CASH' ? 'Cash (after change)' : (PAY_LABEL[m] ?? m)}</span>
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

/** focus trap helper: keeps the scanner field ready after dialogs close */
export function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}
