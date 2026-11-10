import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { download } from '@/lib/download';
import { fmtBytes, fmtDate, fmtDateTime } from '@/lib/format';
import { useSession } from '@/stores/session';
import { useLookups } from '@/features/resources/FieldInput';
import { Badge, Button, Card, cn, confirm, DataTable, Dropdown, EmptyState, Icon, Input, Pagination, PageHeader, Select, Spinner, toast, type Column } from '@/components/ui';
import { BulkDialog, EditFileDialog, FolderDialog, PreviewDialog } from './FileDialogs';
import { SOURCE_LABEL, TYPE_META, type FileRow, type Folder, type FolderResponse, type Group } from './fileTypes';

type UploadItem = { name: string; size: number; status: 'queued' | 'uploading' | 'done' | 'error'; error?: string };
const SPECIAL: Record<string, { label: string; icon: string }> = {
  all: { label: 'All files', icon: 'files' },
  root: { label: 'Unfiled', icon: 'inbox' },
  GENERATED: { label: 'Generated documents', icon: 'file-check-2' },
  EXPORT: { label: 'Exports', icon: 'file-down' },
};

export default function FileManagerPage() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? '';
  const set = (patch: Record<string, string | null>) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k);
        if (!('page' in patch)) n.delete('page');
        return n;
      },
      { replace: true },
    );

  const location = get('loc') || 'all';
  const page = Number(get('page')) || 1;
  const view = (get('view') || 'list') as 'list' | 'grid';
  const groupBy = get('group');
  const [searchInput, setSearchInput] = useState(get('search'));
  const [showFilters, setShowFilters] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [folderDialog, setFolderDialog] = useState<{ folder: Folder | null; parentId: string | null } | null>(null);
  const [editing, setEditing] = useState<FileRow | null>(null);
  const [preview, setPreview] = useState<FileRow | null>(null);
  const [bulk, setBulk] = useState<'move' | 'tag' | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const categories = useLookups(['FILE_CATEGORY']).FILE_CATEGORY ?? [];
  const catLabel = (c: string | null) => categories.find((x) => x.value === c)?.label ?? c ?? '';
  const folders = useQuery({ queryKey: ['files', 'folders'], queryFn: () => api.get<FolderResponse>('/files/folders') });
  const stats = useQuery({ queryKey: ['files', 'stats'], queryFn: () => api.get<{ files: number; size: number; byType: Group[] }>('/files/stats') });
  const tags = useQuery({ queryKey: ['files', 'tags'], queryFn: () => api.get<{ tag: string; count: number }[]>('/files/tags') });
  const folderList = folders.data?.folders ?? [];
  const currentFolder = folderList.find((f) => f.id === location) ?? null;

  const filters = useMemo(() => {
    const f: Record<string, string | undefined> = {
      search: get('search') || undefined,
      type: get('type') || undefined,
      categoryCode: get('category') || undefined,
      tag: get('tag') || undefined,
      source: get('source') || undefined,
      from: get('from') || undefined,
      to: get('to') || undefined,
    };
    if (location === 'root') f.folderId = 'root';
    else if (location === 'GENERATED' || location === 'EXPORT') f.source = location;
    else if (location !== 'all') f.folderId = location;
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);
  const activeFilterCount = ['type', 'category', 'tag', 'source', 'from', 'to'].filter((k) => get(k)).length;

  const list = useQuery({
    queryKey: ['files', 'list', filters, page, get('sort'), get('order')],
    queryFn: () => api.get<Paged<FileRow>>('/files', { ...filters, page, pageSize: 40, sort: get('sort') || 'createdAt', order: get('order') || 'desc' }),
    placeholderData: keepPreviousData,
    enabled: !groupBy,
  });
  const groups = useQuery({ queryKey: ['files', 'groups', groupBy, filters], queryFn: () => api.get<Group[]>(`/files/groups/${groupBy}`, filters), enabled: !!groupBy });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['files'] });
    setSelected(new Set());
  };

  // ------------------------------------------------------------ upload
  const upload = async (files: FileList | File[]) => {
    if (!can('files.file.upload')) return toast.error('You do not have permission to upload files');
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploads(arr.map((f) => ({ name: f.name, size: f.size, status: 'queued' })));
    let ok = 0;
    for (let i = 0; i < arr.length; i++) {
      setUploads((u) => u.map((x, idx) => (idx === i ? { ...x, status: 'uploading' } : x)));
      const fd = new FormData();
      fd.append('files', arr[i], arr[i].name);
      if (currentFolder) fd.append('folderId', currentFolder.id);
      try {
        await api.post('/files/upload', fd);
        ok++;
        setUploads((u) => u.map((x, idx) => (idx === i ? { ...x, status: 'done' } : x)));
      } catch (e) {
        setUploads((u) => u.map((x, idx) => (idx === i ? { ...x, status: 'error', error: (e as Error).message } : x)));
      }
    }
    if (ok) toast.success(`${ok} file${ok > 1 ? 's' : ''} uploaded`);
    refresh();
    setTimeout(() => setUploads((u) => u.filter((x) => x.status === 'error')), 2500);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
  };

  // ------------------------------------------------------------ actions
  const remove = async (f: FileRow) => {
    if (!(await confirm({ title: 'Delete file?', message: `"${f.name}" will be moved out of the file manager.`, confirmText: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/files/${f.id}`);
      toast.success('File deleted');
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  const bulkApply = async (action: 'move' | 'tag' | 'delete', payload: { folderId?: string | null; tags?: string[] } = {}) => {
    try {
      const r = await api.post<{ affected: number }>('/files/bulk', { ids: [...selected], action, ...payload });
      toast.success(`${r.affected} file(s) updated`);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  const bulkDelete = async () => {
    if (await confirm({ title: `Delete ${selected.size} file(s)?`, confirmText: 'Delete', danger: true })) bulkApply('delete');
  };
  const removeFolder = async (f: Folder) => {
    if (!(await confirm({ title: 'Delete folder?', message: `Folder "${f.name}" must be empty.`, confirmText: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/files/folders/${f.id}`);
      toast.success('Folder deleted');
      if (location === f.id) set({ loc: null });
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  const fileMenu = (f: FileRow) => (
    <Dropdown
      trigger={<Button variant="ghost" size="icon" icon="more-vertical" aria-label="File actions" />}
      items={[
        { label: 'Preview', icon: 'eye', onClick: () => setPreview(f) },
        { label: 'Download', icon: 'download', onClick: () => download(`/files/${f.id}/download`).catch(toast.error), hidden: !can('files.file.download') },
        { label: 'Details & edit', icon: 'pencil', onClick: () => setEditing(f), hidden: !can('files.file.update') },
        'divider',
        { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => remove(f), hidden: !can('files.file.delete') },
      ]}
    />
  );

  const columns: Column<FileRow>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (f) => (
        <span className="flex min-w-0 items-center gap-2">
          <Icon name={TYPE_META[f.fileType]?.icon ?? 'file'} className="h-4 w-4 shrink-0" />
          <span className="truncate font-medium">{f.name}</span>
        </span>
      ),
    },
    { key: 'category', header: 'Category', render: (f) => (f.categoryCode ? <Badge tone="blue">{catLabel(f.categoryCode)}</Badge> : '') },
    {
      key: 'tags',
      header: 'Tags',
      render: (f) => (
        <span className="flex flex-wrap justify-end gap-1 md:justify-start">
          {f.tags.slice(0, 3).map((t) => (
            <Badge key={t}>#{t}</Badge>
          ))}
        </span>
      ),
    },
    { key: 'source', header: 'Source', render: (f) => <Badge tone={f.source === 'UPLOAD' ? 'gray' : f.source === 'GENERATED' ? 'violet' : 'amber'}>{SOURCE_LABEL[f.source]}</Badge> },
    { key: 'size', header: 'Size', sortable: true, align: 'right', render: (f) => fmtBytes(f.size) },
    { key: 'createdAt', header: 'Uploaded', sortable: true, render: (f) => <span title={f.uploadedBy ?? ''}>{fmtDateTime(f.createdAt)}</span> },
  ];

  const fileGrid = (rows: FileRow[]) => (
    <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {rows.map((f) => {
        const meta = TYPE_META[f.fileType] ?? TYPE_META.other;
        const isSel = selected.has(f.id);
        return (
          <div key={f.id} className={cn('group relative flex flex-col rounded-xl border p-3 transition hover:shadow-md', isSel ? 'border-brand-500 bg-brand-50/60 dark:bg-slate-800' : 'border-slate-200 dark:border-slate-800')}>
            <input
              type="checkbox"
              className="absolute top-2 left-2 accent-brand-700"
              checked={isSel}
              onChange={() => setSelected((s) => (s.has(f.id) ? new Set([...s].filter((x) => x !== f.id)) : new Set([...s, f.id])))}
              aria-label="Select file"
            />
            <div className="absolute top-1 right-1">{fileMenu(f)}</div>
            <button type="button" onClick={() => setPreview(f)} className="mt-4 flex flex-col items-center gap-2 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-xl" style={{ background: `${meta.color}1a`, color: meta.color }}>
                <Icon name={meta.icon} className="h-7 w-7" />
              </span>
              <span className="line-clamp-2 w-full text-xs font-medium break-all">{f.name}</span>
              <span className="text-[11px] text-slate-400">
                {fmtBytes(f.size)} · {fmtDate(f.createdAt)}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );

  const renderFiles = (rows: FileRow[], loading: boolean) =>
    view === 'grid' ? (
      loading && !rows.length ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : rows.length ? (
        fileGrid(rows)
      ) : (
        <EmptyState icon="folder-open" title="No files here" description="Drop files anywhere on this page to upload." />
      )
    ) : (
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(f) => f.id}
        loading={loading}
        onRowClick={setPreview}
        selectable={{ selected, onChange: setSelected }}
        sort={{ field: get('sort') || 'createdAt', order: (get('order') as 'asc' | 'desc') || 'desc' }}
        onSort={(field) => set({ sort: field === 'createdAt' || field === 'name' || field === 'size' ? field : null, order: get('sort') === field && get('order') !== 'desc' ? 'desc' : 'asc' })}
        actions={fileMenu}
        empty={<EmptyState icon="folder-open" title="No files here" description="Drop files anywhere on this page, or use the Upload button." />}
      />
    );

  // ------------------------------------------------------------ folder tree
  const tree = (parentId: string | null, depth: number): ReactNode =>
    folderList
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => (
        <div key={f.id}>
          <div className={cn('group flex items-center rounded-lg pr-1', location === f.id ? 'bg-brand-50 text-brand-800 dark:bg-slate-800 dark:text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>
            <button type="button" onClick={() => (set({ loc: f.id }), setSidebarOpen(false))} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm" style={{ paddingLeft: 8 + depth * 14 }}>
              <Icon name={location === f.id ? 'folder-open' : 'folder'} className="h-4 w-4 shrink-0" />
              <span className="truncate" style={{ color: f.color ?? undefined }}>
                {f.name}
              </span>
              <span className="ml-auto text-xs text-slate-400">{f.files}</span>
            </button>
            {can('files.folder.manage') && (
              <Dropdown
                trigger={<button type="button" className="rounded p-1 text-slate-400 opacity-60 group-hover:opacity-100" aria-label="Folder actions"><Icon name="more-horizontal" /></button>}
                items={[
                  { label: 'New subfolder', icon: 'folder-plus', onClick: () => setFolderDialog({ folder: null, parentId: f.id }) },
                  { label: 'Edit', icon: 'pencil', onClick: () => setFolderDialog({ folder: f, parentId: f.parentId }) },
                  { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => removeFolder(f) },
                ]}
              />
            )}
          </div>
          {tree(f.id, depth + 1)}
        </div>
      ));

  const sidebar = (
    <div className="space-y-4">
      <div className="space-y-0.5">
        {Object.entries(SPECIAL).map(([k, v]) => (
          <button
            key={k}
            type="button"
            onClick={() => (set({ loc: k === 'all' ? null : k }), setSidebarOpen(false))}
            className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm', location === k ? 'bg-brand-50 font-medium text-brand-800 dark:bg-slate-800 dark:text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}
          >
            <Icon name={v.icon} className="h-4 w-4" />
            {v.label}
            {k === 'all' && <span className="ml-auto text-xs text-slate-400">{stats.data?.files ?? ''}</span>}
            {k === 'root' && <span className="ml-auto text-xs text-slate-400">{folders.data?.root.files ?? ''}</span>}
          </button>
        ))}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Folders</span>
          {can('files.folder.manage') && <Button variant="ghost" size="sm" icon="folder-plus" onClick={() => setFolderDialog({ folder: null, parentId: null })} aria-label="New folder" />}
        </div>
        {folders.isLoading ? <Spinner className="ml-2 h-4 w-4" /> : folderList.length ? tree(null, 0) : <p className="px-2 text-xs text-slate-400">No folders yet</p>}
      </div>
      {!!tags.data?.length && (
        <div>
          <p className="mb-1 px-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">Tags</p>
          <div className="flex flex-wrap gap-1 px-2">
            {tags.data.slice(0, 30).map((t) => (
              <button key={t.tag} type="button" onClick={() => set({ tag: get('tag') === t.tag ? null : t.tag })} className={cn('rounded-full px-2 py-0.5 text-xs', get('tag') === t.tag ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300')}>
                #{t.tag} <span className="opacity-60">{t.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {stats.data && (
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
          <p className="text-xs text-slate-500">Storage used</p>
          <p className="font-semibold">{fmtBytes(stats.data.size)}</p>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            {stats.data.byType.map((g) => (
              <div key={g.key} style={{ width: `${(g.size / Math.max(1, stats.data!.size)) * 100}%`, background: TYPE_META[g.key]?.color }} title={`${TYPE_META[g.key]?.label}: ${fmtBytes(g.size)}`} />
            ))}
          </div>
          <div className="mt-2 space-y-0.5">
            {stats.data.byType.map((g) => (
              <div key={g.key} className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full" style={{ background: TYPE_META[g.key]?.color }} />
                <span className="flex-1">{TYPE_META[g.key]?.label ?? g.key}</span>
                <span className="text-slate-400">{g.files}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const title = currentFolder?.name ?? SPECIAL[location]?.label ?? 'Files';

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
      className="relative"
    >
      <PageHeader
        title="File Manager"
        subtitle={title}
        actions={
          <>
            <Button variant="outline" icon="folder-tree" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
              Folders
            </Button>
            {can('files.file.upload') && (
              <>
                <input ref={fileInput} type="file" multiple hidden onChange={(e) => (e.target.files && upload(e.target.files), (e.target.value = ''))} />
                <Button icon="upload" onClick={() => fileInput.current?.click()}>
                  Upload
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="hidden lg:block">
          <Card bodyClass="p-3">{sidebar}</Card>
        </aside>
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-white p-4 dark:bg-slate-900">{sidebar}</div>
          </div>
        )}
        <div className="min-w-0 space-y-3">
          {uploads.length > 0 && (
            <Card bodyClass="p-3 space-y-1.5">
              {uploads.map((u, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <Icon name={u.status === 'done' ? 'check-circle-2' : u.status === 'error' ? 'alert-circle' : 'loader'} className={cn('h-4 w-4', u.status === 'done' && 'text-emerald-600', u.status === 'error' && 'text-red-600', u.status === 'uploading' && 'animate-spin')} />
                  <span className="flex-1 truncate">{u.name}</span>
                  <span className="text-xs text-slate-400">{u.status === 'error' ? u.error : fmtBytes(u.size)}</span>
                </div>
              ))}
              {uploads.some((u) => u.status === 'error') && (
                <Button size="sm" variant="ghost" onClick={() => setUploads([])}>
                  Dismiss
                </Button>
              )}
            </Card>
          )}
          <Card bodyClass="p-0">
            <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center dark:border-slate-800">
              <form
                className="relative flex-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  set({ search: searchInput || null });
                }}
              >
                <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                <Input className="pl-9" placeholder="Search name, description, tag..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} onBlur={() => set({ search: searchInput || null })} />
              </form>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant={showFilters ? 'secondary' : 'outline'} icon="filter" onClick={() => setShowFilters((s) => !s)}>
                  Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
                </Button>
                <Select
                  className="w-auto"
                  value={groupBy}
                  onChange={(e) => set({ group: e.target.value || null })}
                  options={[
                    { value: 'type', label: 'Group: Type' },
                    { value: 'month', label: 'Group: Month' },
                    { value: 'category', label: 'Group: Category' },
                    { value: 'source', label: 'Group: Source' },
                  ]}
                  placeholder="No grouping"
                  aria-label="Group by"
                />
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700">
                  <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="icon" icon="list" onClick={() => set({ view: null })} aria-label="List view" />
                  <Button variant={view === 'grid' ? 'secondary' : 'ghost'} size="icon" icon="layout-grid" onClick={() => set({ view: 'grid' })} aria-label="Grid view" />
                </div>
              </div>
            </div>
            {showFilters && (
              <div className="grid grid-cols-1 gap-3 border-b border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-3 lg:grid-cols-6 dark:border-slate-800 dark:bg-slate-900/40">
                <div>
                  <label className="label">Type</label>
                  <Select value={get('type')} onChange={(e) => set({ type: e.target.value || null })} placeholder="All" options={Object.entries(TYPE_META).map(([value, m]) => ({ value, label: m.label }))} />
                </div>
                <div>
                  <label className="label">Category</label>
                  <Select value={get('category')} onChange={(e) => set({ category: e.target.value || null })} placeholder="All" options={categories} />
                </div>
                <div>
                  <label className="label">Tag</label>
                  <Select value={get('tag')} onChange={(e) => set({ tag: e.target.value || null })} placeholder="All" options={(tags.data ?? []).map((t) => ({ value: t.tag, label: `#${t.tag}` }))} />
                </div>
                <div>
                  <label className="label">Source</label>
                  <Select value={get('source')} onChange={(e) => set({ source: e.target.value || null })} placeholder="All" options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))} />
                </div>
                <div>
                  <label className="label">From</label>
                  <Input type="date" value={get('from')} onChange={(e) => set({ from: e.target.value || null })} />
                </div>
                <div>
                  <label className="label">To</label>
                  <Input type="date" value={get('to')} onChange={(e) => set({ to: e.target.value || null })} />
                </div>
                <div className="sm:col-span-3 lg:col-span-6">
                  <Button variant="ghost" icon="x" onClick={() => set({ type: null, category: null, tag: null, source: null, from: null, to: null })}>
                    Clear filters
                  </Button>
                </div>
              </div>
            )}
            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-brand-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-800">
                <span className="font-medium">{selected.size} selected</span>
                {can('files.file.update') && (
                  <>
                    <Button size="sm" variant="outline" icon="folder-input" onClick={() => setBulk('move')}>
                      Move
                    </Button>
                    <Button size="sm" variant="outline" icon="tag" onClick={() => setBulk('tag')}>
                      Tag
                    </Button>
                  </>
                )}
                {can('files.file.delete') && (
                  <Button size="sm" variant="danger" icon="trash-2" onClick={bulkDelete}>
                    Delete
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            )}
            {groupBy ? (
              groups.isLoading ? (
                <div className="flex justify-center py-10">
                  <Spinner />
                </div>
              ) : groups.data?.length ? (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {groups.data.map((g) => (
                    <GroupSection key={g.key} by={groupBy} group={g} filters={filters} label={groupLabel(groupBy, g.key, catLabel, folderList)} render={renderFiles} />
                  ))}
                </div>
              ) : (
                <EmptyState icon="folder-open" title="No files found" />
              )
            ) : (
              <>
                {renderFiles(list.data?.data ?? [], list.isFetching)}
                {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={40} onPage={(p) => set({ page: String(p) })} />}
              </>
            )}
          </Card>
        </div>
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-brand-700/20 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-brand-600 bg-white px-10 py-8 text-center shadow-xl dark:bg-slate-900">
            <Icon name="upload-cloud" className="mx-auto h-10 w-10 text-brand-700" />
            <p className="mt-2 font-semibold">Drop files to upload</p>
            <p className="text-sm text-slate-500">into {title}</p>
          </div>
        </div>
      )}

      <FolderDialog open={!!folderDialog} onClose={() => setFolderDialog(null)} folder={folderDialog?.folder ?? null} parentId={folderDialog?.parentId ?? null} folders={folderList} onSaved={refresh} />
      <EditFileDialog file={editing} onClose={() => setEditing(null)} folders={folderList} categories={categories} onSaved={refresh} />
      <PreviewDialog file={preview} onClose={() => setPreview(null)} />
      <BulkDialog mode={bulk} onClose={() => setBulk(null)} folders={folderList} onApply={(p) => bulkApply(bulk!, p)} />
    </div>
  );
}

function groupLabel(by: string, key: string, catLabel: (c: string) => string, folders: Folder[]) {
  if (key === 'none') return by === 'category' ? 'Uncategorised' : by === 'folder' ? 'Unfiled' : 'None';
  if (by === 'type') return TYPE_META[key]?.label ?? key;
  if (by === 'source') return SOURCE_LABEL[key] ?? key;
  if (by === 'category') return catLabel(key);
  if (by === 'folder') return folders.find((f) => f.id === key)?.name ?? key;
  if (by === 'month') return new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return key;
}

function GroupSection({ by, group, filters, label, render }: { by: string; group: Group; filters: Record<string, string | undefined>; label: string; render: (rows: FileRow[], loading: boolean) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const extra: Record<string, string | undefined> = {};
  if (by === 'type') extra.type = group.key;
  if (by === 'source') extra.source = group.key;
  if (by === 'category' && group.key !== 'none') extra.categoryCode = group.key;
  if (by === 'month') {
    const [y, m] = group.key.split('-').map(Number);
    extra.from = `${group.key}-01`;
    extra.to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  const q = useQuery({ queryKey: ['files', 'group-list', by, group.key, filters], queryFn: () => api.get<Paged<FileRow>>('/files', { ...filters, ...extra, pageSize: 100 }), enabled: open });
  const rows = by === 'category' && group.key === 'none' ? (q.data?.data ?? []).filter((f) => !f.categoryCode) : (q.data?.data ?? []);
  const meta = by === 'type' ? TYPE_META[group.key] : undefined;
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <Icon name={open ? 'chevron-down' : 'chevron-right'} className="h-4 w-4 text-slate-400" />
        {meta ? (
          <span style={{ color: meta.color }}>
            <Icon name={meta.icon} className="h-5 w-5" />
          </span>
        ) : (
          <Icon name="folder" className="h-5 w-5 text-slate-400" />
        )}
        <span className="flex-1 font-medium">{label}</span>
        <Badge>{group.files} files</Badge>
        <span className="hidden w-20 text-right text-xs text-slate-400 sm:block">{fmtBytes(group.size)}</span>
      </button>
      {open && <div className="border-t border-slate-100 dark:border-slate-800">{render(rows, q.isFetching)}</div>}
    </div>
  );
}
