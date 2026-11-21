import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AsyncSelect, Badge, Button, Card, EmptyState, PageHeader, Spinner, toast } from '@/components/ui';

interface Codes {
  outlet: { id: string; name: string; selfOrder: string };
  base: string;
  tables: { id: string; code: string; name: string; area: string | null; url: string; svg: string }[];
}

/** printable QR codes: one per table, guests scan to order (Point of Sale > Table QR codes) */
export default function TableQrPage() {
  const qc = useQueryClient();
  const [outletId, setOutletId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['pos', 'table-qr', outletId], queryFn: () => api.get<Codes>(`/pos/outlets/${outletId}/table-qr`), enabled: !!outletId });
  const rotate = useMutation({ mutationFn: (id: string) => api.post(`/pos/tables/${id}/qr/rotate`), onSuccess: () => (toast.success('New code made: print it again, the old one no longer works'), qc.invalidateQueries({ queryKey: ['pos', 'table-qr', outletId] })), onError: (e) => toast.error(e) });
  const d = q.data;
  const local = d && /localhost|127\.0\.0\.1/.test(d.base);
  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <PageHeader
          title="Table QR codes"
          subtitle="Guests scan the code on their table, order from their phone and pay at the cashier"
          actions={
            <Button icon="printer" disabled={!d?.tables.length} onClick={() => window.print()}>
              Print
            </Button>
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-64">
            <AsyncSelect resource="pos-outlets" value={outletId} onChange={setOutletId} placeholder="Choose the outlet" />
          </div>
          {d && d.outlet.selfOrder === 'OFF' && (
            <p className="text-sm text-amber-700">
              Ordering by QR is off for this outlet: turn it on in{' '}
              <Link to="/r/pos-outlets" className="underline">
                Outlets
              </Link>
              .
            </p>
          )}
          {local && <p className="text-sm text-amber-700">The codes point to {d.base}: set the public address in Settings › General before printing, phones cannot open localhost.</p>}
        </div>
      </div>
      {!outletId ? (
        <Card>
          <EmptyState icon="qr-code" title="Choose an outlet" />
        </Card>
      ) : q.isLoading || !d ? (
        <Spinner />
      ) : !d.tables.length ? (
        <Card>
          <EmptyState icon="armchair" title="No tables at this outlet" />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-6">
          {d.tables.map((t) => (
            <div key={t.id} className="card flex break-inside-avoid flex-col items-center p-4 text-center print:shadow-none print:ring-1 print:ring-slate-300">
              <p className="text-xs text-slate-500">{d.outlet.name}</p>
              <p className="text-2xl font-bold">{t.name}</p>
              <div className="my-2 w-40" dangerouslySetInnerHTML={{ __html: t.svg }} />
              <p className="text-sm font-medium">Scan untuk pesan</p>
              <p className="text-xs text-slate-500">Scan to order · pay at the cashier</p>
              <div className="mt-3 flex items-center gap-2 print:hidden">
                {t.area && <Badge tone="gray">{t.area}</Badge>}
                <Button size="sm" variant="ghost" icon="rotate-cw" loading={rotate.isPending && rotate.variables === t.id} onClick={() => rotate.mutate(t.id)}>
                  New code
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
