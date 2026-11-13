import { Link } from 'react-router';
import { Badge, Button, cn, Icon } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import type { ResourceMeta, Row } from '../types';
import type { ResourceUi, ResourceViewProps } from './types';

const SITE = 'https://karyaciptasolusi.com';

/** website sections in the order they appear on the home page */
const SECTIONS: { value: string; label: string; icon: string; hint: string }[] = [
  { value: 'STAT', label: 'Statistics', icon: 'bar-chart-3', hint: 'Numbers under the hero, e.g. 30+ projects' },
  { value: 'CLIENT', label: 'Client logos', icon: 'handshake', hint: '"Trusted by" logo strip' },
  { value: 'PORTFOLIO', label: 'Portfolio', icon: 'briefcase', hint: 'Projects with a link to the live site' },
  { value: 'SERVICE', label: 'Services', icon: 'layers', hint: 'What the company offers' },
  { value: 'REASON', label: 'Why choose us', icon: 'badge-check', hint: 'Reasons to work with the company' },
  { value: 'TESTIMONIAL', label: 'Testimonials', icon: 'quote', hint: 'Only real quotes from real clients' },
  { value: 'STEP', label: 'Consultation steps', icon: 'list-ordered', hint: 'How a project starts' },
  { value: 'FAQ', label: 'FAQ', icon: 'circle-help', hint: 'Questions and answers' },
  { value: 'JOB', label: 'Job openings', icon: 'user-plus', hint: 'The career section shows only when there is at least one' },
];

function WebsiteHeader(_: { meta: ResourceMeta }) {
  return (
    <div className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Icon name="globe" className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900">karyaciptasolusi.com</p>
        <p className="text-xs text-slate-500">Published blocks appear on the website within a few minutes. Empty sections keep the website's built-in content.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="/system/settings?tab=website">
          <Button variant="outline" size="sm" icon="settings-2">
            Texts & contact
          </Button>
        </Link>
        <Link to="/r/leads?f.sourceCode=WEBSITE">
          <Button variant="outline" size="sm" icon="inbox">
            Enquiries
          </Button>
        </Link>
        <a href={SITE} target="_blank" rel="noopener noreferrer">
          <Button variant="secondary" size="sm" icon="external-link">
            Open website
          </Button>
        </a>
      </div>
    </div>
  );
}

/** Blocks grouped per website section, in page order */
function WebsiteSectionsView({ rows, open, edit }: ResourceViewProps) {
  const known = new Set(SECTIONS.map((s) => s.value));
  const groups = [...SECTIONS, ...[...new Set(rows.map((r) => String(r.section)))].filter((v) => !known.has(v)).map((v) => ({ value: v, label: v, icon: 'square', hint: '' }))];
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const list = rows.filter((r) => r.section === g.value).sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
        const live = list.filter((r) => r.isPublished).length;
        return (
          <section key={g.value} className="card overflow-hidden">
            <header className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <Icon name={g.icon} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{g.label}</h3>
                <p className="truncate text-xs text-slate-500">{g.hint}</p>
              </div>
              <Badge tone={live ? 'green' : 'gray'}>{list.length ? `${live} of ${list.length} published` : 'Website default'}</Badge>
            </header>
            {list.length ? (
              <ul className="divide-y divide-line">
                {list.map((r) => (
                  <li key={String(r.id)}>
                    <button type="button" onClick={() => open(r)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
                      <span className="w-8 shrink-0 text-right text-xs text-slate-400 tabular-nums">{String(r.sortOrder ?? '')}</span>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700">
                        <Icon name={(r.icon as string) || g.icon} className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-sm font-medium', r.isPublished ? 'text-slate-900' : 'text-slate-400 line-through')}>{String(r.title ?? '')}</span>
                        {(r.subtitle || r.body) && <span className="block truncate text-xs text-slate-500">{String(r.subtitle || r.body)}</span>}
                      </span>
                      {r.value ? <span className="shrink-0 text-xs font-medium text-slate-600">{String(r.value)}</span> : null}
                      {!r.isPublished && <Badge>Hidden</Badge>}
                      <Icon name="chevron-right" className="h-4 w-4 shrink-0 text-slate-300" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-slate-500">
                <span>No blocks yet: the website shows its built-in content here.</span>
                <Button variant="ghost" size="sm" icon="plus" onClick={() => edit(null)}>
                  Add
                </Button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ announcements

const TONE: Record<string, { bar: string; label: string }> = {
  INFO: { bar: 'bg-brand-600 text-white', label: 'Information' },
  SUCCESS: { bar: 'bg-emerald-600 text-white', label: 'Good news' },
  WARNING: { bar: 'bg-accent-400 text-brand-950', label: 'Attention' },
  URGENT: { bar: 'bg-red-600 text-white', label: 'Urgent' },
};

function state(r: Row): { label: string; tone: 'green' | 'blue' | 'gray' } {
  const now = Date.now();
  if (!r.isActive) return { label: 'Off', tone: 'gray' };
  if (r.startsAt && new Date(String(r.startsAt)).getTime() > now) return { label: 'Scheduled', tone: 'blue' };
  if (r.endsAt && new Date(String(r.endsAt)).getTime() < now) return { label: 'Ended', tone: 'gray' };
  return { label: 'Running now', tone: 'green' };
}

/** Each announcement as it looks in the bar, with its schedule and whether it is showing now */
function AnnouncementCardsView({ rows, open }: ResourceViewProps) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {rows.map((r) => {
        const t = TONE[String(r.tone)] ?? TONE.INFO;
        const s = state(r);
        return (
          <button key={String(r.id)} type="button" onClick={() => open(r)} className="card overflow-hidden text-left transition-shadow hover:shadow-pop">
            <div className={cn('flex items-center gap-2 px-4 py-2 text-[13px] font-medium', t.bar, s.label !== 'Running now' && 'opacity-60')}>
              <Icon name="megaphone" className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{String(r.message ?? '')}</span>
              {r.linkUrl ? <Icon name="arrow-up-right" className="h-3.5 w-3.5 shrink-0" /> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-slate-500">
              <Badge tone={s.tone}>{s.label}</Badge>
              <span>{t.label}</span>
              <span className="text-slate-300">·</span>
              <span>
                {r.startsAt ? fmtDateTime(r.startsAt) : 'Now'} – {r.endsAt ? fmtDateTime(r.endsAt) : 'until switched off'}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export const websiteUi: Record<string, ResourceUi> = {
  'web-contents': { views: [{ id: 'sections', label: 'By section', icon: 'layout-template', component: WebsiteSectionsView, pageSize: 200 }], header: WebsiteHeader },
  announcements: { views: [{ id: 'preview', label: 'Preview', icon: 'megaphone', component: AnnouncementCardsView }] },
};
