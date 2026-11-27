import { useQuery } from '@tanstack/react-query';
import { humanize } from '@/lib/format';
import { api } from '@/lib/api';

export interface LookupOption {
  value: string;
  label: string;
  color: string | null;
}
export type LookupMap = Record<string, LookupOption[]>;

/** Master-data lists (Lookup Values) by category, cached for 5 minutes. */
export function useLookups(categories: string[]): LookupMap {
  const key = [...new Set(categories.filter(Boolean))].sort().join(',');
  return useQuery({ queryKey: ['lookups', key], queryFn: () => api.get<LookupMap>('/lookups', { categories: key }), enabled: !!key, staleTime: 5 * 60_000 }).data ?? {};
}

/** Options of one lookup category, e.g. useLookupOptions('DOC_STATUS') */
export function useLookupOptions(category: string): LookupOption[] {
  return useLookups([category])[category] ?? [];
}

/** label for a code of a category (falls back to the code) */
export function useLookupLabel(category: string) {
  const opts = useLookupOptions(category);
  return (code: string | null | undefined) => (code ? opts.find((o) => o.value === code)?.label ?? humanize(code) : '');
}
