export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'email' | 'phone' | 'url' | 'number' | 'integer' | 'money' | 'percent' | 'date' | 'datetime' | 'boolean' | 'select' | 'lookup' | 'relation' | 'color' | 'tags';
  required?: boolean;
  max?: number;
  min?: number;
  list?: boolean;
  filter?: boolean;
  sortable?: boolean;
  encrypted?: boolean;
  options?: { value: string; label: string }[];
  lookup?: string;
  relation?: { resource: string };
  default?: unknown;
  immutable?: boolean;
  readOnly?: boolean;
  wide?: boolean;
  section?: string;
  help?: string;
  placeholder?: string;
}

export interface ResourceMeta {
  key: string;
  label: string;
  singular: string;
  module: string;
  idField: string;
  fields: FieldDef[];
  defaultSort?: { field: string; order: 'asc' | 'desc' };
  autoCode: string | null;
  can: { read: boolean; create: boolean; update: boolean; delete: boolean; export: boolean };
}

export type Row = Record<string, any> & { _labels?: Record<string, string> };
