import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';

/**
 * List state (page, size, search, sort, filters) kept in the URL so lists are
 * shareable, bookmarkable and survive refresh / back navigation.
 */
export function useListState(defaults: { pageSize?: number; sort?: string; order?: 'asc' | 'desc' } = {}) {
  const [sp, setSp] = useSearchParams();
  const [searchInput, setSearchInput] = useState(sp.get('search') ?? '');
  const page = Number(sp.get('page') ?? 1) || 1;
  const pageSize = Number(sp.get('pageSize') ?? defaults.pageSize ?? 20) || 20;
  const search = sp.get('search') ?? '';
  const sort = sp.get('sort') ?? defaults.sort;
  const order = (sp.get('order') as 'asc' | 'desc') ?? defaults.order ?? 'asc';
  const filters: Record<string, string> = {};
  sp.forEach((v, k) => {
    if (k.startsWith('f.')) filters[k.slice(2)] = v;
  });

  const update = useCallback(
    (patch: Record<string, string | number | null | undefined>, resetPage = true) => {
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined || v === '') n.delete(k);
            else n.set(k, String(v));
          }
          if (resetPage && !('page' in patch)) n.delete('page');
          return n;
        },
        { replace: true },
      );
    },
    [setSp],
  );

  return {
    page,
    pageSize,
    search,
    sort,
    order,
    filters,
    searchInput,
    setSearchInput,
    setPage: (p: number) => update({ page: p }, false),
    setPageSize: (s: number) => update({ pageSize: s }),
    setSearch: (s: string) => update({ search: s }),
    setFilter: (k: string, v: string | null) => update({ [`f.${k}`]: v }),
    clearFilters: () => update(Object.fromEntries(Object.keys(filters).map((k) => [`f.${k}`, null]))),
    toggleSort: (field: string) => update({ sort: field, order: sort === field && order === 'asc' ? 'desc' : 'asc' }),
    params: { page, pageSize, search, sort, order, ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [`f.${k}`, v])) },
  };
}
