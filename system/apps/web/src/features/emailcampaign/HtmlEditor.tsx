import { useRef } from 'react';
import { Icon, Textarea } from '@/components/ui';
import { MERGE_TAGS } from './common';
import { Select } from '@/components/ui';

/** Snippets inserted at the cursor (no rich-text library: the HTML stays visible and is sanitised on save) */
const SNIPPETS: { label: string; icon: string; wrap?: [string, string]; insert?: string }[] = [
  { label: 'Bold', icon: 'bold', wrap: ['<strong>', '</strong>'] },
  { label: 'Italic', icon: 'italic', wrap: ['<em>', '</em>'] },
  { label: 'Heading', icon: 'heading', wrap: ['<h2>', '</h2>'] },
  { label: 'Paragraph', icon: 'pilcrow', wrap: ['<p>', '</p>'] },
  { label: 'Link', icon: 'link', wrap: ['<a href="https://">', '</a>'] },
  { label: 'Button', icon: 'square-mouse-pointer', insert: '<p><a href="https://" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none">Button text</a></p>' },
  { label: 'List', icon: 'list', insert: '<ul>\n  <li>First point</li>\n  <li>Second point</li>\n</ul>' },
  { label: 'Image', icon: 'image', insert: '<img src="https://" alt="" width="560" style="max-width:100%;height:auto">' },
];

/** HTML e-mail body with a small toolbar and merge-tag picker */
export function HtmlEditor({ value, onChange, rows = 16, invalid, disabled, label = 'E-mail text' }: { value: string; onChange: (v: string) => void; rows?: number; invalid?: boolean; disabled?: boolean; label?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const apply = (s: { wrap?: [string, string]; insert?: string }) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const piece = s.wrap ? `${s.wrap[0]}${selected || 'text'}${s.wrap[1]}` : s.insert!;
    onChange(value.slice(0, start) + piece + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + piece.length;
      el?.setSelectionRange(pos, pos);
    });
  };
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-slate-50 px-2 py-1.5">
        {SNIPPETS.map((s) => (
          <button key={s.label} type="button" title={s.label} aria-label={s.label} disabled={disabled} onClick={() => apply(s)} className="rounded-md p-1.5 text-slate-600 hover:bg-white hover:text-brand-700 disabled:opacity-40">
            <Icon name={s.icon} className="h-4 w-4" />
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <Select
          aria-label="Insert merge tag"
          className="h-7 w-auto border-0 bg-transparent px-2 text-xs text-slate-600 shadow-none"
          value=""
          disabled={disabled}
          placeholder="Insert field…"
          menuWidth={240}
          onChange={(e) => {
            if (e.target.value) apply({ insert: `{{${e.target.value}}}` });
          }}
          options={MERGE_TAGS.map((m) => ({ value: m.tag, label: m.label, hint: `{{${m.tag}}}` }))}
        />
      </div>
      <Textarea ref={ref} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={label} className="rounded-none border-0 font-mono text-xs focus:ring-0" invalid={invalid} />
    </div>
  );
}
