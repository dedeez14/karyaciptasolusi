import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { useLookupOptions } from '@/hooks/useLookups';
import { AsyncSelect, Badge, Button, Card, Checkbox, DatePicker, EmptyState, Field, Icon, Input, Modal, NumberInput, PageHeader, Select, Spinner, Switch, Tabs, TimeInput, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';

type Tab = 'menu' | 'modifiers' | 'prices' | 'promotions';

/** Point of Sale > Menu Setup & Promotions */
export default function PosSetupPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'menu';
  return (
    <div className="space-y-5">
      <PageHeader title="Menu Setup & Promotions" subtitle="Kitchen stations, add-ons, recipes, outlet prices and promotions of the point of sale" />
      <Tabs<Tab>
        value={tab}
        onChange={(v) => setParams({ tab: v })}
        tabs={[
          { value: 'menu', label: 'Menu items' },
          { value: 'modifiers', label: 'Add-ons & choices' },
          { value: 'prices', label: 'Price lists' },
          { value: 'promotions', label: 'Promotions & vouchers' },
        ]}
      />
      {tab === 'menu' && <MenuTab />}
      {tab === 'modifiers' && <ModifiersTab />}
      {tab === 'prices' && <PricesTab />}
      {tab === 'promotions' && <PromotionsTab />}
    </div>
  );
}

interface Group {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isActive: boolean;
  products: number;
  options: { id: string; name: string; price: number; productId: string | null; qty: number; isActive: boolean }[];
}
interface MenuRow {
  id: string;
  code: string;
  name: string;
  type: string;
  salePrice: number;
  posStation: string | null;
  category: string | null;
  modifierGroupIds: string[];
  recipe: { id: string; code: string } | null;
  boms: { id: string; code: string; backflushOnSale: boolean }[];
}

const useGroups = () => useQuery({ queryKey: ['pos', 'setup', 'modifiers'], queryFn: () => api.get<Group[]>('/pos/setup/modifiers') });

// ------------------------------------------------------------------ menu items
function MenuTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['pos', 'setup', 'menu', search], queryFn: () => api.get<MenuRow[]>('/pos/setup/menu', { search }) });
  const groups = useGroups().data ?? [];
  const stations = useLookupOptions('POS_STATION');
  const [edit, setEdit] = useState<MenuRow | null>(null);
  const recipe = useMutation({
    mutationFn: ({ bomId, on }: { bomId: string; on: boolean }) => api.post(`/pos/setup/recipe/${bomId}`, { on }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos', 'setup', 'menu'] }),
    onError: (e) => toast.error(e),
  });
  return (
    <Card title="Menu items" subtitle="Where each item is prepared, which add-ons it offers, and whether selling it uses a recipe (ingredients leave stock)" actions={<Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="h-8 w-48" />} bodyClass="p-0">
      {q.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !q.data?.length ? (
        <EmptyState icon="utensils" title="No products for sale" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Item</th>
                <th className="px-3 py-2 text-right font-semibold">Price</th>
                <th className="px-3 py-2 text-left font-semibold">Station</th>
                <th className="px-3 py-2 text-left font-semibold">Add-ons</th>
                <th className="px-3 py-2 text-left font-semibold">Recipe on sale</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <span className="font-medium">{r.name}</span>
                    <span className="block text-xs text-slate-500">
                      {r.code} · {r.category ?? 'no category'} · {r.type.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.salePrice, 0)}</td>
                  <td className="px-3 py-2">{r.posStation ? <Badge tone="blue">{stations.find((s) => s.value === r.posStation)?.label ?? r.posStation}</Badge> : <span className="text-xs text-slate-400">Counter</span>}</td>
                  <td className="px-3 py-2 text-xs">{r.modifierGroupIds.map((id) => groups.find((g) => g.id === id)?.name).filter(Boolean).join(', ') || <span className="text-slate-400">-</span>}</td>
                  <td className="px-3 py-2">
                    {!r.boms.length ? (
                      <span className="text-xs text-slate-400">No bill of materials</span>
                    ) : (
                      <Select
                        value={r.recipe?.id ?? ''}
                        placeholder="Sell as is"
                        options={r.boms.map((b) => ({ value: b.id, label: `Use ${b.code}` }))}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v) recipe.mutate({ bomId: v, on: true });
                          else if (r.recipe) recipe.mutate({ bomId: r.recipe.id, on: false });
                        }}
                        className="h-8 w-44 text-xs"
                        aria-label={`Recipe of ${r.name}`}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" icon="pencil" onClick={() => setEdit(r)}>
                      Set up
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <MenuItemEditor row={edit} groups={groups} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['pos', 'setup', 'menu'] }))} />}
    </Card>
  );
}

