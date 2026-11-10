import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '@/lib/api';
import { useLookupOptions } from '@/hooks/useLookups';
import { AsyncSelect, Badge, cn, DatePicker, Field, Icon, Input, LookupSelect, NumberInput, Spinner, Textarea } from '@/components/ui';

// ------------------------------------------------------------------ types

export type AudienceSource = 'LEADS' | 'CUSTOMERS' | 'MAP_PLACES' | 'MANUAL';
export interface Audience {
  source: AudienceSource;
  statusCodes?: string[];
  sourceCodes?: string[];
  industryCodes?: string[];
  campaignId?: string | null;
  createdFrom?: string;
  createdTo?: string;
  groupId?: string | null;
  jobId?: string | null;
  category?: string;
  minRating?: number | string;
  list?: string;
}

export interface CampaignCounters {
  totalCount: number;
  sentCount: number;
  failedCount: number;
  openCount: number;
  unsubscribeCount: number;
}

export interface CampaignRow extends CampaignCounters {
  id: string;
  code: string;
  name: string;
  subject: string;
  statusCode: string;
  automatic: boolean;
  trackOpens: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  audienceSource: AudienceSource | null;
  createdAt: string;
}

export interface CampaignDetail extends CampaignCounters {
  id: string;
  code: string;
  name: string;
  subject: string;
  body: string;
  fromName: string | null;
  replyTo: string | null;
  campaignId: string | null;
  linkedCampaign: { id: string; code: string; name: string } | null;
  audience: Audience;
  automatic: boolean;
  trackOpens: boolean;
  ratePerMinute: number;
  statusCode: string;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  counts: Record<string, number>;
  pausedReason: string | null;
  smtpReady: boolean;
  can: { edit: boolean; editAudience: boolean; schedule: boolean; sendNow: boolean; pause: boolean; resume: boolean; cancel: boolean; test: boolean; delete: boolean };
  createdAt: string;
}

export interface Defaults {
  fromName: string;
  replyTo: string;
  footerAddress: string;
  trackOpens: boolean;
  smtpReady: boolean;
  ratePerMinute: number;
  dailyLimit: number;
  sentToday: number;
}

export interface AudiencePreview {
  found: number;
  invalid: number;
  duplicates: number;
  suppressed: number;
  valid: number;
  sample: { email: string; name: string | null; company: string | null; city: string | null; entityType: string }[];
}

export const MERGE_TAGS: { tag: string; label: string }[] = [
  { tag: 'name', label: 'Contact name' },
  { tag: 'company', label: 'Company' },
  { tag: 'email', label: 'E-mail' },
  { tag: 'city', label: 'City' },
  { tag: 'sender', label: 'Sender name' },
  { tag: 'unsubscribe_url', label: 'Unsubscribe link' },
];

export const SAMPLE = { name: 'Budi Santoso', company: 'PT Contoh Usaha', email: 'budi@example.com', city: 'Bandung' };

// ------------------------------------------------------------------ small pieces

export function useStatusLookup(category: string) {
  const opts = useLookupOptions(category);
  return (code: string | null | undefined) => opts.find((o) => o.value === code);
}

export function StatusBadge({ category, code }: { category: string; code: string | null | undefined }) {
  const find = useStatusLookup(category);
  if (!code) return <span className="text-slate-300">—</span>;
  const o = find(code);
  return (
    <Badge color={o?.color} dot>
      {o?.label ?? code}
    </Badge>
  );
}

export function SmtpWarning({ ready }: { ready: boolean | undefined }) {
  if (ready !== false) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <Icon name="triangle-alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">E-mail is not configured yet</p>
        <p className="text-amber-800">
          Campaigns cannot be sent until the SMTP server is set.{' '}
          <Link to="/system/settings" className="font-medium underline">
            Open System Settings
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

/** Toggle chips for several values of one lookup list */
export function CodeChips({ category, value, onChange, exclude = [] }: { category: string; value: string[]; onChange: (v: string[]) => void; exclude?: string[] }) {
  const options = useLookupOptions(category).filter((o) => !exclude.includes(o.value));
  if (!options.length) return <p className="text-xs text-slate-400">No values</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition', on ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line bg-white text-slate-600 hover:bg-slate-50')}
          >
            {o.color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: o.color }} />}
            {o.label}
            {on && <Icon name="check" className="h-3 w-3" />}
          </button>
        );
      })}
    </div>
  );
}

