import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { download } from '@/lib/download';
import { fmtNumber, plural } from '@/lib/format';
import { useSession } from '@/stores/session';
import { useLookupOptions } from '@/hooks/useLookups';
import { Button, Card, Checkbox, confirm, DataTable, Dropdown, EmptyState, Icon, Input, Pagination, Select, toast, type Column } from '@/components/ui';
import { localPhone, PlaceStatus, type Place } from './common';

interface PlacesResponse extends Paged<Place> {
  categories: { value: string; count: number }[];
  summary: { total: number; withEmail: number; withPhone: number; imported: number };
}

interface LeadResult {
  created: number;
  linkedToExistingLead: number;
  skippedCustomer: number;
  skippedDuplicateInSelection: number;
  considered: number;
}

/** Found places: filter, select, add to leads, ignore, export. Used for one search or for all results. */
export function PlaceResults({ jobId, live }: { jobId?: string; live?: boolean }) {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const statuses = useLookupOptions('MAP_PLACE_STATUS');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('NEW');
  const [category, setCategory] = useState('');
  const [minRating, setMinRating] = useState('');
  const [hasEmail, setHasEmail] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [hasWebsite, setHasWebsite] = useState(false);
  const [sort, setSort] = useState<{ field: string; order: 'asc' | 'desc' }>({ field: 'createdAt', order: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const filter = useMemo(
    () => ({ jobId, status: status || undefined, category: category || undefined, minRating: minRating || undefined, hasEmail: hasEmail || undefined, hasPhone: hasPhone || undefined, hasWebsite: hasWebsite || undefined, search: search || undefined }),
    [jobId, status, category, minRating, hasEmail, hasPhone, hasWebsite, search],
  );
  const params = { ...filter, page, pageSize, sort: sort.field, order: sort.order };
  const q = useQuery({
    queryKey: ['leadfinder', 'places', params],
    queryFn: () => api.get<PlacesResponse>('/leadfinder/places', params),
    placeholderData: keepPreviousData,
    refetchInterval: live ? 5000 : false,
  });
  const rows = q.data?.data ?? [];
  const total = q.data?.meta.total ?? 0;
  const refresh = () => {
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ['leadfinder'] });
  };
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    setPage(1);
    setSelected(new Set());
    fn(v);
  };
  /** the selected rows, or - when nothing is selected - everything that matches the filters */
  const target = () => (selected.size ? { ids: [...selected] } : { filter });
  const targetLabel = selected.size ? plural(selected.size, 'selected place') : `all ${plural(total, 'place')} that match the filters`;

  const addToLeads = async () => {
    if (!(await confirm({ title: 'Add to leads?', message: `Creates a lead for ${targetLabel} (up to 1,000 at a time). Businesses that are already a lead or customer are not added twice.`, confirmText: 'Add to leads' }))) return;
    setBusy(true);
    try {
      const r = await api.post<LeadResult>('/leadfinder/places/leads', target());
      const parts = [`${r.created} new ${r.created === 1 ? 'lead' : 'leads'}`];
      if (r.linkedToExistingLead) parts.push(`${r.linkedToExistingLead} already a lead (linked)`);
      if (r.skippedCustomer) parts.push(`${r.skippedCustomer} already a customer (skipped)`);
      toast.success(parts.join(' · '));
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const act = async (path: 'ignore' | 'restore' | 'delete', label: string, danger = false) => {
    if (!(await confirm({ title: `${label}?`, message: `${label} ${targetLabel}.`, confirmText: label, danger }))) return;
    setBusy(true);
    try {
      const r = await api.post<{ updated?: number; deleted?: number }>(`/leadfinder/places/${path}`, target());
      toast.success(`${r.updated ?? r.deleted ?? 0} updated`);
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const doExport = async (format: 'xlsx' | 'csv') => {
    try {
      await download('/leadfinder/places/export', { ...filter, format });
    } catch (e) {
      toast.error(e);
    }
  };

  const dash = <span className="text-slate-300">—</span>;
  const columns: Column<Place>[] = [
    {
      key: 'title',
      header: 'Name',
      sortable: true,
      render: (p) => (
        <div className="max-w-56 min-w-36">
          <p className="font-medium text-slate-900">{p.title}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            {p.category && <span>{p.category}</span>}
            {p.rating !== null && (
              <span className="inline-flex items-center gap-0.5 whitespace-nowrap" title={`${fmtNumber(p.rating, 1)} from ${p.reviewCount ?? 0} reviews`}>
                <Icon name="star" className="h-3 w-3 text-amber-500" />
                {fmtNumber(p.rating, 1)} ({p.reviewCount ?? 0})
              </span>
            )}
          </p>
        </div>
      ),
    },
    {
      key: 'address',
      header: 'Address',
      hideOnMobile: true,
      render: (p) =>
        p.address ? (
          <span className="line-clamp-2 max-w-64 min-w-40 text-sm text-slate-700" title={p.address}>
            {p.address}
          </span>
        ) : (
          dash
        ),
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (p) =>
        p.phone ? (
          <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} className="whitespace-nowrap text-sm text-slate-700 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>
            {localPhone(p.phone)}
          </a>
        ) : (
          dash
        ),
    },
    {
      key: 'website',
      header: 'Website',
      hideOnMobile: true,
      render: (p) =>
        p.website ? (
          <a href={p.website} target="_blank" rel="noopener noreferrer" title={p.website} className="block max-w-40 truncate text-sm text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
            {p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
          </a>
        ) : (
          dash
        ),
    },
    {
      key: 'emails',
      header: 'E-mail',
      render: (p) =>
        p.emails.length ? (
          <div className="space-y-0.5 text-sm text-slate-700">
            {p.emails.map((e) => (
              <p key={e} className="break-all">
                {e}
              </p>
            ))}
          </div>
        ) : (
          dash
        ),
    },
    {
      key: 'statusCode',
      header: 'Status',
      render: (p) => (
        <div className="space-y-1">
          <PlaceStatus code={p.statusCode} />
          {p.leadId && (
            <Link to="/r/leads" className="block text-xs text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
              {p.leadCode ?? 'Lead'}
            </Link>
          )}
        </div>
      ),
    },
    {
      key: 'map',
      header: '',
      render: (p) =>
        p.mapsUrl ? (
          <a href={p.mapsUrl} target="_blank" rel="noopener noreferrer" title="Open on Google Maps" aria-label={`Open ${p.title} on Google Maps`} className="inline-flex rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>
            <Icon name="map-pin" className="h-4 w-4" />
          </a>
        ) : null,
    },
  ];

  const s = q.data?.summary;
  return (
    <Card bodyClass="p-0">
      {s && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line px-4 py-3 text-sm text-slate-600">
          <span>
            <b className="text-slate-900">{fmtNumber(s.total, 0)}</b> places
          </span>
          <span>
            <b className="text-slate-900">{fmtNumber(s.withPhone, 0)}</b> with phone
          </span>
          <span>
            <b className="text-slate-900">{fmtNumber(s.withEmail, 0)}</b> with e-mail
          </span>
          <span>
            <b className="text-slate-900">{fmtNumber(s.imported, 0)}</b> added to leads
          </span>
        </div>
      )}
      <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            resetPage(setSearch)(searchInput);
          }}
        >
          <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder="Search name, address, e-mail, phone..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} onBlur={() => searchInput !== search && resetPage(setSearch)(searchInput)} />
        </form>
        <Select aria-label="Status" value={status} onChange={(e) => resetPage(setStatus)(e.target.value)} placeholder="Any status" options={statuses.map((o) => ({ value: o.value, label: o.label }))} />
        <Select aria-label="Category" value={category} onChange={(e) => resetPage(setCategory)(e.target.value)} placeholder="All categories" options={(q.data?.categories ?? []).map((c) => ({ value: c.value, label: `${c.value} (${c.count})` }))} />
        <Select
          aria-label="Minimum rating"
          value={minRating}
          onChange={(e) => resetPage(setMinRating)(e.target.value)}
          placeholder="Any rating"
          options={['3', '3.5', '4', '4.5'].map((v) => ({ value: v, label: `${v.replace('.', ',')}+ stars` }))}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5">
        <div className="flex flex-wrap gap-4 text-sm">
          <Checkbox checked={hasPhone} onChange={resetPage(setHasPhone)} label="Has phone" />
          <Checkbox checked={hasEmail} onChange={resetPage(setHasEmail)} label="Has e-mail" />
          <Checkbox checked={hasWebsite} onChange={resetPage(setHasWebsite)} label="Has website" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">{selected.size ? plural(selected.size, 'place') + ' selected' : 'Nothing selected: actions apply to all filtered places'}</span>
          {can('crm.leadfinder.import') && can('crm.lead.create') && (
            <Button icon="user-plus" size="sm" onClick={addToLeads} loading={busy} disabled={!total}>
              Add to leads
            </Button>
          )}
          <Dropdown
            trigger={<Button variant="outline" size="sm" icon="more-horizontal" aria-label="More actions" />}
            items={[
              { label: 'Ignore', icon: 'eye-off', onClick: () => act('ignore', 'Ignore'), hidden: !can('crm.leadfinder.import') },
              { label: 'Restore ignored', icon: 'undo-2', onClick: () => act('restore', 'Restore'), hidden: !can('crm.leadfinder.import') },
              'divider',
              { label: 'Export Excel', icon: 'file-spreadsheet', onClick: () => doExport('xlsx') },
              { label: 'Export CSV', icon: 'file-text', onClick: () => doExport('csv') },
              'divider',
              { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => act('delete', 'Delete', true), hidden: !can('crm.leadfinder.delete') },
            ]}
          />
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        loading={q.isFetching && !live}
        sort={{ field: sort.field, order: sort.order }}
        onSort={(field) => setSort((s0) => ({ field, order: s0.field === field && s0.order === 'asc' ? 'desc' : 'asc' }))}
        selectable={{ selected, onChange: setSelected }}
        empty={<EmptyState icon="map-pinned" title={live ? 'Waiting for the first results...' : 'No places found'} description={!live ? 'Change the filters or start a new search.' : undefined} />}
      />
      {q.data && (
        <Pagination
          page={page}
          totalPages={q.data.meta.totalPages}
          total={total}
          pageSize={pageSize}
          onPage={(p) => {
            setPage(p);
            setSelected(new Set());
          }}
          onPageSize={(sz) => {
            setPageSize(sz);
            setPage(1);
          }}
        />
      )}
    </Card>
  );
}
