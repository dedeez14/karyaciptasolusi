import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AsyncSelect, Input, Select, Switch, Textarea } from '@/components/ui';
import type { FieldDef } from './types';

type LookupMap = Record<string, { value: string; label: string; color: string | null }[]>;

/** Loads lookup lists (cached) for the given categories */
export function useLookups(categories: string[]) {
  const key = [...new Set(categories)].sort().join(',');
  return useQuery({ queryKey: ['lookups', key], queryFn: () => api.get<LookupMap>('/lookups', { categories: key }), enabled: !!key, staleTime: 5 * 60_000 }).data ?? {};
}

const toInputDate = (v: unknown) => (v ? String(v).slice(0, 10) : '');
const toInputDateTime = (v: unknown) => {
  if (!v) return '';
  const d = new Date(String(v));
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** Renders the right input for a metadata field. One component for every form in the app. */
export function FieldInput({ field, value, onChange, invalid, disabled, lookups, initialLabel }: { field: FieldDef; value: any; onChange: (v: any) => void; invalid?: boolean; disabled?: boolean; lookups: LookupMap; initialLabel?: string }) {
  const common = { invalid, disabled, id: `f-${field.name}` };
  switch (field.type) {
    case 'textarea':
      return <Textarea {...common} value={value ?? ''} maxLength={field.max} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />;
    case 'number':
    case 'integer':
    case 'money':
    case 'percent':
      return (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          step={field.type === 'integer' ? 1 : field.type === 'money' ? '0.01' : 'any'}
          min={field.min}
          max={field.max}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value)}
          className="text-right tabular-nums"
        />
      );
    case 'date':
      return <Input {...common} type="date" value={toInputDate(value)} onChange={(e) => onChange(e.target.value)} />;
    case 'datetime':
      return <Input {...common} type="datetime-local" value={toInputDateTime(value)} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : '')} />;
    case 'boolean':
      return <Switch checked={!!value} onChange={onChange} disabled={disabled} />;
    case 'select':
      return <Select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} options={field.options ?? []} placeholder={field.required ? undefined : '—'} />;
    case 'lookup':
      return <Select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} options={lookups[field.lookup!] ?? []} placeholder="—" />;
    case 'relation':
      return <AsyncSelect resource={field.relation!.resource} value={value} onChange={(v) => onChange(v ?? '')} invalid={invalid} disabled={disabled} initialLabel={initialLabel} />;
    case 'color':
      return (
        <div className="flex gap-2">
          <input type="color" className="h-9 w-12 rounded border border-slate-300" value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? value : '#1e40af'} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
          <Input {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} maxLength={20} />
        </div>
      );
    case 'tags':
      return <Input {...common} value={Array.isArray(value) ? value.join(', ') : value ?? ''} onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} placeholder="tag1, tag2" />;
    default:
      return (
        <Input
          {...common}
          type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : field.type === 'phone' ? 'tel' : 'text'}
          value={value ?? ''}
          maxLength={field.max}
          placeholder={field.placeholder}
          autoComplete={field.encrypted ? 'off' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
