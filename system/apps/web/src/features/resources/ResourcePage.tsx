import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { download } from '@/lib/download';
import { fmtByType } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DataTable, Dropdown, EmptyState, Icon, Input, Pagination, PageHeader, Select, Spinner, toast, type Column } from '@/components/ui';
import { useLookups } from './FieldInput';
import { ResourceForm } from './ResourceForm';
import { LOCKED, RESOURCE_ACTIONS } from './resourceActions';
import type { FieldDef, ResourceMeta, Row } from './types';

/** One generic page for every master-data style resource: list, search, filter, sort, export, create, edit, delete. */
export default function ResourcePage() {
  const { key = '' } = useParams();
  const meta = useQuery({ queryKey: ['meta', key], queryFn: () => api.get<ResourceMeta>(`/meta/resources/${key}`), staleTime: 5 * 60_000 });
  if (meta.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  if (meta.error || !meta.data) return <EmptyState icon="shield-alert" title="Not available" description={(meta.error as Error)?.message} />;
  return <ResourceList key={key} meta={meta.data} />;
}

function ResourceList({ meta }: { meta: ResourceMeta }) {
  const ls = useListState({ sort: meta.defaultSort?.field, order: meta.defaultSort?.order });
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(Object.keys(ls.filters).length > 0);
  const lookups = useLookups(meta.fields.filter((f) => f.type === 'lookup').map((f) => f.lookup!));
  const idField = meta.idField;

  const list = useQuery({
    queryKey: ['resource', meta.key, 'list', ls.params],
    queryFn: () => api.get<Paged<Row>>(`/resources/${meta.key}`, ls.params),
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
    if (f.type === 'select') return <Badge tone={['CANCELLED', 'REJECTED'].includes(v) ? 'red' : ['APPROVED', 'COMPLETED'].includes(v) ? 'green' : v === 'PENDING' ? 'amber' : 'gray'}>{label ?? v}</Badge>;
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
    if (!(await confirm({ title: `Delete ${meta.singular}?`, message: 'This record will be removed. This action is recorded in the audit trail.', confirmText: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/resources/${meta.key}/${r[idField]}`);
      toast.success(`${meta.singular} deleted`);
      qc.invalidateQueries({ queryKey: ['resource', meta.key] });
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
    } catch (e) {
      toast.error(e);
    }
  };

  const doExport = async (format: string, save = false) => {
    try {
      await download(`/resources/${meta.key}/export`, { ...ls.params, page: undefined, pageSize: undefined, format, save: save ? 1 : undefined });
      if (save) toast.success('Export saved to File Manager');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div>
      <PageHeader
        title={meta.label}
        subtitle={list.data ? `${list.data.meta.total} records` : undefined}
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
                  { label: 'Excel (.xlsx)', icon: 'file-spreadsheet', onClick: () => doExport('xlsx') },
                  { label: 'CSV', icon: 'file-text', onClick: () => doExport('csv') },
                  { label: 'PDF', icon: 'file', onClick: () => doExport('pdf') },
                  'divider',
                  { label: 'Save Excel to File Manager', icon: 'folder-input', onClick: () => doExport('xlsx', true) },
                ]}
              />
            )}
            {meta.can.create && (
              <Button icon="plus" onClick={() => setEditing(null)}>
                New {meta.singular}
              </Button>
            )}
          </>
        }
      />
      <Card bodyClass="p-0">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center dark:border-slate-800">
          <form
            className="relative flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              ls.setSearch(ls.searchInput);
            }}
          >
            <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder={`Search ${meta.label.toLowerCase()}...`} value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
          </form>
          {filterFields.length > 0 && (
            <Button variant={showFilters ? 'secondary' : 'outline'} icon="filter" onClick={() => setShowFilters((s) => !s)}>
              Filters{Object.keys(ls.filters).length ? ` (${Object.keys(ls.filters).length})` : ''}
            </Button>
          )}
          <Button variant="ghost" size="icon" icon="refresh-cw" onClick={() => list.refetch()} aria-label="Refresh" />
        </div>
        {showFilters && filterFields.length > 0 && (
          <div className="grid grid-cols-1 gap-3 border-b border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4 dark:border-slate-800 dark:bg-slate-900/40">
            {filterFields.map((f) => (
              <div key={f.name}>
                <label className="label">{f.label}</label>
                {f.type === 'relation' ? (
                  <AsyncSelect resource={f.relation!.resource} value={ls.filters[f.name]} onChange={(v) => ls.setFilter(f.name, v)} placeholder="All" />
                ) : f.type === 'boolean' ? (
                  <Select value={ls.filters[f.name] ?? ''} onChange={(e) => ls.setFilter(f.name, e.target.value)} placeholder="All" options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
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
        <DataTable
          columns={columns}
          rows={list.data?.data ?? []}
          rowKey={(r) => String(r[idField])}
          loading={list.isFetching}
          sort={{ field: ls.sort, order: ls.order }}
          onSort={ls.toggleSort}
          onRowClick={
            meta.can.update
              ? (r) => {
                  if (!locked?.(r)) setEditing(String(r[idField]));
                }
              : undefined
          }
          actions={(r) => (
            <Dropdown
              trigger={<Button variant="ghost" size="icon" icon="more-vertical" aria-label="Actions" />}
              items={[
                { label: 'Edit', icon: 'pencil', onClick: () => setEditing(String(r[idField])), hidden: !meta.can.update || !!locked?.(r) },
                ...extra.map((a) => ({ label: a.label, icon: a.icon, danger: a.danger, hidden: a.visible ? !a.visible(r) : false, onClick: () => runAction(a, r) })),
                { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => remove(r), hidden: !meta.can.delete || !!locked?.(r) },
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
        {list.data && <Pagination page={ls.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
      </Card>
      <ResourceForm meta={meta} id={editing ?? null} open={editing !== undefined} onClose={() => setEditing(undefined)} />
    </div>
  );
}
