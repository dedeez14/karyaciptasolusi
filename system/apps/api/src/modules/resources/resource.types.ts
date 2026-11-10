export type FieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'url'
  | 'number'
  | 'integer'
  | 'money'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'select'
  | 'lookup'
  | 'relation'
  | 'color'
  | 'tags';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  max?: number;
  min?: number;
  /** show as table column */
  list?: boolean;
  /** offer as filter control */
  filter?: boolean;
  sortable?: boolean;
  /** stored AES-GCM encrypted, masked in lists */
  encrypted?: boolean;
  /** extra permission needed to see / edit the field (e.g. salary) */
  permission?: string;
  /** static options for domain enums only (business lists use `lookup`) */
  options?: { value: string; label: string }[];
  /** LookupValue category */
  lookup?: string;
  relation?: { resource: string };
  default?: unknown;
  /** cannot be changed after creation */
  immutable?: boolean;
  readOnly?: boolean;
  /** form layout: full width */
  wide?: boolean;
  section?: string;
  help?: string;
  placeholder?: string;
}

export interface ResourceDef {
  key: string;
  model: string;
  module: string;
  label: string;
  singular: string;
  icon?: string;
  /** permission prefix -> <prefix>.read / .create / .update / .delete / .export */
  permission: string;
  /** global = shared lookup tables, company = tenant data */
  scope: 'global' | 'company';
  /** column that ties a row to a branch (branch data-scope) */
  branchField?: string;
  /** column used for OWN data-scope (default createdById) */
  ownerField?: string;
  idField?: string;
  fields: FieldDef[];
  searchFields: string[];
  labelFields: string[];
  defaultSort?: { field: string; order: 'asc' | 'desc' };
  softDelete?: boolean;
  /** auto number code field using a number sequence when left empty */
  autoCode?: { field: string; sequence: string };
  /** allowed operations (default all) */
  operations?: ('read' | 'create' | 'update' | 'delete')[];
  /** filter applied when building select options */
  optionsWhere?: Record<string, unknown>;
}
