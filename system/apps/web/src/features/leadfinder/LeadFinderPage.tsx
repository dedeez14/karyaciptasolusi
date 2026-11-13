import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDateTime, fmtNumber, plural } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Button, Card, DataTable, EmptyState, Icon, PageHeader, Pagination, Tabs, toast, type Column } from '@/components/ui';
import { duration, isActive, JobStatus, useFinderStatus, type ScrapeJob } from './common';
import { NewSearchDrawer } from './NewSearchDrawer';
import { PlaceResults } from './PlaceResults';

/** Google Maps lead finder: searches (scraper runs) and the de-duplicated list of places found */
export default function LeadFinderPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const status = useFinderStatus();
  const [tab, setTab] = useState<'searches' | 'results'>('searches');
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const jobs = useQuery({
    queryKey: ['leadfinder', 'jobs', page],
    queryFn: () => api.get<Paged<ScrapeJob>>('/leadfinder/jobs', { page, pageSize: 20 }),
    placeholderData: keepPreviousData,
    // follow running searches
    refetchInterval: (q) => ((q.state.data?.data ?? []).some((j) => isActive(j.statusCode)) ? 4000 : false),
  });

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post<{ jobId: string; rows: number; created: number; updated: number; skipped: number }>('/leadfinder/import', fd);
      toast.success(`${fmtNumber(r.rows, 0)} rows read · ${plural(r.created, 'new place')} · ${fmtNumber(r.updated, 0)} updated`);
      qc.invalidateQueries({ queryKey: ['leadfinder'] });
      navigate(`/crm/lead-finder/${r.jobId}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const columns: Column<ScrapeJob>[] = [
    {
      key: 'name',
      header: 'Search',
      render: (j) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{j.name}</p>
          <p className="text-xs text-slate-500">
            <span className="font-mono">{j.code}</span> · {j.queries === '(imported file)' ? 'Imported CSV' : plural(j.queryCount ?? 0, 'search', 'searches')}
            {j.latitude && ` · ${Number(j.radiusKm ?? 0)} km around ${Number(j.latitude).toFixed(3)}, ${Number(j.longitude).toFixed(3)}`}
          </p>
        </div>
      ),
    },
    { key: 'statusCode', header: 'Status', render: (j) => <JobStatus code={j.statusCode} /> },
    {
      key: 'resultCount',
      header: 'Places',
      align: 'right',
      render: (j) => (
        <span className="whitespace-nowrap tabular-nums">
          {fmtNumber(j.live?.rows ?? j.resultCount, 0)}
          {j.statusCode === 'DONE' && <span className="text-xs text-slate-400"> ({fmtNumber(j.newCount, 0)} new)</span>}
        </span>
      ),
    },
    {
      key: 'time',
      header: 'Started',
      render: (j) =>
        j.live ? (
          <span className="text-sm text-brand-700">running {duration(j.live.elapsedSeconds)}</span>
        ) : (
          <span className="text-sm whitespace-nowrap text-slate-600">{j.startedAt ? fmtDateTime(j.startedAt) : j.statusCode === 'QUEUED' ? 'waiting' : '—'}</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Lead Finder"
        subtitle="Find businesses on Google Maps and turn them into leads"
        actions={
          <>
            {can('crm.leadfinder.run') && (
              <>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => importCsv(e.target.files?.[0])} />
                <Button variant="outline" icon="file-up" loading={importing} onClick={() => fileRef.current?.click()}>
                  Import CSV
                </Button>
                <Button icon="search" onClick={() => setCreating(true)} disabled={status.data ? !status.data.ready : false}>
                  New search
                </Button>
              </>
            )}
          </>
        }
      />
      {status.data && !status.data.ready && (
        <div className="mb-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Icon name="triangle-alert" className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{status.data.problem}</p>
        </div>
      )}
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'searches', label: 'Searches' },
            { value: 'results', label: 'All places found' },
          ]}
        />
      </div>
      {tab === 'searches' ? (
        <Card bodyClass="p-0">
          <DataTable
            columns={columns}
            rows={jobs.data?.data ?? []}
            rowKey={(j) => j.id}
            loading={jobs.isFetching && !jobs.data}
            onRowClick={(j) => navigate(`/crm/lead-finder/${j.id}`)}
            empty={
              <EmptyState
                icon="map-pinned"
                title="No searches yet"
                description="Search Google Maps for a business type in an area, e.g. 'konveksi di Bandung'. You can also import a CSV made earlier with google-maps-scraper."
                action={
                  can('crm.leadfinder.run') && (
                    <Button icon="search" onClick={() => setCreating(true)} disabled={status.data ? !status.data.ready : false}>
                      New search
                    </Button>
                  )
                }
              />
            }
          />
          {jobs.data && jobs.data.meta.total > 20 && <Pagination page={page} totalPages={jobs.data.meta.totalPages} total={jobs.data.meta.total} pageSize={20} onPage={setPage} />}
        </Card>
      ) : (
        <PlaceResults />
      )}
      <NewSearchDrawer open={creating} onClose={() => setCreating(false)} status={status.data} />
    </div>
  );
}
