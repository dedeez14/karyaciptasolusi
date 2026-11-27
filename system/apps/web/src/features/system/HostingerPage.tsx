import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, confirm, EmptyState, Icon, Modal, PageHeader, Spinner, Tabs, toast } from '@/components/ui';

type Json = Record<string, any>;
const TABS = [
  { value: 'vps', label: 'VPS' },
  { value: 'domains', label: 'Domains' },
  { value: 'websites', label: 'Websites' },
  { value: 'subscriptions', label: 'Subscriptions' },
] as const;
type TabKey = (typeof TABS)[number]['value'];

/** Hostinger responses are either an array or wrapped in { data: [...] } */
const toRows = (v: unknown): Json[] => (Array.isArray(v) ? v : Array.isArray((v as Json)?.data) ? (v as Json).data : v && typeof v === 'object' ? [v as Json] : []);
const isScalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const label = (k: string) => k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function GenericTable({ rows, actions }: { rows: Json[]; actions?: (r: Json) => ReactNode }) {
  if (!rows.length) return <EmptyState icon="inbox" title="Nothing found" />;
  const keys = [...new Set(rows.slice(0, 20).flatMap((r) => Object.keys(r).filter((k) => isScalar(r[k]))))].slice(0, 8);
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-slate-50/80 text-left text-xs font-medium text-slate-500">
          <tr>
            {keys.map((k) => (
              <th key={k} className="px-3 py-2 whitespace-nowrap">
                {label(k)}
              </th>
            ))}
            {actions && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {keys.map((k) => (
                <td key={k} className="px-3 py-2 whitespace-nowrap">
                  {typeof r[k] === 'boolean' ? (r[k] ? 'Yes' : 'No') : String(r[k] ?? '')}
                </td>
              ))}
              {actions && <td className="px-3 py-2 text-right">{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const stateTone = (s: string) => (/running|active/i.test(s) ? 'green' : /stopp|suspend|error/i.test(s) ? 'red' : 'amber');

export default function HostingerPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.some((t) => t.value === sp.get('tab')) ? sp.get('tab') : 'vps') as TabKey;
  const [dnsDomain, setDnsDomain] = useState<string | null>(null);
  const status = useQuery({ queryKey: ['hostinger', 'status'], queryFn: () => api.get<{ configured: boolean; resources: string[] }>('/integrations/hostinger/status') });
  const data = useQuery({ queryKey: ['hostinger', tab], queryFn: () => api.get<unknown>(`/integrations/hostinger/${tab}`), enabled: !!status.data?.configured, retry: false });
  const rows = toRows(data.data);

  const vpsAction = async (vm: Json, action: 'start' | 'stop' | 'restart') => {
    if (!(await confirm({ title: `${label(action)} VPS?`, message: `This will ${action} ${vm.hostname ?? `VPS #${vm.id}`} on Hostinger.`, confirmText: label(action), danger: action !== 'start' }))) return;
    try {
      await api.post(`/integrations/hostinger/vps/${vm.id}/${action}`);
      toast.success(`VPS ${action} requested`);
      setTimeout(() => qc.invalidateQueries({ queryKey: ['hostinger', 'vps'] }), 3000);
    } catch (e) {
      toast.error(e);
    }
  };

  if (status.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );

  if (!status.data?.configured)
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Hostinger" subtitle="Manage your VPS, domains, websites and subscriptions" />
        <Card>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="rounded-full bg-amber-50 p-3 text-amber-600">
              <Icon name="plug" className="h-6 w-6" />
            </div>
            <h2 className="font-semibold">Connect your Hostinger account</h2>
            <ol className="max-w-md list-decimal space-y-1 text-left text-sm text-slate-600">
              <li>Open Hostinger hPanel → Account → API and create a new API token.</li>
              <li>
                Go to <b>System → Settings → Integrations</b> and paste it into <i>Hostinger API token</i>.
              </li>
              <li>The token is stored encrypted (AES-256-GCM) and is never shown again.</li>
            </ol>
            {can('system.setting.update') && (
              <Link to="/system/settings?tab=integration">
                <Button icon="settings">Open integration settings</Button>
              </Link>
            )}
          </div>
        </Card>
      </div>
    );

  return (
    <div>
      <PageHeader title="Hostinger" subtitle="Live data from your Hostinger account" actions={<Button variant="outline" icon="refresh-cw" loading={data.isFetching} onClick={() => data.refetch()}>Refresh</Button>} />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} tabs={TABS.map((t) => ({ value: t.value, label: t.label }))} />
      <div className="mt-4">
        {data.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : data.error ? (
          <Card>
            <EmptyState icon="cloud-off" title="Could not load data from Hostinger" description={(data.error as Error).message} />
          </Card>
        ) : tab === 'vps' ? (
          rows.length ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((vm) => {
                const state = String(vm.state ?? vm.status ?? 'unknown');
                const ip = vm.ipv4?.[0]?.address ?? vm.ip_address ?? vm.ipv4 ?? '';
                return (
                  <Card key={vm.id} title={<span className="flex items-center gap-2"><Icon name="server" />{vm.hostname ?? `VPS #${vm.id}`}</span>} actions={<Badge tone={stateTone(state)}>{state}</Badge>}>
                    <dl className="grid grid-cols-2 gap-y-1 text-sm">
                      <dt className="text-slate-500">IP address</dt>
                      <dd className="font-mono text-xs">{typeof ip === 'string' ? ip : JSON.stringify(ip)}</dd>
                      <dt className="text-slate-500">Plan</dt>
                      <dd>{vm.plan ?? '—'}</dd>
                      <dt className="text-slate-500">CPU / RAM</dt>
                      <dd>
                        {vm.cpus ?? '—'} vCPU / {vm.memory ? `${Math.round(Number(vm.memory) / 1024)} GB` : '—'}
                      </dd>
                      <dt className="text-slate-500">Disk</dt>
                      <dd>{vm.disk ? `${Math.round(Number(vm.disk) / 1024)} GB` : '—'}</dd>
                    </dl>
                    {can('integration.hostinger.manage') && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button size="sm" variant="success" icon="play" onClick={() => vpsAction(vm, 'start')}>
                          Start
                        </Button>
                        <Button size="sm" variant="outline" icon="rotate-cw" onClick={() => vpsAction(vm, 'restart')}>
                          Restart
                        </Button>
                        <Button size="sm" variant="danger" icon="square" onClick={() => vpsAction(vm, 'stop')}>
                          Stop
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <EmptyState icon="server" title="No VPS found" />
            </Card>
          )
        ) : (
          <Card bodyClass="p-0">
            <GenericTable
              rows={rows}
              actions={
                tab === 'domains'
                  ? (r) =>
                      r.domain ? (
                        <Button size="sm" variant="outline" icon="globe" onClick={() => setDnsDomain(String(r.domain))}>
                          DNS
                        </Button>
                      ) : null
                  : undefined
              }
            />
          </Card>
        )}
      </div>
      <DnsModal domain={dnsDomain} onClose={() => setDnsDomain(null)} />
    </div>
  );
}

function DnsModal({ domain, onClose }: { domain: string | null; onClose: () => void }) {
  const dns = useQuery({ queryKey: ['hostinger', 'dns', domain], queryFn: () => api.get<unknown>(`/integrations/hostinger/dns/${domain}`), enabled: !!domain, retry: false });
  const rows = toRows(dns.data).map((r) => ({
    ...r,
    records: Array.isArray(r.records) ? r.records.map((x: Json) => x.content ?? JSON.stringify(x)).join(', ') : r.records,
  }));
  return (
    <Modal open={!!domain} onClose={onClose} size="lg" title={`DNS zone · ${domain ?? ''}`}>
      {dns.isLoading ? <Spinner /> : dns.error ? <p className="text-sm text-red-600">{(dns.error as Error).message}</p> : <GenericTable rows={rows} />}
    </Modal>
  );
}
