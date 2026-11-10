import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { AsyncSelect, Button, Card, Field, Icon, Input, NumberInput, PageHeader, Spinner, Switch, Textarea, toast } from '@/components/ui';
import { AudienceBuilder, cleanAudience, EmailFrame, MERGE_TAGS, previewHtml, SmtpWarning, type Audience, type CampaignDetail, type Defaults } from './common';

interface FormState {
  name: string;
  subject: string;
  body: string;
  fromName: string;
  replyTo: string;
  campaignId: string | null;
  audience: Audience;
  automatic: boolean;
  ratePerMinute: string;
  trackOpens: boolean;
}

const STARTER = `<p>Halo {{name}},</p>
<p>Kami dari <strong>{{sender}}</strong> membantu bisnis seperti <strong>{{company}}</strong> di {{city}} merapikan penjualan, stok dan laporan keuangan dalam satu aplikasi.</p>
<p>Boleh kami jadwalkan demo singkat 20 menit minggu ini?</p>
<p><a href="https://karyaciptasolusi.com" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none">Lihat layanan kami</a></p>
<p>Salam,<br>{{sender}}</p>`;

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

export default function CampaignFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const defaults = useQuery({ queryKey: ['email-defaults'], queryFn: () => api.get<Defaults>('/email-campaigns/defaults') });
  const existing = useQuery({ queryKey: ['email-campaign', id], queryFn: () => api.get<CampaignDetail>(`/email-campaigns/${id}`), enabled: isEdit });
  const [f, setF] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (f) return;
    if (isEdit && existing.data) {
      const c = existing.data;
      setF({ name: c.name, subject: c.subject, body: c.body, fromName: c.fromName ?? '', replyTo: c.replyTo ?? '', campaignId: c.campaignId, audience: c.audience, automatic: c.automatic, ratePerMinute: String(c.ratePerMinute), trackOpens: c.trackOpens });
    } else if (!isEdit && defaults.data) {
      setF({ name: '', subject: 'Solusi aplikasi bisnis untuk {{company}}', body: STARTER, fromName: '', replyTo: '', campaignId: null, audience: { source: 'LEADS', sourceCodes: ['GOOGLE_MAPS'], statusCodes: ['NEW'] }, automatic: false, ratePerMinute: String(defaults.data.ratePerMinute), trackOpens: defaults.data.trackOpens });
    }
  }, [isEdit, existing.data, defaults.data, f]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => {
      const body = { ...f!, ratePerMinute: Number(f!.ratePerMinute) || 1, audience: cleanAudience(f!.audience) };
      return isEdit ? api.patch<{ id: string }>(`/email-campaigns/${id}`, body) : api.post<{ id: string }>('/email-campaigns', body);
    },
    onSuccess: (r) => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['email-campaigns'] });
      qc.invalidateQueries({ queryKey: ['email-campaign'] });
      toast.success(isEdit ? 'Campaign saved' : 'Campaign created as draft');
      navigate(`/crm/email-campaigns/${r.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });

  if (!f || (isEdit && existing.isLoading))
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  const locked = isEdit && existing.data && !existing.data.can.edit;
  const audienceLocked = isEdit && existing.data && !existing.data.can.editAudience;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setDirty(true);
    setF((s) => ({ ...s!, [k]: v }));
  };

  const applySnippet = (s: (typeof SNIPPETS)[number] | { insert: string; wrap?: undefined }) => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? f.body.length;
    const end = el?.selectionEnd ?? f.body.length;
    const selected = f.body.slice(start, end);
    const piece = s.wrap ? `${s.wrap[0]}${selected || 'text'}${s.wrap[1]}` : s.insert!;
    const next = f.body.slice(0, start) + piece + f.body.slice(end);
    set('body', next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + piece.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    save.mutate();
  };
  const sender = f.fromName || defaults.data?.fromName || '';

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        title={isEdit ? `Edit ${existing.data?.code ?? ''}` : 'New e-mail campaign'}
        subtitle="Write the e-mail, choose who receives it, then send now, schedule it or keep it running automatically."
        back={() => navigate(-1)}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" icon="save" loading={save.isPending} disabled={!!locked}>
              Save
            </Button>
          </>
        }
      />
      <div className="space-y-4">
        <SmtpWarning ready={defaults.data?.smtpReady} />
        {locked && <p className="rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm text-slate-600">This campaign is {existing.data?.statusCode.toLowerCase()} and can no longer be edited.</p>}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <Card title="Details">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Campaign name" required error={errors.name} className="sm:col-span-2" help="Internal name, not shown to recipients">
                  <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Penawaran ERP - konveksi Bandung" invalid={!!errors.name} />
                </Field>
                <Field label="Sender name" help={`Empty = ${defaults.data?.fromName ?? 'company name'}`}>
                  <Input value={f.fromName} onChange={(e) => set('fromName', e.target.value)} />
                </Field>
                <Field label="Reply-to address" error={errors.replyTo} help={defaults.data?.replyTo ? `Empty = ${defaults.data.replyTo}` : 'Where replies go'}>
                  <Input type="email" value={f.replyTo} onChange={(e) => set('replyTo', e.target.value)} invalid={!!errors.replyTo} />
                </Field>
                <Field label="Marketing campaign" help="Optional, for reporting">
                  <AsyncSelect resource="campaigns" value={f.campaignId} onChange={(v) => set('campaignId', v)} placeholder="None" />
                </Field>
                <Field label="E-mails per minute" error={errors.ratePerMinute} help={`Never more than ${defaults.data?.ratePerMinute ?? 20}/min and ${defaults.data?.dailyLimit ?? 300}/day (System Settings)`}>
                  <NumberInput value={f.ratePerMinute} onChange={(v) => set('ratePerMinute', v)} decimals={0} />
                </Field>
                <div className="space-y-3 sm:col-span-2">
                  <Switch checked={f.automatic} onChange={(v) => set('automatic', v)} disabled={!!(isEdit && existing.data?.startedAt)} label="Automatic (auto blast): keep e-mailing new contacts that match the audience" />
                  <Switch checked={f.trackOpens} onChange={(v) => set('trackOpens', v)} label="Track opens (adds an invisible image; mention it in your privacy notice)" />
                </div>
              </div>
            </Card>

            <Card title="Audience" subtitle="Invalid addresses, duplicates and the do-not-email list are removed automatically">
              <AudienceBuilder value={f.audience} onChange={(a) => set('audience', a)} disabled={!!audienceLocked} automatic={f.automatic} />
            </Card>
          </div>

          <div className="min-w-0 space-y-4">
            <Card title="E-mail">
              <div className="space-y-4">
                <Field label="Subject" required error={errors.subject} help="Merge tags work here too, e.g. {{company}}">
                  <Input value={f.subject} onChange={(e) => set('subject', e.target.value)} invalid={!!errors.subject} />
                </Field>
                <Field label="Message (HTML)" required error={errors.body} help="Scripts, forms and embedded frames are removed when saving. An unsubscribe footer with your address is always added.">
                  <div className="overflow-hidden rounded-xl border border-line">
                    <div className="flex flex-wrap items-center gap-1 border-b border-line bg-slate-50 px-2 py-1.5">
                      {SNIPPETS.map((s) => (
                        <button key={s.label} type="button" title={s.label} aria-label={s.label} onClick={() => applySnippet(s)} className="rounded-md p-1.5 text-slate-600 hover:bg-white hover:text-brand-700">
                          <Icon name={s.icon} className="h-4 w-4" />
                        </button>
                      ))}
                      <span className="mx-1 h-5 w-px bg-line" />
                      <select
                        aria-label="Insert merge tag"
                        className="rounded-md border-0 bg-transparent py-1 text-xs text-slate-600 focus:ring-0"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) applySnippet({ insert: `{{${e.target.value}}}` });
                        }}
                      >
                        <option value="">Insert field…</option>
                        {MERGE_TAGS.map((m) => (
                          <option key={m.tag} value={m.tag}>
                            {m.label} {`{{${m.tag}}}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Textarea ref={bodyRef} rows={16} value={f.body} onChange={(e) => set('body', e.target.value)} className="rounded-none border-0 font-mono text-xs focus:ring-0" invalid={!!errors.body} />
                  </div>
                </Field>
              </div>
            </Card>
            <Card title="Preview" subtitle="Example data; links do not open from the preview">
              <EmailFrame html={previewHtml(f.body, { sender, footerAddress: defaults.data?.footerAddress ?? '' })} />
              {!defaults.data?.footerAddress && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                  <Icon name="info" className="h-3.5 w-3.5" />
                  Add your company address in System Settings → Marketing; marketing e-mails should show it.
                </p>
              )}
            </Card>
          </div>
        </div>
      </div>
    </form>
  );
}
