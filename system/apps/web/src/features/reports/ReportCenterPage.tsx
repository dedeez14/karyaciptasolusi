import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { EmptyState, Icon, Input, PageHeader, Spinner } from '@/components/ui';
import { MODULES, type ReportMeta } from './reportTypes';

export default function ReportCenterPage() {
  const reports = useQuery({ queryKey: ['reports', 'list'], queryFn: () => api.get<ReportMeta[]>('/reports'), staleTime: 5 * 60_000 });
  const [search, setSearch] = useState('');

  const grouped = useMemo(() => {
    const s = search.toLowerCase();
    const rows = (reports.data ?? []).filter((r) => !s || r.label.toLowerCase().includes(s) || r.description.toLowerCase().includes(s));
    return Object.keys(MODULES)
      .map((m) => ({ module: m, items: rows.filter((r) => r.module === m) }))
      .filter((g) => g.items.length);
  }, [reports.data, search]);

  return (
    <div>
      <PageHeader title="Report Center" subtitle="Analyse every part of the business. All reports can be exported to Excel, CSV or PDF." />
      <div className="relative mb-5 max-w-md">
        <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
        <Input className="pl-9" placeholder="Search reports..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {reports.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-brand-700" />
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState icon="bar-chart-3" title="No reports available" description="You do not have access to any report, or nothing matches your search." />
      ) : (
        <div className="space-y-8">
          {grouped.map((g) => {
            const m = MODULES[g.module];
            return (
              <section key={g.module}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
                  <span style={{ color: m.color }}>
                    <Icon name={m.icon} className="h-4 w-4" />
                  </span>
                  {m.label}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {g.items.map((r) => (
                    <Link key={r.key} to={`/reports/${r.key}`} className="card group flex items-start gap-3 p-4 transition hover:border-brand-300 hover:shadow-md">
                      <span className="rounded-lg p-2" style={{ background: `${m.color}1a`, color: m.color }}>
                        <Icon name="file-bar-chart" className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium group-hover:text-brand-700">{r.label}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">{r.description}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
