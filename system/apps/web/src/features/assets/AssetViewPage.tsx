import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useLookupLabel } from '@/hooks/useLookups';
import { useSession } from '@/stores/session';
import { Button, Card, confirm, Dropdown, EmptyState, PageHeader, Spinner, StatusBadge, Tabs, toast } from '@/components/ui';
import { AssetFormDrawer, AssetStatus, DepreciationRunModal, DisposeModal, fmtPeriod, type AssetDetail } from './common';

export default function AssetViewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const category = useLookupLabel('ASSET_CATEGORY');
  const method = useLookupLabel('DEPRECIATION_METHOD');
  const [editing, setEditing] = useState(false);
  const [depreciating, setDepreciating] = useState(false);
  const [disposing, setDisposing] = useState(false);
  const [tab, setTab] = useState<'history' | 'schedule'>('history');
  const [showAll, setShowAll] = useState(false);
  const q = useQuery({
    queryKey: ['assets', 'one', id],
    queryFn: () => api.get<AssetDetail>(`/assets/${id}`),
  });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  if (!q.data) return <EmptyState icon="file-x" title="Asset not found" description={(q.error as Error)?.message} />;
  const a = q.data;
  const depreciable = Number(a.cost) - Number(a.salvageValue);
  const pct = depreciable > 0 ? Math.min(100, (Number(a.accumulatedDepreciation) / depreciable) * 100) : 0;
  const active = a.statusCode === 'ACTIVE';
  const disposed = a.statusCode === 'DISPOSED';

  const remove = async () => {
    if (
      !(await confirm({
        title: `Delete ${a.code}?`,
        message: 'The asset is removed from the register and its purchase journal (if any) is voided.',
        confirmText: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await api.delete(`/assets/${a.id}`);
      toast.success(`${a.code} deleted`);
      qc.invalidateQueries({ queryKey: ['assets'] });
      navigate('/assets');
    } catch (e) {
      toast.error(e);
    }
  };

  const schedule = showAll ? a.schedule : a.schedule.slice(0, 12);

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {a.code}
            <AssetStatus code={a.statusCode} />
          </span>
        }
        subtitle={a.name}
        back={() => navigate('/assets')}
        actions={
          <>
            {active && can('accounting.asset.depreciate') && (
              <Button variant="outline" icon="calendar-check" onClick={() => setDepreciating(true)}>
                Depreciate
              </Button>
            )}
            {!disposed && can('accounting.asset.update') && (
              <Button variant="outline" icon="pencil" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            <Dropdown
              trigger={<Button variant="outline" icon="more-horizontal" aria-label="More actions" />}
              items={[
                {
                  label: 'Dispose / sell',
                  icon: 'archive-x',
                  hidden: disposed || !can('accounting.asset.dispose'),
                  onClick: () => setDisposing(true),
                },
                'divider',
                {
                  label: 'Delete',
                  icon: 'trash-2',
                  danger: true,
                  hidden: disposed || a.depreciations.length > 0 || !can('accounting.asset.delete'),
                  onClick: remove,
                },
              ]}
            />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Details">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <Item label="Category">{category(a.categoryCode)}</Item>
              <Item label="Serial number">{a.serialNumber}</Item>
              <Item label="Location">{a.location}</Item>
              <Item label="Custodian">{a.custodianName}</Item>
              <Item label="Supplier">{a.supplierName}</Item>
              <Item label="Acquired">{fmtDate(a.acquisitionDate)}</Item>
              <Item label="Method">{method(a.methodCode)}</Item>
              <Item label="Useful life">{`${a.usefulLifeMonths} months · from ${fmtPeriod(a.depreciationStartDate.slice(0, 7))}`}</Item>
              <Item label="Fixed asset account">{a.assetAccountName ?? 'Default posting account'}</Item>
              <Item label="Accumulated depreciation account">{a.accumDepAccountName ?? 'Default posting account'}</Item>
              <Item label="Depreciation expense account">{a.depExpenseAccountName ?? 'Default posting account'}</Item>
              <Item label="Last depreciation">{a.lastDepreciationPeriod ? fmtPeriod(a.lastDepreciationPeriod) : 'Not yet'}</Item>
              {disposed && (
                <>
                  <Item label="Disposed on">{fmtDate(a.disposalDate)}</Item>
                  <Item label="Sale proceeds">{fmtMoney(a.disposalAmount)}</Item>
                </>
              )}
              {a.notes && (
                <div className="sm:col-span-2">
                  <Item label="Notes">
                    <span className="whitespace-pre-line">{a.notes}</span>
                  </Item>
                </div>
              )}
            </dl>
          </Card>
          <Card
            title="Depreciation"
            bodyClass="p-0"
            actions={
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  {
                    value: 'history',
                    label: `Posted (${a.depreciations.length})`,
                  },
                  {
                    value: 'schedule',
                    label: `Remaining (${a.schedule.length})`,
                  },
                ]}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-slate-50/80 text-left text-xs font-medium text-slate-500">
                    <th className="px-4 py-2">Period</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-right">{tab === 'history' ? 'Book value after' : 'Accumulated'}</th>
                    <th className="px-4 py-2 text-right">{tab === 'history' ? 'Journal' : 'Book value'}</th>
                  </tr>
                </thead>
                <tbody>
                  {tab === 'history'
                    ? [...a.depreciations].reverse().map((d) => (
                        <tr key={d.id} className="border-b border-line last:border-0">
                          <td className="px-4 py-2.5">{fmtPeriod(d.period)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(d.amount)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(d.bookValueAfter)}</td>
                          <td className="px-4 py-2.5 text-right">
                            {d.journal ? (
                              <Link to={`/accounting/journals/${d.journal.id}`} className="font-medium text-brand-700 hover:underline">
                                {d.journal.number}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))
                    : schedule.map((s) => (
                        <tr key={s.period} className="border-b border-line last:border-0">
                          <td className="px-4 py-2.5">{fmtPeriod(s.period)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(s.amount)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{fmtMoney(s.accumulated)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(s.bookValue)}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
              {tab === 'history' && !a.depreciations.length && <p className="px-4 py-8 text-center text-sm text-slate-400">No depreciation posted yet.</p>}
              {tab === 'schedule' && !a.schedule.length && <p className="px-4 py-8 text-center text-sm text-slate-400">{disposed ? 'The asset has been disposed.' : 'Fully depreciated.'}</p>}
              {tab === 'schedule' && a.schedule.length > 12 && (
                <div className="border-t border-line p-2 text-center">
                  <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? 'Show less' : `Show all ${a.schedule.length} months`}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
        <div className="space-y-5">
          <div className="rounded-2xl bg-brand-600 p-5 text-white shadow-pop">
            <p className="text-sm text-white/80">{disposed ? 'Disposed' : 'Net book value'}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{disposed ? fmtMoney(0) : fmtMoney(a.bookValue)}</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xs text-white/80">{pct.toFixed(0)}% depreciated</p>
          </div>
          <Card title="Value">
            <dl className="space-y-2 text-sm">
              <Row label="Cost" value={fmtMoney(a.cost)} />
              <Row label="Accumulated depreciation" value={`-${fmtMoney(a.accumulatedDepreciation)}`} />
              <Row label="Salvage value" value={fmtMoney(a.salvageValue)} muted />
            </dl>
          </Card>
          <Card title="Journals">
            {a.journals.length ? (
              <ul className="space-y-2 text-sm">
                {a.journals.map((j) => (
                  <li key={j.id}>
                    <Link to={`/accounting/journals/${j.id}`} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="font-medium text-brand-700 hover:underline">{j.number}</span>
                        <span className="block text-xs text-slate-500">
                          {j.sourceType === 'ASSET_ACQ' ? 'Purchase' : 'Disposal'} · {fmtDate(j.date)}
                        </span>
                      </span>
                      <StatusBadge status={j.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No purchase or disposal journal.</p>
            )}
          </Card>
        </div>
      </div>
      <AssetFormDrawer open={editing} onClose={() => setEditing(false)} asset={a} />
      <DepreciationRunModal open={depreciating} onClose={() => setDepreciating(false)} assetIds={[a.id]} title={`Depreciate ${a.code}`} />
      {!disposed && <DisposeModal open={disposing} onClose={() => setDisposing(false)} asset={a} />}
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{children || <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`tabular-nums ${muted ? 'text-slate-500' : 'font-medium'}`}>{value}</dd>
    </div>
  );
}
