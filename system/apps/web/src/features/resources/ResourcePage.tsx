import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { download } from '@/lib/download';
import { fmtByType, plural } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DataTable, Dropdown, EmptyState, Icon, Input, Pagination, PageHeader, Select, Spinner, toast, type Column } from '@/components/ui';
import { useLookups } from './FieldInput';
import { ResourceForm } from './ResourceForm';
import { ImportDialog } from './ImportDialog';
import { LOCKED, RESOURCE_ACTIONS } from './resourceActions';
import type { FieldDef, ResourceMeta, Row } from './types';
import { useLookupOptions } from '@/hooks/useLookups';
import { RESOURCE_UI } from './views/registry';
import type { ResourceViewProps } from './views/types';

const viewKey = (k: string) => `kcs.view.${k}`;
function readView(k: string): string | null {
  try {
    return localStorage.getItem(viewKey(k));
  } catch {
    return null;
  }
}
function saveView(k: string, v: string) {
  try {
    localStorage.setItem(viewKey(k), v);
  } catch {
    /* ignore */
  }
}

/** One generic page for every master-data style resource: list, search, filter, sort, export, create, edit, delete. */
export default function ResourcePage() {
  const { key = '' } = useParams();
  const meta = useQuery({
    queryKey: ['meta', key],
    queryFn: () => api.get<ResourceMeta>(`/meta/resources/${key}`),
    staleTime: 5 * 60_000,
  });
  if (meta.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  if (meta.error || !meta.data) return <EmptyState icon="shield-alert" title="Not available" description={(meta.error as Error)?.message} />;
  const Page = RESOURCE_UI[key]?.page;
  if (Page) return <Page key={key} meta={meta.data} List={ResourceList} />;
  return <ResourceList key={key} meta={meta.data} />;
}

export function ResourceList({ meta, embedded }: { meta: ResourceMeta; embedded?: boolean }) {
  const ui = RESOURCE_UI[meta.key] ?? {};
  const views = ui.views ?? [];
  const navigate = useNavigate();
  const [view, setViewState] = useState<string>(() => {
    const saved = readView(meta.key);
    if (saved && (saved === 'table' || views.some((v) => v.id === saved))) return saved;
    return views.length && !ui.tableFirst ? views[0].id : 'table';
  });
  const setView = (v: string) => {
    setViewState(v);
    saveView(meta.key, v);
  };
  const activeView = views.find((v) => v.id === view);
  const yesNo = useLookupOptions('YES_NO');
  const ls = useListState({
    sort: meta.defaultSort?.field,
    order: meta.defaultSort?.order,
  });
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  // ?open=<id> opens that record (links from other pages, e.g. a reply to an e-mail campaign)
  const [sp, setSp] = useSearchParams();
  const openId = sp.get('open');
  const [editing, setEditingState] = useState<string | null | undefined>(() => (openId && /^[0-9a-f-]{36}$/i.test(openId) ? openId : undefined));
  const setEditing = (v: string | null | undefined) => {
    setEditingState(v);
    if (v === undefined && sp.has('open')) {
      const next = new URLSearchParams(sp);
      next.delete('open');
      setSp(next, { replace: true });
    }
  };
  const [importing, setImporting] = useState(false);
  const [showFilters, setShowFilters] = useState(Object.keys(ls.filters).length > 0);
  const lookups = useLookups(meta.fields.filter((f) => f.type === 'lookup').map((f) => f.lookup!));
  const idField = meta.idField;

  const params = activeView ? { ...ls.params, page: 1, pageSize: activeView.pageSize ?? 200 } : ls.params;
  const list = useQuery({
    queryKey: ['resource', meta.key, 'list', params],
    queryFn: () => api.get<Paged<Row>>(`/resources/${meta.key}`, params),
    placeholderData: keepPreviousData,
  });

  const renderValue = (f: FieldDef, r: Row) => {
    const v = r[f.name];
    const label = r._labels?.[f.name];
    if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>;
    if (f.type === 'boolean') return v ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>;
    if (f.type === 'lookup') {
      const opt = lookups[f.lookup!]?.find((o) => o.value === v);
      return <Badge color={opt?.color}>{label ?? opt?.label ?? v}</Badge>;
    }
    if (f.type === 'select')
      return <Badge tone={['CANCELLED', 'REJECTED'].includes(v) ? 'red' : ['APPROVED', 'COMPLETED'].includes(v) ? 'green' : v === 'PENDING' ? 'amber' : 'gray'}>{label ?? v}</Badge>;
    if (f.type === 'color')
      return (
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: v }} />
          {v}
        </span>
      );
    if (f.encrypted) return <span className="font-mono text-xs text-slate-500">{v}</span>;
    return label ?? fmtByType(v, f.type);
  };

  const columns: Column<Row>[] = useMemo(
    () =>
      meta.fields
        .filter((f) => f.list)
        .map((f) => ({
          key: f.name,
          header: f.label,
          sortable: f.sortable || f.type === 'date',
          align: ['money', 'number', 'integer', 'percent'].includes(f.type) ? 'right' : undefined,
          render: (r: Row) => renderValue(f, r),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta.fields, lookups],
  );

  const filterFields = meta.fields.filter((f) => f.filter);
  const extra = (RESOURCE_ACTIONS[meta.key] ?? []).filter((a) => can(a.permission));
  const locked = LOCKED[meta.key];

  const remove = async (r: Row) => {
    if (
      !(await confirm({
        title: `Delete ${meta.singular}?`,
        message: 'This record will be removed. This action is recorded in the audit trail.',
        confirmText: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await api.delete(`/resources/${meta.key}/${r[idField]}`);
      toast.success(`${meta.singular} deleted`);
      qc.invalidateQueries({ queryKey: ['resource', meta.key] });
      qc.invalidateQueries({ queryKey: ['insights'] });
    } catch (e) {
      toast.error(e);
    }
  };

  const runAction = async (a: (typeof extra)[number], r: Row) => {
    if (a.confirm && !(await confirm({ title: a.label, message: a.confirm, danger: a.danger }))) return;
    try {
      await a.run(r);
      toast.success(a.success);
      qc.invalidateQueries({ queryKey: ['resource'] });
      qc.invalidateQueries({ queryKey: ['insights'] });
    } catch (e) {
      toast.error(e);
    }
  };

  const openRow = (r: Row) => {
    if (ui.detailPath) navigate(ui.detailPath(r));
    else if (meta.can.update && !locked?.(r)) setEditing(String(r[idField]));
  };
  const viewProps: ResourceViewProps = {
    meta,
    rows: list.data?.data ?? [],
    loading: list.isFetching,
    params,
    open: openRow,
    edit: (id) => setEditing(id),
    renderValue,
    field: (name) => meta.fields.find((f) => f.name === name),
    refresh: () => {
      list.refetch();
      qc.invalidateQueries({ queryKey: ['insights'] });
    },
  };
  const Header = ui.header;

  const doExport = async (format: string, save = false) => {
    try {
      await download(`/resources/${meta.key}/export`, {
        ...ls.params,
        page: undefined,
        pageSize: undefined,
        format,
        save: save ? 1 : undefined,
      });
      if (save) toast.success('Export saved to File Manager');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={meta.label}
          subtitle={list.data ? plural(list.data.meta.total, 'record') : undefined}
          actions={
            <>
              {meta.can.export && (
                <Dropdown
                  trigger={
                    <Button variant="outline" icon="download">
                      Export
                    </Button>
                  }
                  items={[
                    {
                      label: 'Excel (.xlsx)',
                      icon: 'file-spreadsheet',
                      onClick: () => doExport('xlsx'),
                    },
                    {
                      label: 'CSV',
                      icon: 'file-text',
                      onClick: () => doExport('csv'),
                    },
                    {
                      label: 'PDF',
                      icon: 'file',
                      onClick: () => doExport('pdf'),
                    },
                    'divider',
                    {
                      label: 'Save Excel to File Manager',
                      icon: 'folder-input',
                      onClick: () => doExport('xlsx', true),
                    },
                  ]}
                />
              )}
              {meta.can.create && (
                <Button variant="outline" icon="file-up" onClick={() => setImporting(true)}>
                  Import
                </Button>
              )}
              {meta.can.create && (
                <Button icon="plus" onClick={() => setEditing(null)}>
                  New {meta.singular}
                </Button>
              )}
            </>
          }
        />
      )}
      {Header && !embedded && <Header meta={meta} />}
      <Card bodyClass="p-0">
        <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:items-center">
          <form
            className="relative flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              ls.setSearch(ls.searchInput);
            }}
          >
            <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input
              className="pl-9"
              placeholder={`Search ${meta.label.toLowerCase()}...`}
              value={ls.searchInput}
              onChange={(e) => ls.setSearchInput(e.target.value)}
              onBlur={() => ls.setSearch(ls.searchInput)}
            />
          </form>
          {filterFields.length > 0 && (
            <Button variant={showFilters ? 'secondary' : 'outline'} icon="filter" onClick={() => setShowFilters((s) => !s)}>
              Filters
              {Object.keys(ls.filters).length ? ` (${Object.keys(ls.filters).length})` : ''}
            </Button>
          )}
          {views.length > 0 && (
            <div className="flex rounded-xl border border-line bg-slate-50 p-0.5" role="tablist" aria-label="View">
              {[{ id: 'table', label: 'Table', icon: 'table-2' }, ...views].map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={view === v.id}
                  title={v.label}
                  onClick={() => setView(v.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${view === v.id ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  <Icon name={v.icon} className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">{v.label}</span>
                </button>
              ))}
            </div>
          )}
          {embedded && meta.can.create && (
            <Button icon="plus" onClick={() => setEditing(null)}>
              New {meta.singular}
            </Button>
          )}
          <Button variant="ghost" size="icon" icon="refresh-cw" onClick={() => viewProps.refresh()} aria-label="Refresh" />
        </div>
        {showFilters && filterFields.length > 0 && (
          <div className="grid grid-cols-1 gap-3 border-b border-line bg-slate-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
            {filterFields.map((f) => (
              <div key={f.name}>
                <label className="label">{f.label}</label>
                {f.type === 'relation' ? (
                  <AsyncSelect resource={f.relation!.resource} value={ls.filters[f.name]} onChange={(v) => ls.setFilter(f.name, v)} placeholder="All" />
                ) : f.type === 'boolean' ? (
                  <Select value={ls.filters[f.name] ?? ''} onChange={(e) => ls.setFilter(f.name, e.target.value)} placeholder="All" options={yesNo} />
                ) : f.type === 'select' ? (
                  <Select value={ls.filters[f.name] ?? ''} onChange={(e) => ls.setFilter(f.name, e.target.value)} placeholder="All" options={f.options ?? []} />
                ) : f.type === 'lookup' ? (
                  <Select value={ls.filters[f.name] ?? ''} onChange={(e) => ls.setFilter(f.name, e.target.value)} placeholder="All" options={lookups[f.lookup!] ?? []} />
                ) : (
                  <Input value={ls.filters[f.name] ?? ''} onChange={(e) => ls.setFilter(f.name, e.target.value)} />
                )}
              </div>
            ))}
            <div className="flex items-end">
              <Button variant="ghost" icon="x" onClick={ls.clearFilters}>
                Clear filters
              </Button>
            </div>
          </div>
        )}
        {activeView ? (
          <div className="p-3 sm:p-4">
            {!activeView.selfLoading && !list.isLoading && !viewProps.rows.length ? (
              <EmptyState title={`No ${meta.label.toLowerCase()} yet`} description={ls.search || Object.keys(ls.filters).length ? 'Nothing matches your search or filters.' : undefined} />
            ) : (
              <activeView.component {...viewProps} />
            )}
            {!activeView.selfLoading && list.data && list.data.meta.total > viewProps.rows.length && (
              <p className="mt-3 text-center text-xs text-slate-500">
                Showing {viewProps.rows.length} of {list.data.meta.total}. Use search or filters to narrow down, or switch to the table.
              </p>
            )}
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={list.data?.data ?? []}
            rowKey={(r) => String(r[idField])}
            loading={list.isFetching}
            sort={{ field: ls.sort, order: ls.order }}
            onSort={ls.toggleSort}
            onRowClick={ui.detailPath || meta.can.update ? openRow : undefined}
            actions={(r) => (
              <Dropdown
                trigger={<Button variant="ghost" size="icon" icon="more-vertical" aria-label="Actions" />}
                items={[
                  {
                    label: 'Open',
                    icon: 'arrow-up-right',
                    onClick: () => openRow(r),
                    hidden: !ui.detailPath,
                  },
                  {
                    label: 'Edit',
                    icon: 'pencil',
                    onClick: () => setEditing(String(r[idField])),
                    hidden: !meta.can.update || !!locked?.(r),
                  },
                  ...extra.map((a) => ({
                    label: a.label,
                    icon: a.icon,
                    danger: a.danger,
                    hidden: a.visible ? !a.visible(r) : false,
                    onClick: () => runAction(a, r),
                  })),
                  {
                    label: 'Delete',
                    icon: 'trash-2',
                    danger: true,
                    onClick: () => remove(r),
                    hidden: !meta.can.delete || !!locked?.(r),
                  },
                ]}
              />
            )}
            empty={
              <EmptyState
                title={`No ${meta.label.toLowerCase()} yet`}
                description={ls.search || Object.keys(ls.filters).length ? 'Nothing matches your search or filters.' : undefined}
                action={
                  meta.can.create && (
                    <Button icon="plus" onClick={() => setEditing(null)}>
                      New {meta.singular}
                    </Button>
                  )
                }
              />
            }
          />
        )}
        {list.data && !activeView && (
          <Pagination page={ls.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />
        )}
      </Card>
      <ResourceForm meta={meta} id={editing ?? null} open={editing !== undefined} onClose={() => setEditing(undefined)} />
      {meta.can.create && <ImportDialog meta={meta} open={importing} onClose={() => setImporting(false)} />}
    </div>
  );
}
