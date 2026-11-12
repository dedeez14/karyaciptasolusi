import { AsyncSelect, DatePicker, Input, LookupSelect, NumberInput, Select, Switch, Textarea } from '@/components/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useLookups, type LookupMap } from '@/hooks/useLookups';
import type { FieldDef } from './types';

/** kept for existing imports: lookup lists (cached) for the given categories */
export { useLookups };

/** integer fields that are positions, years or digit counts rather than quantities */
const UNGROUPED = /(sortOrder|order|year|padding|decimals|digits|nextNumber)$/i;

const toInputDate = (v: unknown) => (v ? String(v).slice(0, 10) : '');
const localParts = (v: unknown) => {
  if (!v) return { date: '', time: '' };
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
};

/** master-data pages the current user may open (cached) -> "Manage list" links in relation dropdowns */
function useReadableResources() {
  return useQuery({ queryKey: ['meta', 'resources'], queryFn: () => api.get<{ key: string; label: string }[]>('/meta/resources'), staleTime: 10 * 60_000 }).data;
}

/** Renders the right input for a metadata field. One component for every form in the app. */
export function FieldInput({ field, value, onChange, invalid, disabled, initialLabel }: { field: FieldDef; value: any; onChange: (v: any) => void; invalid?: boolean; disabled?: boolean; lookups?: LookupMap; initialLabel?: string }) {
  const readable = useReadableResources();
  const target = field.relation ? readable?.find((r) => r.key === field.relation!.resource) : undefined;
  const common = { invalid, disabled, id: `f-${field.name}` };
  switch (field.type) {
    case 'textarea':
      return <Textarea {...common} value={value ?? ''} maxLength={field.max} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />;
    case 'number':
    case 'integer':
    case 'money':
    case 'percent':
      return (
        <NumberInput
          {...common}
          value={value}
          onChange={onChange}
          // money: 2 decimals shown, integer: none; percent and plain numbers up to the stored precision
          decimals={field.type === 'integer' ? 0 : field.type === 'money' ? 2 : field.type === 'percent' ? 2 : 4}
          fixed={field.type === 'money' ? 2 : undefined}
          // codes, orders and digit counts read better without thousand separators
          grouping={!(field.type === 'integer' && UNGROUPED.test(field.name))}
          allowNegative={field.min === undefined || field.min < 0}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
        />
      );
    case 'date':
      return <DatePicker id={common.id} invalid={invalid} disabled={disabled} value={toInputDate(value)} onChange={onChange} />;
    case 'datetime': {
      const p = localParts(value);
      const emit = (date: string, time: string) => onChange(date ? new Date(`${date}T${time || '00:00'}`).toISOString() : '');
      return (
        <div className="flex gap-2">
          <DatePicker id={common.id} className="flex-1" invalid={invalid} disabled={disabled} value={p.date} onChange={(d) => emit(d, p.time)} />
          <Input type="time" aria-label={`${field.label} time`} className="w-28" invalid={invalid} disabled={disabled || !p.date} value={p.time} onChange={(e) => emit(p.date, e.target.value)} />
        </div>
      );
    }
    case 'boolean':
      return <Switch checked={!!value} onChange={onChange} disabled={disabled} />;
    case 'select':
      return <Select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} options={field.options ?? []} placeholder={field.required ? undefined : '—'} />;
    case 'lookup':
      return <LookupSelect id={common.id} category={field.lookup!} value={value ?? ''} onChange={onChange} invalid={invalid} disabled={disabled} clearable={!field.required} />;
    case 'relation':
      return (
        <AsyncSelect
          resource={field.relation!.resource}
          value={value}
          onChange={(v) => onChange(v ?? '')}
          invalid={invalid}
          disabled={disabled}
          initialLabel={initialLabel}
          manageHref={target ? `/r/${target.key}` : undefined}
          manageLabel={target ? `Manage ${target.label.toLowerCase()}` : undefined}
        />
      );
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
