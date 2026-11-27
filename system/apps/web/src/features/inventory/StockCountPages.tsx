import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Icon, Input, Modal, NumberInput, PageHeader, Spinner, toast } from '@/components/ui';
import { previewFile } from '@/components/ui/preview';
import { cn } from '@/components/ui/primitives';
import { ScanInput } from './ScanInput';

interface CountRow {
  id: string;
  number: string;
  countDate: string;
  status: 'COUNTING' | 'POSTED' | 'CANCELLED';
  warehouseName: string;
  lineCount: number;
  countedCount: number;
}
interface CountLine {
  id: string;
  productId: string;
  code: string;
  name: string;
  barcode: string | null;
  uom: string | null;
  systemQty: number;
  countedQty: number | null;
  difference: number | null;
  unitCost: number;
  value: number | null;
  note: string | null;
}
interface CountDetail {
  id: string;
  number: string;
  countDate: string;
  status: CountRow['status'];
  warehouseName: string;
  countedBy: string | null;
  witnessedBy: string | null;
  notes: string | null;
  adjustment: { id: string; number: string } | null;
  lines: CountLine[];
}

const STATUS: Record<CountRow['status'], { label: string; tone: 'amber' | 'green' | 'gray' }> = {
  COUNTING: { label: 'Counting', tone: 'amber' },
  POSTED: { label: 'Posted', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'gray' },
};