function MenuItemEditor({ row, groups, onClose, onSaved }: { row: MenuRow; groups: Group[]; onClose: () => void; onSaved: () => void }) {
  const stations = useLookupOptions('POS_STATION');
  const [station, setStation] = useState(row.posStation ?? '');
  const [ids, setIds] = useState<string[]>(row.modifierGroupIds);
  const save = useMutation({ mutationFn: () => api.put(`/pos/setup/menu/${row.id}`, { posStation: station || null, modifierGroupIds: ids }), onSuccess: () => (toast.success('Saved'), onSaved()), onError: (e) => toast.error(e) });
  return (
    <Modal
      open
      onClose={onClose}
      title={row.name}
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Prepared at" help="The kitchen display of this station shows it. Counter = handed over directly (no kitchen ticket)">
          <Select value={station} onChange={(e) => setStation(e.target.value)} placeholder="Counter (no kitchen)" options={stations} />
        </Field>
        <Field label="Add-ons & choices offered">
          {!groups.length ? (
            <p className="text-xs text-slate-500">Create them first in the "Add-ons & choices" tab.</p>
          ) : (
            <div className="space-y-1.5">
              {groups.map((g) => (
                <Checkbox key={g.id} checked={ids.includes(g.id)} onChange={(v) => setIds((x) => (v ? [...x, g.id] : x.filter((y) => y !== g.id)))} label={`${g.name} (${g.options.map((o) => o.name).join(', ')})`} />
              ))}
            </div>
          )}
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ modifiers
function ModifiersTab() {
  const qc = useQueryClient();
  const q = useGroups();
  const [edit, setEdit] = useState<Group | 'new' | null>(null);
  return (
    <Card
      title="Add-ons & choices"
      subtitle="Size, sugar level, extra topping... An option can take an ingredient out of stock"
      actions={
        <Button size="sm" icon="plus" onClick={() => setEdit('new')}>
          New group
        </Button>
      }
      bodyClass="p-0"
    >
      {q.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !q.data?.length ? (
        <EmptyState icon="list-plus" title="No add-ons yet" />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{g.name}</span> {!g.isActive && <Badge tone="gray">Inactive</Badge>}
                <span className="block text-xs text-slate-500">
                  {g.minSelect > 0 ? (g.maxSelect === 1 ? 'Required, choose 1' : `Required, at least ${g.minSelect}`) : `Optional${g.maxSelect ? `, up to ${g.maxSelect}` : ''}`} · used by {g.products} item(s)
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {g.options.map((o) => (
                    <Badge key={o.id} tone={o.isActive ? 'blue' : 'gray'}>
                      {o.name}
                      {o.price ? ` +${fmtMoney(o.price, 0)}` : ''}
                    </Badge>
                  ))}
                </span>
              </span>
              <Button size="sm" variant="outline" icon="pencil" onClick={() => setEdit(g)}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
      {edit && <GroupEditor group={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['pos', 'setup'] }))} />}
    </Card>
  );
}

function GroupEditor({ group, onClose, onSaved }: { group: Group | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: group?.name ?? '', minSelect: String(group?.minSelect ?? 0), maxSelect: String(group?.maxSelect ?? 1), isActive: group?.isActive ?? true });
  const [options, setOptions] = useState(group?.options.map((o) => ({ ...o, price: String(o.price), qty: String(o.qty) })) ?? [{ id: '', name: '', price: '0', productId: null as string | null, qty: '1', isActive: true }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, minSelect: Number(f.minSelect) || 0, maxSelect: Number(f.maxSelect) || 0, isActive: f.isActive, sortOrder: group?.sortOrder ?? 0, options: options.filter((o) => o.name.trim()).map((o) => ({ id: o.id || null, name: o.name, price: Number(o.price) || 0, productId: o.productId || null, qty: Number(o.qty) || 1, isActive: o.isActive })) };
      return group ? api.put(`/pos/setup/modifiers/${group.id}`, body) : api.post('/pos/setup/modifiers', body);
    },
    onSuccess: () => (toast.success('Saved'), onSaved()),
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });
  const del = useMutation({ mutationFn: () => api.delete(`/pos/setup/modifiers/${group!.id}`), onSuccess: () => (toast.success('Deleted'), onSaved()), onError: (e) => toast.error(e) });
  const setOpt = (i: number, patch: Partial<(typeof options)[number]>) => setOptions((x) => x.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={group ? `Edit ${group.name}` : 'New add-on group'}
      footer={
        <>
          {group && (
            <Button variant="danger" icon="trash-2" loading={del.isPending} onClick={() => del.mutate()} className="mr-auto">
              Delete
            </Button>
          )}
          <Button icon="check" loading={save.isPending} disabled={!f.name.trim() || !options.some((o) => o.name.trim())} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem_8rem]">
          <Field label="Name" required error={errors.name}>
            <Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Size, Sugar level, Toppings..." />
          </Field>
          <Field label="Choose at least" error={errors.minSelect} help="0 = optional">
            <NumberInput min={0} max={20} value={f.minSelect} onChange={(v) => setF({ ...f, minSelect: v })} />
          </Field>
          <Field label="At most" help="0 = no limit">
            <NumberInput min={0} max={20} value={f.maxSelect} onChange={(v) => setF({ ...f, maxSelect: v })} />
          </Field>
        </div>
        <Switch checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        <div className="space-y-2">
          <p className="text-sm font-medium">Options</p>
          {options.map((o, i) => (
            <div key={i} className="grid grid-cols-1 items-end gap-2 rounded-lg p-2 ring-1 ring-line sm:grid-cols-[1fr_7rem_1fr_5rem_auto]">
              <Field label="Option">
                <Input value={o.name} maxLength={80} onChange={(e) => setOpt(i, { name: e.target.value })} />
              </Field>
              <Field label="Extra price">
                <NumberInput min={0} fixed={0} value={o.price} onChange={(v) => setOpt(i, { price: v })} />
              </Field>
              <Field label="Takes from stock (optional)">
                <AsyncSelect resource="products" value={o.productId} onChange={(v) => setOpt(i, { productId: v })} placeholder="Nothing" />
              </Field>
              <Field label="Qty">
                <NumberInput min={0} decimals={4} value={o.qty} onChange={(v) => setOpt(i, { qty: v })} />
              </Field>
              <Button variant="ghost" size="icon" icon="trash-2" aria-label="Remove option" onClick={() => setOptions((x) => x.filter((_, k) => k !== i))} />
            </div>
          ))}
          <Button size="sm" variant="outline" icon="plus" onClick={() => setOptions((x) => [...x, { id: '', name: '', price: '0', productId: null, qty: '1', isActive: true }])}>
            Add option
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ price lists
function PricesTab() {
  const [listId, setListId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['pos', 'setup', 'prices', listId], queryFn: () => api.get<{ items: { productId: string; price: number }[] }>(`/pos/setup/price-lists/${listId}/items`), enabled: !!listId });
  const menu = useQuery({ queryKey: ['pos', 'setup', 'menu', ''], queryFn: () => api.get<MenuRow[]>('/pos/setup/menu', { search: '' }) });
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (q.data) setPrices(Object.fromEntries(q.data.items.map((i) => [i.productId, String(i.price)])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.put(`/pos/setup/price-lists/${listId}/items`, { items: Object.entries(prices).filter(([, v]) => v !== '').map(([productId, price]) => ({ productId, price: Number(price) })) }),
    onSuccess: () => toast.success('Prices saved'),
    onError: (e) => toast.error(e),
  });
  const rows = (menu.data ?? []).filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <Card
      title="Price lists"
      subtitle="Different prices per outlet or channel (e.g. airport outlet, online orders). An outlet uses the price list chosen on the outlet; items without a price here use the product sale price"
      actions={
        <div className="flex gap-2">
          <div className="w-56">
            <AsyncSelect resource="price-lists" value={listId} onChange={setListId} placeholder="Choose a price list" manageHref="/r/price-lists" manageLabel="Manage price lists" />
          </div>
          <Button size="sm" icon="check" disabled={!listId} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      }
      bodyClass="p-0"
    >
      {!listId ? (
        <EmptyState icon="tags" title="Choose a price list" description="Create one in Point of Sale > Price Lists, then set the prices here" />
      ) : q.isLoading || menu.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="border-b border-line p-3">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="h-8 max-w-xs" />
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Item</th>
                <th className="px-3 py-2 text-right font-semibold">Product price</th>
                <th className="px-4 py-2 text-right font-semibold">Price in this list</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500 tabular-nums">{fmtMoney(r.salePrice, 0)}</td>
                  <td className="px-4 py-1.5">
                    <NumberInput className="ml-auto h-8 w-36 text-right" min={0} fixed={0} value={prices[r.id] ?? ''} onChange={(v) => setPrices((p) => ({ ...p, [r.id]: v }))} aria-label={`Price of ${r.name}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ promotions
interface Promo {
  id: string;
  code: string;
  name: string;
  type: string;
  value: number;
  buyQty: number;
  getQty: number;
  minSpend: number;
  maxDiscount: number;
  productIds: string[];
  categoryIds: string[];
  outletIds: string[];
  membersOnly: boolean;
  voucherCode: string | null;
  startDate: string | null;
  endDate: string | null;
  days: number[];
  timeFrom: string | null;
  timeTo: string | null;
  maxUses: number;
  usedCount: number;
  isActive: boolean;
}
const TYPES = [
  { value: 'ITEM_PERCENT', label: '% off items' },
  { value: 'ITEM_AMOUNT', label: 'Amount off per item' },
  { value: 'BUY_X_GET_Y', label: 'Buy X get Y free' },
  { value: 'BILL_PERCENT', label: '% off the bill' },
  { value: 'BILL_AMOUNT', label: 'Amount off the bill' },
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const describe = (p: Promo) =>
  p.type === 'ITEM_PERCENT' ? `${fmtNumber(p.value)}% off` : p.type === 'ITEM_AMOUNT' ? `${fmtMoney(p.value, 0)} off each` : p.type === 'BUY_X_GET_Y' ? `Buy ${p.buyQty} get ${p.getQty}` : p.type === 'BILL_PERCENT' ? `${fmtNumber(p.value)}% off the bill${p.maxDiscount ? ` (max ${fmtMoney(p.maxDiscount, 0)})` : ''}` : `${fmtMoney(p.value, 0)} off the bill`;

function PromotionsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pos', 'setup', 'promotions'], queryFn: () => api.get<Promo[]>('/pos/setup/promotions') });
  const [edit, setEdit] = useState<Promo | 'new' | null>(null);
  return (
    <Card
      title="Promotions & vouchers"
      subtitle="Applied automatically at the cashier (the best one per item and one bill discount); vouchers only after the code is entered"
      actions={
        <Button size="sm" icon="plus" onClick={() => setEdit('new')}>
          New promotion
        </Button>
      }
      bodyClass="p-0"
    >
      {q.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !q.data?.length ? (
        <EmptyState icon="ticket" title="No promotions yet" />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{p.name}</span> <span className="text-xs text-slate-500">{p.code}</span> {!p.isActive && <Badge tone="gray">Inactive</Badge>}
                <span className="mt-1 flex flex-wrap gap-1">
                  <Badge tone="green">{describe(p)}</Badge>
                  {p.minSpend > 0 && <Badge tone="gray">min. {fmtMoney(p.minSpend, 0)}</Badge>}
                  {p.voucherCode && <Badge tone="violet">Voucher {p.voucherCode}</Badge>}
                  {p.membersOnly && <Badge tone="blue">Members</Badge>}
                  {p.timeFrom && <Badge tone="amber">{`${p.timeFrom}–${p.timeTo}`}</Badge>}
                  {p.days.length > 0 && <Badge tone="amber">{p.days.map((d) => DAYS[d]).join(' ')}</Badge>}
                  {(p.startDate || p.endDate) && <Badge tone="gray">{`${p.startDate ? fmtDate(p.startDate) : '…'} – ${p.endDate ? fmtDate(p.endDate) : '…'}`}</Badge>}
                  {p.maxUses > 0 && <Badge tone="gray">{`${p.usedCount} / ${p.maxUses} used`}</Badge>}
                </span>
              </span>
              <Button size="sm" variant="outline" icon="pencil" onClick={() => setEdit(p)}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
      {edit && <PromoEditor promo={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['pos', 'setup', 'promotions'] }))} />}
    </Card>
  );
}

/** chips of chosen records + a searchable picker to add more */
function MultiPick({ resource, value, onChange, placeholder }: { resource: string; value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const labels = useQuery({ queryKey: ['options', resource, 'ids', value.join(',')], queryFn: () => api.get<{ value: string; label: string }[]>(`/resources/${resource}/options`, { ids: value.join(',') }), enabled: value.length > 0 });
  const map = useMemo(() => new Map((labels.data ?? []).map((o) => [o.value, o.label])), [labels.data]);
  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 ring-1 ring-brand-200">
              {map.get(id) ?? '…'}
              <button type="button" aria-label="Remove" onClick={() => onChange(value.filter((x) => x !== id))}>
                <Icon name="x" className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <AsyncSelect key={value.length} resource={resource} value={null} onChange={(v) => v && !value.includes(v) && onChange([...value, v])} placeholder={placeholder} />
    </div>
  );
}

function PromoEditor({ promo, onClose, onSaved }: { promo: Promo | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(() => ({
    code: promo?.code ?? '',
    name: promo?.name ?? '',
    type: promo?.type ?? 'ITEM_PERCENT',
    value: String(promo?.value ?? ''),
    buyQty: String(promo?.buyQty || 1),
    getQty: String(promo?.getQty || 1),
    minSpend: String(promo?.minSpend ?? 0),
    maxDiscount: String(promo?.maxDiscount ?? 0),
    productIds: promo?.productIds ?? [],
    categoryIds: promo?.categoryIds ?? [],
    outletIds: promo?.outletIds ?? [],
    membersOnly: promo?.membersOnly ?? false,
    voucherCode: promo?.voucherCode ?? '',
    startDate: promo?.startDate?.slice(0, 10) ?? '',
    endDate: promo?.endDate?.slice(0, 10) ?? '',
    days: promo?.days ?? [],
    happyHour: !!promo?.timeFrom,
    timeFrom: promo?.timeFrom ?? '15:00',
    timeTo: promo?.timeTo ?? '17:00',
    maxUses: String(promo?.maxUses ?? 0),
    isActive: promo?.isActive ?? true,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const item = f.type.startsWith('ITEM') || f.type === 'BUY_X_GET_Y';
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        value: Number(f.value) || 0,
        buyQty: Number(f.buyQty) || 0,
        getQty: Number(f.getQty) || 0,
        minSpend: Number(f.minSpend) || 0,
        maxDiscount: Number(f.maxDiscount) || 0,
        maxUses: Number(f.maxUses) || 0,
        voucherCode: f.voucherCode || null,
        startDate: f.startDate || null,
        endDate: f.endDate || null,
        timeFrom: f.happyHour ? f.timeFrom : null,
        timeTo: f.happyHour ? f.timeTo : null,
        productIds: item ? f.productIds : [],
        categoryIds: item ? f.categoryIds : [],
      };
      return promo ? api.put(`/pos/setup/promotions/${promo.id}`, body) : api.post('/pos/setup/promotions', body);
    },
    onSuccess: () => (toast.success('Saved'), onSaved()),
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={promo ? `Edit ${promo.name}` : 'New promotion'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.code.trim() || !f.name.trim()} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label="Code" required error={errors.code}>
            <Input value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Name (shown on the receipt)" required error={errors.name}>
            <Input value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
        </div>
        <Field label="Kind">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
            {TYPES.map((t) => (
              <button key={t.value} type="button" onClick={() => setF({ ...f, type: t.value })} className={cn('rounded-lg px-2 py-2 text-xs ring-1', f.type === t.value ? 'bg-brand-600 text-white ring-brand-600' : 'ring-line')}>
                {t.label}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {f.type === 'BUY_X_GET_Y' ? (
            <>
              <Field label="Buy" error={errors.buyQty}>
                <NumberInput min={1} value={f.buyQty} onChange={(v) => setF({ ...f, buyQty: v })} />
              </Field>
              <Field label="Get free">
                <NumberInput min={1} value={f.getQty} onChange={(v) => setF({ ...f, getQty: v })} />
              </Field>
            </>
          ) : (
            <Field label={f.type.endsWith('PERCENT') ? 'Discount %' : 'Discount amount'} error={errors.value}>
              <NumberInput min={0} fixed={f.type.endsWith('PERCENT') ? undefined : 0} value={f.value} onChange={(v) => setF({ ...f, value: v })} />
            </Field>
          )}
          {f.type.startsWith('BILL') && (
            <Field label="Minimum spend">
              <NumberInput min={0} fixed={0} value={f.minSpend} onChange={(v) => setF({ ...f, minSpend: v })} />
            </Field>
          )}
          {f.type === 'BILL_PERCENT' && (
            <Field label="Maximum discount" help="0 = no cap">
              <NumberInput min={0} fixed={0} value={f.maxDiscount} onChange={(v) => setF({ ...f, maxDiscount: v })} />
            </Field>
          )}
          <Field label="Max. uses" help="0 = unlimited">
            <NumberInput min={0} value={f.maxUses} onChange={(v) => setF({ ...f, maxUses: v })} />
          </Field>
        </div>
        {item && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Products" help="Empty products and categories = every item">
              <MultiPick resource="products" value={f.productIds} onChange={(v) => setF({ ...f, productIds: v })} placeholder="Add a product" />
            </Field>
            <Field label="Categories">
              <MultiPick resource="product-categories" value={f.categoryIds} onChange={(v) => setF({ ...f, categoryIds: v })} placeholder="Add a category" />
            </Field>
          </div>
        )}
        <Field label="Outlets" help="Empty = every outlet">
          <MultiPick resource="pos-outlets" value={f.outletIds} onChange={(v) => setF({ ...f, outletIds: v })} placeholder="Add an outlet" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="From">
            <DatePicker value={f.startDate} onChange={(v) => setF({ ...f, startDate: v ?? '' })} />
          </Field>
          <Field label="Until" error={errors.endDate}>
            <DatePicker value={f.endDate} onChange={(v) => setF({ ...f, endDate: v ?? '' })} />
          </Field>
          <Field label="Voucher code" help="Only applies when the cashier enters it" error={errors.voucherCode}>
            <Input value={f.voucherCode} maxLength={40} onChange={(e) => setF({ ...f, voucherCode: e.target.value.toUpperCase() })} placeholder="None" />
          </Field>
        </div>
        <Field label="Days">
          <div className="flex gap-1">
            {DAYS.map((d, i) => (
              <button key={d} type="button" onClick={() => setF({ ...f, days: f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i].sort() })} className={cn('h-9 flex-1 rounded-lg text-xs ring-1', f.days.includes(i) ? 'bg-brand-600 text-white ring-brand-600' : 'ring-line')}>
                {d}
              </button>
            ))}
          </div>
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Switch checked={f.happyHour} onChange={(v) => setF({ ...f, happyHour: v })} label="Happy hour" />
          {f.happyHour && (
            <>
              <div className="w-28">
                <TimeInput value={f.timeFrom} onChange={(e) => setF({ ...f, timeFrom: e.target.value })} aria-label="From" />
              </div>
              <span className="pb-2 text-sm">to</span>
              <div className="w-28">
                <TimeInput value={f.timeTo} onChange={(e) => setF({ ...f, timeTo: e.target.value })} aria-label="To" />
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-6">
          <Switch checked={f.membersOnly} onChange={(v) => setF({ ...f, membersOnly: v })} label="Members only" />
          <Switch checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        </div>
      </div>
    </Modal>
  );
}
