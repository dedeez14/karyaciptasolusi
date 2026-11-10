import { useState } from 'react';
import { Button, Icon, Input, Select } from '@/components/ui';

export interface LogFilterValue {
  search?: string;
  entity?: string;
  action?: string;
  from?: string;
  to?: string;
}

/** Shared filter bar for audit trail & activity log */
export function LogFilters({ value, onChange, entities, actionPlaceholder = 'Action' }: { value: LogFilterValue; onChange: (v: LogFilterValue) => void; entities?: string[]; actionPlaceholder?: string }) {
  const [search, setSearch] = useState(value.search ?? '');
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-6 dark:border-slate-800">
      <form
        className="relative lg:col-span-2"
        onSubmit={(e) => {
          e.preventDefault();
          onChange({ ...value, search });
        }}
      >
        <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
        <Input className="pl-9" placeholder="Search user, path, IP..." value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => onChange({ ...value, search })} />
      </form>
      {entities ? (
        <Select value={value.entity ?? ''} onChange={(e) => onChange({ ...value, entity: e.target.value })} placeholder="All entities" options={entities.map((e) => ({ value: e, label: e }))} />
      ) : null}
      <Input placeholder={actionPlaceholder} value={value.action ?? ''} onChange={(e) => onChange({ ...value, action: e.target.value })} />
      <Input type="date" value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="From" />
      <div className="flex gap-2">
        <Input type="date" value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="To" />
        <Button
          variant="ghost"
          size="icon"
          icon="x"
          onClick={() => {
            setSearch('');
            onChange({});
          }}
          aria-label="Clear filters"
        />
      </div>
    </div>
  );
}
