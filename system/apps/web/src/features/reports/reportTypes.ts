import { monthStart, yearStart, isoDate } from '@/lib/format';

export interface ReportParam {
  name: string;
  label: string;
  type: 'date' | 'select' | 'relation';
  required?: boolean;
  default?: string;
  options?: { value: string; label: string }[];
  relation?: string;
}

export interface ReportMeta {
  key: string;
  label: string;
  module: string;
  description: string;
  params: ReportParam[];
}

export interface ReportColumn {
  key: string;
  label: string;
  type?: string;
}

export interface ReportResult {
  report: ReportMeta;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
  subtitle?: string;
  chart?: { type: 'bar' | 'pie' | 'line'; label: string; value: string };
}

export const MODULES: Record<string, { label: string; icon: string; color: string }> = {
  sales: { label: 'Sales', icon: 'shopping-cart', color: '#1d4f7a' },
  purchase: { label: 'Purchase', icon: 'shopping-bag', color: '#f8b810' },
  inventory: { label: 'Inventory', icon: 'boxes', color: '#10b981' },
  accounting: { label: 'Accounting', icon: 'calculator', color: '#8b5cf6' },
  crm: { label: 'Marketing & CRM', icon: 'megaphone', color: '#ef4444' },
  hris: { label: 'HRIS', icon: 'id-card', color: '#06b6d4' },
};

export const CHART_COLORS = ['#1d4f7a', '#f8b810', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b'];

export function defaultValue(d?: string): string {
  if (d === 'monthStart') return monthStart();
  if (d === 'yearStart') return yearStart();
  if (d === 'today') return isoDate();
  return d ?? '';
}