/** Inventory > Stock Counts: physical counts per warehouse (stock opname) */
export function StockCountListPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['stock-counts'], queryFn: () => api.get<CountRow[]>('/inventory/counts') });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock Counts (Opname)"
        subtitle="Count what is on the shelves, record the differences and print the berita acara"
        actions={
          can('inventory.adjustment.create') && (
            <Button icon="plus" onClick={() => setOpen(true)}>
              New count
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {list.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !list.data?.length ? (
          <EmptyState icon="clipboard-check" title="No stock counts yet" description="Start a count for a warehouse; count with a scanner or the phone camera." />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((c) => (
              <li key={c.id}>
                <Link to={`/inventory/stock-counts/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="rounded-lg bg-brand-50 p-2 text-brand-700">
                    <Icon name="clipboard-check" className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">{c.number}</span>
                    <span className="block text-xs text-slate-500">
                      {c.warehouseName} · {fmtDate(c.countDate)} · {c.countedCount} of {c.lineCount} counted
                    </span>
                  </span>
                  <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open && <NewCountModal onClose={() => setOpen(false)} onCreated={(id) => navigate(`/inventory/stock-counts/${id}`)} />}
    </div>
  );
}

function NewCountModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ warehouseId: '', countDate: isoDate(), categoryId: '', countedBy: '', witnessedBy: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>('/inventory/counts', f),
    onSuccess: (c) => {
      toast.success(`Count ${c.number} started`);
      qc.invalidateQueries({ queryKey: ['stock-counts'] });
      onCreated(c.id);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="New stock count"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="play" loading={save.isPending} disabled={!f.warehouseId} onClick={() => save.mutate()}>
            Start counting
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Warehouse" required error={errors.warehouseId}>
          <AsyncSelect resource="warehouses" value={f.warehouseId || null} onChange={(v) => setF({ ...f, warehouseId: v ?? '' })} />
        </Field>
        <Field label="Count date" required error={errors.countDate}>
          <DatePicker clearable={false} value={f.countDate} onChange={(v) => setF({ ...f, countDate: v })} />
        </Field>
        <Field label="Only this category" help="Empty = every stock product" className="sm:col-span-2">
          <AsyncSelect resource="product-categories" value={f.categoryId || null} onChange={(v) => setF({ ...f, categoryId: v ?? '' })} />
        </Field>
        <Field label="Counted by">
          <Input value={f.countedBy} maxLength={200} onChange={(e) => setF({ ...f, countedBy: e.target.value })} placeholder="Names" />
        </Field>
        <Field label="Witness">
          <Input value={f.witnessedBy} maxLength={200} onChange={(e) => setF({ ...f, witnessedBy: e.target.value })} placeholder="Name" />
        </Field>
        <p className="text-xs text-slate-500 sm:col-span-2">The book quantities are taken now; goods may keep moving during the count, the differences are worked out against the book quantity when you post.</p>
      </div>
    </Modal>
  );
}

/** Counting screen: scan or search a product, enter the quantity found; post when done */
export function StockCountPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [filter, setFilter] = useState<'all' | 'todo' | 'diff'>('all');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<CountLine | null>(null);
  const [addMode, setAddMode] = useState(true);
  const q = useQuery({ queryKey: ['stock-counts', id], queryFn: () => api.get<CountDetail>(`/inventory/counts/${id}`) });
  const c = q.data;
  const open = c?.status === 'COUNTING' && can('inventory.adjustment.create');
  const refresh = () => qc.invalidateQueries({ queryKey: ['stock-counts'] });

  const record = useMutation({
    mutationFn: (v: { productId: string; countedQty: number | null; add?: boolean; note?: string | null }) => api.post(`/inventory/counts/${id}/lines`, v),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(e),
  });

  // a scan: +1 of the product (repeated scans add up) or open it to type the quantity
  const scan = async (code: string) => {
    const hit = c?.lines.find((l) => l.barcode === code || l.code.toLowerCase() === code.toLowerCase());
    try {
      const productId = hit?.productId ?? (await api.get<{ id: string; name: string }>('/inventory/lookup', { code })).id;
      if (addMode) {
        await record.mutateAsync({ productId, countedQty: 1, add: true });
        toast.success(`+1 ${hit?.name ?? ''}`.trim());
      } else {
        await refresh();
        const line = c?.lines.find((l) => l.productId === productId);
        setActive(line ?? { id: '', productId, code, name: code, barcode: code, uom: null, systemQty: 0, countedQty: null, difference: null, unitCost: 0, value: null, note: null });
      }
    } catch (e) {
      toast.error(e);
    }
  };

  const lines = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (c?.lines ?? []).filter((l) => (filter === 'todo' ? l.countedQty === null : filter === 'diff' ? (l.difference ?? 0) !== 0 && l.countedQty !== null : true) && (!s || l.name.toLowerCase().includes(s) || l.code.toLowerCase().includes(s) || (l.barcode ?? '').includes(s)));
  }, [c, filter, search]);

  if (q.isLoading || !c)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );

  const counted = c.lines.filter((l) => l.countedQty !== null).length;
  const diffValue = c.lines.reduce((a, l) => a + (l.value ?? 0), 0);
  const diffs = c.lines.filter((l) => l.countedQty !== null && (l.difference ?? 0) !== 0).length;

  const post = async () => {
    const todo = c.lines.length - counted;
    const message = diffs || todo
      ? `${diffs} difference(s) worth ${fmtMoney(diffValue, 0)} become a confirmed stock adjustment (gain / loss at average cost).${todo ? ` ${todo} product(s) not counted are treated as not found (0).` : ''}`
      : 'Everything matches the books: the count is closed without a stock adjustment.';
    if (!(await confirm({ title: `Post count ${c.number}?`, message, confirmText: 'Post count' }))) return;
    try {
      const r = await api.post<{ adjustmentId: string | null; differences: number }>(`/inventory/counts/${id}/post`, { uncountedAsZero: true });
      toast.success(r.differences ? `Posted: ${r.differences} adjustment line(s)` : 'Posted: no differences');
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  const cancel = async () => {
    if (!(await confirm({ title: `Cancel count ${c.number}?`, message: 'Nothing is posted; the count is kept as cancelled.', confirmText: 'Cancel count', danger: true }))) return;
    await api.post(`/inventory/counts/${id}/cancel`).then(refresh).catch((e) => toast.error(e));
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {c.number} <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
          </span>
        }
        subtitle={`${c.warehouseName} · ${fmtDate(c.countDate)}${c.countedBy ? ` · counted by ${c.countedBy}` : ''}${c.witnessedBy ? ` · witness ${c.witnessedBy}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon="printer" onClick={() => previewFile({ path: `/inventory/counts/${id}/pdf`, params: { inline: 1 }, title: `Berita Acara ${c.number}` }).catch((e) => toast.error(e))}>
              Berita acara
            </Button>
            {c.adjustment && (
              <Link to={`/documents/ADJ/${c.adjustment.id}`}>
                <Button variant="outline" icon="sliders-horizontal">
                  {c.adjustment.number}
                </Button>
              </Link>
            )}
            {open && (
              <Button variant="outline" icon="ban" onClick={cancel}>
                Cancel
              </Button>
            )}
            {c.status === 'COUNTING' && can('inventory.adjustment.confirm') && (
              <Button icon="check-circle-2" onClick={post}>
                Post count
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Counted', value: `${counted} / ${c.lines.length}`, tone: 'text-brand-700' },
          { label: 'Differences', value: String(diffs), tone: diffs ? 'text-amber-600' : 'text-slate-900' },
          { label: 'Difference value', value: fmtMoney(diffValue, 0), tone: diffValue < 0 ? 'text-red-600' : 'text-slate-900' },
        ].map((k) => (
          <div key={k.label} className="card p-3">
            <p className="text-xs text-slate-500">{k.label}</p>
            <p className={cn('text-lg font-semibold tabular-nums', k.tone)}>{k.value}</p>
          </div>
        ))}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-1.5 rounded-full bg-brand-600 transition-all" style={{ width: `${c.lines.length ? (counted / c.lines.length) * 100 : 0}%` }} />
      </div>

      {open && (
        <Card bodyClass="p-3 space-y-2">
          <ScanInput onScan={scan} busy={record.isPending} />
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={addMode} onChange={(e) => setAddMode(e.target.checked)} />
            Each scan adds 1 (untick to type the quantity after scanning)
          </label>
        </Card>
      )}

      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs font-medium">
            {(
              [
                ['all', 'All'],
                ['todo', 'Not counted'],
                ['diff', 'Differences'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className={cn('rounded-md px-2.5 py-1', filter === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
                {label}
              </button>
            ))}
          </div>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find product" className="h-8 max-w-56 text-sm" />
        </div>
        {!lines.length ? (
          <EmptyState icon="package" title="Nothing here" />
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((l) => (
              <li key={l.productId}>
                <button type="button" disabled={!open} onClick={() => setActive(l)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{l.name}</span>
                    <span className="block text-xs text-slate-500">
                      {l.code}
                      {l.barcode ? ` · ${l.barcode}` : ''}
                    </span>
                  </span>
                  <span className="text-right text-xs text-slate-500 tabular-nums">
                    Book {fmtNumber(l.systemQty)}
                    {l.uom ? ` ${l.uom}` : ''}
                  </span>
                  <span className={cn('w-20 text-right text-sm font-semibold tabular-nums', l.countedQty === null ? 'text-slate-300' : (l.difference ?? 0) === 0 ? 'text-emerald-600' : 'text-amber-600')}>
                    {l.countedQty === null ? '—' : fmtNumber(l.countedQty)}
                    {l.countedQty !== null && (l.difference ?? 0) !== 0 && <span className="block text-[11px] font-normal">{(l.difference ?? 0) > 0 ? '+' : ''}{fmtNumber(l.difference ?? 0)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {active && open && (
        <QtyModal
          line={active}
          onClose={() => setActive(null)}
          onSave={async (qty, note) => {
            await record.mutateAsync({ productId: active.productId, countedQty: qty, note });
            setActive(null);
          }}
        />
      )}
    </div>
  );
}

function QtyModal({ line, onClose, onSave }: { line: CountLine; onClose: () => void; onSave: (qty: number | null, note: string | null) => Promise<void> }) {
  const [qty, setQty] = useState(line.countedQty === null ? '' : String(line.countedQty));
  const [note, setNote] = useState(line.note ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (v: number | null) => {
    setBusy(true);
    try {
      await onSave(v, note || null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={line.name}
      size="sm"
      footer={
        <>
          {line.countedQty !== null && (
            <Button variant="ghost" onClick={() => save(null)} disabled={busy}>
              Clear
            </Button>
          )}
          <Button icon="check" loading={busy} disabled={qty === ''} onClick={() => save(Number(qty))}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          {line.code} · book quantity {fmtNumber(line.systemQty)} {line.uom ?? ''}
        </p>
        <Field label="Quantity found">
          <NumberInput decimals={4} min={0} value={qty} onChange={setQty} autoFocus />
        </Field>
        <Field label="Note" help="e.g. damaged, expired, found in another rack">
          <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
