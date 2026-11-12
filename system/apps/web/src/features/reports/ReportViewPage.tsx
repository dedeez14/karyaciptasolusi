import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { download } from '@/lib/download';
import { fmtByType, fmtCompact, fmtDate, plural } from '@/lib/format';
import { AsyncSelect, Button, Card, cn, DatePicker, Dropdown, EmptyState, Field, PageHeader, previewFile, Select, Spinner, toast } from '@/components/ui';
import { CHART_COLORS, defaultValue, type ReportMeta, type ReportResult } from './reportTypes';

const NUMERIC = new Set(['money', 'number', 'qty', 'integer', 'percent']);

/** "2026-11-01 to 2026-11-12" -> "1 Nov 2026 to 12 Nov 2026" */
const prettyPeriod = (t: string) => t.replace(/(\d{4}-\d{2}-\d{2})/g, (d) => fmtDate(d));

export default function ReportViewPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const list = useQuery({ queryKey: ['reports', 'list'], queryFn: () => api.get<ReportMeta[]>('/reports'), staleTime: 5 * 60_000 });
  const def = list.data?.find((r) => r.key === key);

  // draft params (form) vs applied params (URL)
  const applied = useMemo(() => Object.fromEntries([...sp.entries()]), [sp]);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!def) return;
    const next = { ...applied };
    let changed = false;
    for (const p of def.params) {
      if (!next[p.name] && p.default) {
        next[p.name] = defaultValue(p.default);
        changed = true;
      }
    }
    setDraft(next);
    if (changed) setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def]);

  const ready = !!def && def.params.every((p) => !p.required || applied[p.name]);
  const result = useQuery({
    queryKey: ['reports', 'run', key, applied],
    queryFn: () => api.get<ReportResult>(`/reports/${key}`, applied),
    enabled: ready,
    placeholderData: keepPreviousData,
  });

  const run = () => setSp(Object.fromEntries(Object.entries(draft).filter(([, v]) => v)), { replace: true });
  const doExport = async (format: string, save = false) => {
    try {
      await download(`/reports/${key}/export`, { ...applied, format, save: save ? 1 : undefined });
      if (save) toast.success('Report saved to File Manager');
    } catch (e) {
      toast.error(e);
    }
  };

  if (list.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  if (!def) return <EmptyState icon="shield-alert" title="Report not available" description="The report does not exist or you do not have access to it." />;

  const data = result.data;
  const hasSection = data?.columns.some((c) => c.key === 'section');

  return (
    <div>
      <PageHeader
        title={def.label}
        subtitle={data?.subtitle ? prettyPeriod(data.subtitle) : def.description}
        back={() => navigate('/reports')}
        actions={
          <div className="no-print flex gap-2">
            <Button
              variant="outline"
              icon="printer"
              disabled={!data}
              title="Print-ready PDF with the company letterhead"
              onClick={() => previewFile({ path: `/reports/${key}/export`, params: { ...applied, format: 'pdf' }, title: def.label }).catch((e) => toast.error(e))}
            >
              Print
            </Button>
            <Dropdown
              trigger={
                <Button icon="download" disabled={!data}>
                  Export
                </Button>
              }
              items={[
                { label: 'Excel (.xlsx)', icon: 'file-spreadsheet', onClick: () => doExport('xlsx') },
                { label: 'CSV', icon: 'file-text', onClick: () => doExport('csv') },
                { label: 'PDF', icon: 'file', onClick: () => doExport('pdf') },
                'divider',
                { label: 'Save PDF to File Manager', icon: 'folder-input', onClick: () => doExport('pdf', true) },
                { label: 'Save Excel to File Manager', icon: 'folder-input', onClick: () => doExport('xlsx', true) },
              ]}
            />
          </div>
        }
      />

      {def.params.length > 0 && (
        <Card className="no-print mb-4" bodyClass="p-3">
          <form
            className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            {def.params.map((p) => (
              <Field key={p.name} label={p.label} required={p.required}>
                {p.type === 'date' ? (
                  <DatePicker value={draft[p.name] ?? ''} onChange={(v) => setDraft({ ...draft, [p.name]: v })} />
                ) : p.type === 'select' ? (
                  <Select value={draft[p.name] ?? ''} onChange={(e) => setDraft({ ...draft, [p.name]: e.target.value })} options={p.options ?? []} placeholder={p.required ? undefined : 'All'} />
                ) : (
                  <AsyncSelect resource={p.relation!} value={draft[p.name]} onChange={(v) => setDraft({ ...draft, [p.name]: v ?? '' })} placeholder={p.required ? 'Select...' : 'All'} />
                )}
              </Field>
            ))}
            <Button type="submit" icon="play" loading={result.isFetching}>
              Run report
            </Button>
          </form>
        </Card>
      )}

      {!ready ? (
        <Card>
          <EmptyState icon="sliders-horizontal" title="Choose the report parameters" description="Fill in the required fields and click Run report." />
        </Card>
      ) : result.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-brand-700" />
        </div>
      ) : result.error ? (
        <EmptyState icon="alert-triangle" title="Report failed" description={(result.error as Error).message} />
      ) : data ? (
        <div className="space-y-4">
          {data.chart && data.rows.length > 0 && <ReportChart result={data} />}
          <Card bodyClass="p-0">
            {data.rows.length === 0 ? (
              <EmptyState icon="inbox" title="No data for these parameters" />
            ) : (
              <div className="scrollbar-thin max-h-[70vh] overflow-auto print:max-h-none print:overflow-visible">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-line bg-slate-50/80 text-left text-xs font-medium text-slate-500">
                      {data.columns.map((c) => (
                        <th key={c.key} className={cn('px-3 py-2.5 whitespace-nowrap', NUMERIC.has(c.type ?? '') && 'text-right')}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r, i) => {
                      const isSection = hasSection && !!r.section;
                      const isHeader = isSection && (r.amount === null || r.amount === undefined);
                      return (
                        <tr key={i} className={cn('border-b border-line', isSection && 'font-semibold', isHeader && 'bg-slate-50', !isSection && 'hover:bg-slate-50/60')}>
                          {data.columns.map((c) => (
                            <td key={c.key} className={cn('px-3 py-2 whitespace-nowrap', NUMERIC.has(c.type ?? '') && 'text-right tabular-nums', typeof r[c.key] === 'number' && (r[c.key] as number) < 0 && 'text-red-600')}>
                              {fmtByType(r[c.key], c.type)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                  {data.totals && (
                    <tfoot className="sticky bottom-0">
                      <tr className="bg-slate-100 font-semibold">
                        {data.columns.map((c, i) => (
                          <td key={c.key} className={cn('px-3 py-2.5 whitespace-nowrap', NUMERIC.has(c.type ?? '') && 'text-right tabular-nums')}>
                            {i === 0 ? 'Total' : data.totals![c.key] !== undefined ? fmtByType(data.totals![c.key], c.type) : ''}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
            <div className="border-t border-line px-4 py-2 text-xs text-slate-400">{plural(data.rows.length, 'row')}</div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function ReportChart({ result }: { result: ReportResult }) {
  const { chart, rows } = result;
  if (!chart) return null;
  const data = rows.slice(0, 15).map((r) => ({ name: String(r[chart.label] ?? '-').slice(0, 30), value: Number(r[chart.value] ?? 0) }));
  const valueCol = result.columns.find((c) => c.key === chart.value);
  const fmt = (v: number) => fmtByType(v, valueCol?.type);
  return (
    <Card title={valueCol?.label ?? 'Chart'} className="no-print">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === 'pie' ? (
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="80%" paddingAngle={2}>
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => fmt(Number(v))} />
              <Legend />
            </PieChart>
          ) : chart.type === 'line' ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tickFormatter={(v) => fmtCompact(v)} tick={{ fontSize: 11, fill: '#94a3b8' }} width={60} />
              <Tooltip formatter={(v) => fmt(Number(v))} />
              <Line type="monotone" dataKey="value" stroke="#1d4f7a" strokeWidth={2} />
            </LineChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} interval={0} angle={data.length > 6 ? -25 : 0} textAnchor={data.length > 6 ? 'end' : 'middle'} height={data.length > 6 ? 70 : 30} />
              <YAxis tickFormatter={(v) => fmtCompact(v)} tick={{ fontSize: 11, fill: '#94a3b8' }} width={60} />
              <Tooltip formatter={(v) => fmt(Number(v))} cursor={{ fill: '#94a3b81a' }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
