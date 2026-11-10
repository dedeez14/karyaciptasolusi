import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import { useSession } from '@/stores/session';
import { useLookupLabel } from '@/hooks/useLookups';
import { Button, Card, confirm, EmptyState, Icon, PageHeader, Spinner, StatCard, toast } from '@/components/ui';
import { duration, isActive, JobStatus, type ScrapeJob } from './common';
import { PlaceResults } from './PlaceResults';

export default function JobPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const lang = useLookupLabel('LANGUAGE');
  const [showLog, setShowLog] = useState(false);
  const q = useQuery({
    queryKey: ['leadfinder', 'job', id],
    queryFn: () => api.get<ScrapeJob>(`/leadfinder/jobs/${id}`),
    refetchInterval: (s) => (s.state.data && isActive(s.state.data.statusCode) ? 3000 : false),
  });
  const j = q.data;
  if (q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  if (!j) return <EmptyState icon="search-x" title="Search not found" />;

  const run = async (path: 'cancel' | 'retry', label: string) => {
    if (path === 'cancel' && !(await confirm({ title: 'Stop this search?', message: 'Places found so far are kept.', confirmText: 'Stop search', danger: true }))) return;
    try {
      await api.post(`/leadfinder/jobs/${j.id}/${path}`);
      toast.success(label);
      qc.invalidateQueries({ queryKey: ['leadfinder'] });
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this search?', message: 'The places it found stay in "All places found" (and leads stay leads).', confirmText: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/leadfinder/jobs/${j.id}`);
      qc.invalidateQueries({ queryKey: ['leadfinder'] });
      navigate('/crm/lead-finder');
    } catch (e) {
      toast.error(e);
    }
  };

  const active = isActive(j.statusCode);
  const imported = j.queries === '(imported file)';
  const lines = imported ? [] : j.queries.split('\n').filter(Boolean);
  const elapsed = j.live?.elapsedSeconds ?? (j.startedAt && j.finishedAt ? Math.round((new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime()) / 1000) : null);
  const log = j.live?.log ?? j.logTail;

  return (
    <div>
      <PageHeader
        back={() => navigate('/crm/lead-finder')}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {j.name} <JobStatus code={j.statusCode} />
          </span>
        }
        subtitle={`${j.code} · created ${fmtDateTime(j.createdAt)}`}
        actions={
          <>
            {active && can('crm.leadfinder.run') && (
              <Button variant="outline" icon="square" onClick={() => run('cancel', 'Search stopped')}>
                {j.statusCode === 'QUEUED' ? 'Cancel' : 'Stop'}
              </Button>
            )}
            {!active && !imported && can('crm.leadfinder.run') && (
              <Button variant="outline" icon="rotate-cw" onClick={() => run('retry', 'Search queued again')}>
                Run again
              </Button>
            )}
            {!active && can('crm.leadfinder.delete') && <Button variant="ghost" icon="trash-2" onClick={remove} aria-label="Delete search" />}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Places found" value={fmtNumber(j.live?.rows ?? j.resultCount, 0)} hint={j.statusCode === 'DONE' ? `${fmtNumber(j.newCount, 0)} not seen before` : active ? 'updates every few seconds' : undefined} icon="map-pinned" />
        <StatCard label="Still to review" value={fmtNumber(j.places?.new ?? 0, 0)} icon="list-checks" tone="amber" />
        <StatCard label="Added to leads" value={fmtNumber(j.places?.imported ?? 0, 0)} icon="user-check" tone="green" />
        <StatCard label={active ? 'Running for' : 'Duration'} value={elapsed !== null ? duration(elapsed) : j.statusCode === 'QUEUED' ? 'Waiting' : '—'} hint={j.statusCode === 'QUEUED' && j.queuePosition ? `${j.queuePosition} search(es) ahead` : undefined} icon="timer" tone="violet" />
      </div>

      {j.error && (
        <div className={`mb-4 flex gap-3 rounded-2xl border p-4 text-sm ${j.statusCode === 'FAILED' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <Icon name="triangle-alert" className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="break-words">{j.error}</p>
        </div>
      )}

      {!imported && (
        <Card className="mb-4" title="Search settings" bodyClass="p-4">
          <div className="grid gap-4 text-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">Searches ({lines.length})</p>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-slate-700">
                {lines.map((l, i) => (
                  <li key={i} className="truncate">
                    {l}
                  </li>
                ))}
              </ul>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-slate-700">
              <dt className="text-slate-500">Map centre</dt>
              <dd>{j.latitude ? `${Number(j.latitude).toFixed(4)}, ${Number(j.longitude).toFixed(4)}` : 'from the search text'}</dd>
              {j.latitude && (
                <>
                  <dt className="text-slate-500">Radius / zoom</dt>
                  <dd>
                    {Number(j.radiusKm ?? 0)} km · {j.zoom}
                  </dd>
                </>
              )}
              <dt className="text-slate-500">Depth</dt>
              <dd>{j.depth}</dd>
              <dt className="text-slate-500">Language</dt>
              <dd>{lang(j.languageCode)}</dd>
              <dt className="text-slate-500">E-mails</dt>
              <dd>{j.extractEmails ? 'looked up on websites' : 'not collected'}</dd>
              {j.fastMode && (
                <>
                  <dt className="text-slate-500">Mode</dt>
                  <dd>Fast</dd>
                </>
              )}
            </dl>
          </div>
          {log && (
            <div className="mt-3 border-t border-line pt-3">
              <button type="button" className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800" onClick={() => setShowLog((v) => !v)}>
                <Icon name={showLog ? 'chevron-down' : 'chevron-right'} className="h-3.5 w-3.5" />
                Scraper output
              </button>
              {showLog && <pre className="mt-2 max-h-56 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-slate-100">{log}</pre>}
            </div>
          )}
        </Card>
      )}

      <PlaceResults jobId={j.id} live={active} />
    </div>
  );
}
