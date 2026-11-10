import type { ComponentType, ReactNode } from 'react';
import type { FieldDef, ResourceMeta, Row } from '../types';

/** Props given to an alternative list view (cards, board, tree, calendar...). */
export interface ResourceViewProps {
  meta: ResourceMeta;
  rows: Row[];
  loading: boolean;
  /** current list params (search, filters, sort) */
  params: Record<string, unknown>;
  /** open a record: its detail page when one exists, otherwise the edit form */
  open: (r: Row) => void;
  /** open the edit form (null = new) */
  edit: (id: string | null) => void;
  /** formats a field value exactly like the table does */
  renderValue: (f: FieldDef, r: Row) => ReactNode;
  field: (name: string) => FieldDef | undefined;
  refresh: () => void;
}

export interface ResourceView {
  id: string;
  label: string;
  icon: string;
  component: ComponentType<ResourceViewProps>;
  /** rows to load for this view (views without paging), default 200 */
  pageSize?: number;
  /** the view loads its own data (tree, calendar...): no empty state / "showing x of y" from the list */
  selfLoading?: boolean;
}

/** Purpose-built UI for one resource key. Everything is optional; the generic table stays available. */
export interface ResourceUi {
  /** alternative views offered next to the table (the first one becomes the default view) */
  views?: ResourceView[];
  /** keep the table as the default view even when views exist */
  tableFirst?: boolean;
  /** dedicated detail page of one record */
  detailPath?: (r: Row) => string;
  /** KPI / summary strip rendered above the list */
  header?: ComponentType<{ meta: ResourceMeta }>;
  /** replace the whole page; `List` renders the generic list (e.g. as a secondary tab) */
  page?: ComponentType<{ meta: ResourceMeta; List: ComponentType<{ meta: ResourceMeta; embedded?: boolean }> }>;
}