function useDebounced<T>(value: T, ms = 500) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Normalises the audience for the API (only the fields of the chosen source) */
export function cleanAudience(a: Audience): Audience {
  switch (a.source) {
    case 'LEADS':
      return { source: 'LEADS', statusCodes: a.statusCodes ?? [], sourceCodes: a.sourceCodes ?? [], industryCodes: a.industryCodes ?? [], campaignId: a.campaignId || undefined, createdFrom: a.createdFrom || undefined, createdTo: a.createdTo || undefined };
    case 'CUSTOMERS':
      return { source: 'CUSTOMERS', groupId: a.groupId || undefined, industryCodes: a.industryCodes ?? [] };
    case 'MAP_PLACES':
      return { source: 'MAP_PLACES', jobId: a.jobId || undefined, category: a.category?.trim() || undefined, minRating: a.minRating === '' || a.minRating === undefined ? undefined : Number(a.minRating), statusCodes: a.statusCodes ?? [] };
    default:
      return { source: 'MANUAL', list: a.list ?? '' };
  }
}

interface MapJob {
  id: string;
  code: string;
  name: string;
  statusCode: string;
  resultCount: number;
  withEmail: number;
}

/** Audience builder with a live count of valid recipients */
export function AudienceBuilder({ value, onChange, disabled, automatic }: { value: Audience; onChange: (a: Audience) => void; disabled?: boolean; automatic?: boolean }) {
  const set = (patch: Partial<Audience>) => onChange({ ...value, ...patch });
  const debounced = useDebounced(cleanAudience(value), 600);
  const preview = useQuery({
    queryKey: ['email-audience', debounced],
    queryFn: () => api.post<AudiencePreview>('/email-campaigns/audience/preview', { audience: debounced }),
    retry: false,
  });
  const jobs = useQuery({ queryKey: ['email-map-jobs'], queryFn: () => api.get<MapJob[]>('/email-campaigns/map-jobs'), enabled: value.source === 'MAP_PLACES', staleTime: 60_000 });
  const p = preview.data;

  return (
    <div className={cn('space-y-4', disabled && 'pointer-events-none opacity-60')}>
      <Field label="Send to" required help={disabled ? 'The audience is fixed once sending started' : undefined}>
        <LookupSelect category="EMAIL_AUDIENCE" value={value.source} onChange={(v) => v && onChange({ source: v as AudienceSource })} clearable={false} />
      </Field>

      {value.source === 'LEADS' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lead status" help="None selected = every status" className="sm:col-span-2">
            <CodeChips category="LEAD_STATUS" value={value.statusCodes ?? []} onChange={(v) => set({ statusCodes: v })} />
          </Field>
          <Field label="Lead source" help="e.g. Google Maps for leads from the Lead Finder" className="sm:col-span-2">
            <CodeChips category="LEAD_SOURCE" value={value.sourceCodes ?? []} onChange={(v) => set({ sourceCodes: v })} />
          </Field>
          <Field label="Industry" className="sm:col-span-2">
            <CodeChips category="INDUSTRY" value={value.industryCodes ?? []} onChange={(v) => set({ industryCodes: v })} />
          </Field>
          <Field label="Marketing campaign">
            <AsyncSelect resource="campaigns" value={value.campaignId ?? null} onChange={(v) => set({ campaignId: v })} placeholder="Any campaign" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Created from">
              <DatePicker value={value.createdFrom ?? ''} onChange={(v) => set({ createdFrom: v })} />
            </Field>
            <Field label="Created until">
              <DatePicker value={value.createdTo ?? ''} onChange={(v) => set({ createdTo: v })} />
            </Field>
          </div>
        </div>
      )}

      {value.source === 'CUSTOMERS' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer group">
            <AsyncSelect resource="customer-groups" value={value.groupId ?? null} onChange={(v) => set({ groupId: v })} placeholder="All groups" />
          </Field>
          <Field label="Industry" className="sm:col-span-2">
            <CodeChips category="INDUSTRY" value={value.industryCodes ?? []} onChange={(v) => set({ industryCodes: v })} />
          </Field>
        </div>
      )}

      {value.source === 'MAP_PLACES' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lead Finder search" help="Only places where an e-mail address was found">
            <select className="input" value={value.jobId ?? ''} onChange={(e) => set({ jobId: e.target.value || null })}>
              <option value="">All searches</option>
              {(jobs.data ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} · {j.name} ({j.withEmail} with e-mail)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category contains">
            <Input value={value.category ?? ''} onChange={(e) => set({ category: e.target.value })} placeholder="e.g. konveksi" />
          </Field>
          <Field label="Minimum rating">
            <NumberInput value={value.minRating ?? ''} onChange={(v) => set({ minRating: v })} decimals={1} placeholder="Any" />
          </Field>
          <Field label="Place status" help="Ignored places are never e-mailed">
            <CodeChips category="MAP_PLACE_STATUS" value={value.statusCodes ?? []} onChange={(v) => set({ statusCodes: v })} exclude={['IGNORED']} />
          </Field>
        </div>
      )}

      {value.source === 'MANUAL' && (
        <Field label="E-mail addresses" help="One per line: e-mail, name (the name is optional)">
          <Textarea rows={8} value={value.list ?? ''} onChange={(e) => set({ list: e.target.value })} placeholder={'budi@example.com, Budi Santoso\nsales@example.org'} className="font-mono text-xs" />
        </Field>
      )}

      <div className="rounded-xl border border-line bg-slate-50/70 p-4">
        <div className="flex items-center gap-2">
          <Icon name="users" className="h-4 w-4 text-brand-600" />
          <p className="text-sm font-semibold text-slate-800">
            {preview.isFetching && !p ? 'Counting…' : p ? `${p.valid.toLocaleString()} recipient${p.valid === 1 ? '' : 's'}` : '—'}
          </p>
          {preview.isFetching && <Spinner className="h-3.5 w-3.5 text-slate-400" />}
        </div>
        {preview.error && <p className="mt-1 text-xs text-red-600">{(preview.error as Error).message}</p>}
        {p && (
          <>
            <p className="mt-1 text-xs text-slate-500">
              {p.found.toLocaleString()} found · {p.invalid} without a valid address · {p.duplicates} duplicate{p.duplicates === 1 ? '' : 's'} · {p.suppressed} on the do-not-email list
            </p>
            {automatic && <p className="mt-1 text-xs text-slate-500">Automatic: contacts that match later are e-mailed as they appear.</p>}
            {p.sample.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                {p.sample.slice(0, 5).map((s) => (
                  <li key={s.email} className="flex min-w-0 gap-2">
                    <span className="truncate font-mono">{s.email}</span>
                    {(s.name || s.company) && <span className="truncate text-slate-400">· {[s.name, s.company].filter(Boolean).join(', ')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Client-side preview (rendered in a sandboxed iframe; the server sanitises again when saving) */
export function previewHtml(body: string, opts: { sender: string; footerAddress: string; data?: Partial<typeof SAMPLE> }) {
  const data = { ...SAMPLE, ...opts.data, sender: opts.sender, unsubscribe_url: '#unsubscribe' } as Record<string, string>;
  const merged = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => esc(data[k.toLowerCase()] ?? ''));
  return (
    `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:0;background:#fff">` +
    `<div style="max-width:640px;margin:0 auto;padding:24px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1e293b">${merged}` +
    `<hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 12px"><p style="font-size:12px;line-height:1.5;color:#64748b;margin:0">${esc(opts.sender)}` +
    `${opts.footerAddress ? `<br>${esc(opts.footerAddress).replace(/\n/g, '<br>')}` : ''}<br>You receive this e-mail because your contact details were listed for business enquiries. <a href="#unsubscribe" style="color:#64748b">Unsubscribe</a> to stop receiving these e-mails.</p></div></body></html>`
  );
}

export function EmailFrame({ html, className }: { html: string; className?: string }) {
  // no allow-scripts, no allow-same-origin: the preview can never run code or reach the app
  return <iframe title="E-mail preview" sandbox="" srcDoc={html} className={cn('h-[520px] w-full rounded-xl border border-line bg-white', className)} />;
}
