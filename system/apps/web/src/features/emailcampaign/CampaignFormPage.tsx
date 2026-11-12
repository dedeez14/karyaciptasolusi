import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { AsyncSelect, Button, Card, Field, Icon, Input, NumberInput, PageHeader, Spinner, Switch, toast } from '@/components/ui';
import { AudienceBuilder, cleanAudience, EmailFrame, InboxBanner, previewHtml, SmtpWarning, type Audience, type CampaignDetail, type Defaults } from './common';
import { HtmlEditor } from './HtmlEditor';

interface StepState {
  key: number;
  delayDays: string;
  subject: string;
  body: string;
}

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
  steps: StepState[];
  followUpWeekdays: boolean;
}

const STARTER = `<p>Halo {{name}},</p>
<p>Kami dari <strong>{{sender}}</strong> membantu bisnis seperti <strong>{{company}}</strong> di {{city}} merapikan penjualan, stok dan laporan keuangan dalam satu aplikasi.</p>
<p>Boleh kami jadwalkan demo singkat 20 menit minggu ini?</p>
<p><a href="https://karyaciptasolusi.com" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none">Lihat layanan kami</a></p>
<p>Salam,<br>{{sender}}</p>`;

/** The usual cold-outreach rhythm: a short reminder after 3 days, a polite last e-mail 4 days later (day 7) */
const FOLLOW_UP_TEMPLATES: { delayDays: number; body: string }[] = [
  {
    delayDays: 3,
    body: `<p>Halo {{name}},</p>
<p>Menindaklanjuti e-mail saya sebelumnya: apakah {{company}} saat ini masih mencatat penjualan, stok atau keuangan secara manual?</p>
<p>Kalau iya, dalam 20 menit saya bisa tunjukkan bagaimana prosesnya bisa berjalan otomatis. Cukup balas e-mail ini dengan waktu yang cocok.</p>
<p>Salam,<br>{{sender}}</p>`,
  },
  {
    delayDays: 4,
    body: `<p>Halo {{name}},</p>
<p>Ini e-mail terakhir dari saya soal ini, supaya tidak mengganggu. Kalau suatu saat {{company}} butuh aplikasi untuk merapikan operasional, cukup balas e-mail ini dan kami siap membantu.</p>
<p>Terima kasih atas waktunya.</p>
<p>Salam,<br>{{sender}}</p>`,
  },
];
const GENERIC_FOLLOW_UP = `<p>Halo {{name}},</p>
<p>Sekadar mengingatkan e-mail saya sebelumnya. Apakah ada waktu untuk ngobrol singkat minggu ini?</p>
<p>Salam,<br>{{sender}}</p>`;
const MAX_STEPS = 5;

let keySeq = 1;
const newStep = (delayDays: number, body: string): StepState => ({ key: keySeq++, delayDays: String(delayDays), subject: '', body });

export default function CampaignFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const defaults = useQuery({ queryKey: ['email-defaults'], queryFn: () => api.get<Defaults>('/email-campaigns/defaults') });
  const existing = useQuery({ queryKey: ['email-campaign', id], queryFn: () => api.get<CampaignDetail>(`/email-campaigns/${id}`), enabled: isEdit });
  const [f, setF] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  /** which e-mail of the sequence the preview shows: 0 = first e-mail */
  const [previewStep, setPreviewStep] = useState(0);

  useEffect(() => {
    if (f) return;
    if (isEdit && existing.data) {
      const c = existing.data;
      setF({
        name: c.name,
        subject: c.subject,
        body: c.body,
        fromName: c.fromName ?? '',
        replyTo: c.replyTo ?? '',
        campaignId: c.campaignId,
        audience: c.audience,
        automatic: c.automatic,
        ratePerMinute: String(c.ratePerMinute),
        trackOpens: c.trackOpens,
        steps: c.steps.map((st) => ({ key: keySeq++, delayDays: String(st.delayDays), subject: st.subject ?? '', body: st.body })),
        followUpWeekdays: c.followUpWeekdays,
      });
    } else if (!isEdit && defaults.data) {
      setF({
        name: '',
        subject: 'Solusi aplikasi bisnis untuk {{company}}',
        body: STARTER,
        fromName: '',
        replyTo: '',
        campaignId: null,
        audience: { source: 'LEADS', sourceCodes: ['GOOGLE_MAPS'], statusCodes: ['NEW'] },
        automatic: false,
        ratePerMinute: String(defaults.data.ratePerMinute),
        trackOpens: defaults.data.trackOpens,
        steps: FOLLOW_UP_TEMPLATES.map((t) => newStep(t.delayDays, t.body)),
        followUpWeekdays: true,
      });
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
      const { steps, ...rest } = f!;
      const body = {
        ...rest,
        ratePerMinute: Number(f!.ratePerMinute) || 1,
        audience: cleanAudience(f!.audience),
        steps: steps.map((st) => ({ delayDays: Number(st.delayDays), subject: st.subject.trim(), body: st.body })),
      };
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
  const setStep = (i: number, patch: Partial<StepState>) => set('steps', f.steps.map((st, j) => (j === i ? { ...st, ...patch } : st)));
  const removeStep = (i: number) => {
    set('steps', f.steps.filter((_, j) => j !== i));
    setPreviewStep((p) => (p > f.steps.length - 1 ? 0 : p));
  };
  const addStep = () => {
    const used = f.steps.length;
    const tpl = !used ? FOLLOW_UP_TEMPLATES[0] : used === 1 ? FOLLOW_UP_TEMPLATES[1] : { delayDays: 7, body: GENERIC_FOLLOW_UP };
    set('steps', [...f.steps, newStep(tpl.delayDays, tpl.body)]);
  };
  // day of each e-mail counted from the first one (follow-up delays add up)
  const days = f.steps.reduce<number[]>((acc, st) => [...acc, acc[acc.length - 1] + (Number(st.delayDays) || 0)], [0]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    save.mutate();
  };
  const sender = f.fromName || defaults.data?.fromName || '';
  const shownStep = Math.min(previewStep, f.steps.length);
  const previewSubject = shownStep ? f.steps[shownStep - 1].subject.trim() || `Re: ${f.subject}` : f.subject;
  const previewBody = shownStep ? f.steps[shownStep - 1].body : f.body;
  const stepError = (i: number) => Object.entries(errors).find(([k]) => k.startsWith(`steps.${i}.`))?.[1];

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        title={isEdit ? `Edit ${existing.data?.code ?? ''}` : 'New e-mail campaign'}
        subtitle="Write the e-mail and its follow-ups, choose who receives them, then send now, schedule it or keep it running automatically."
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
        <InboxBanner inbox={defaults.data?.inbox} followUps={f.steps.length > 0} />
        {locked && <p className="rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm text-slate-600">This campaign is {existing.data?.statusCode.toLowerCase()} and can no longer be edited.</p>}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <Card title="Details">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <Card title="First e-mail" subtitle="Day 0">
              <div className="space-y-4">
                <Field label="Subject" required error={errors.subject} help="Merge tags work here too, e.g. {{company}}">
                  <Input value={f.subject} onChange={(e) => set('subject', e.target.value)} invalid={!!errors.subject} />
                </Field>
                <Field label="Message (HTML)" required error={errors.body} help="Scripts, forms and embedded frames are removed when saving. An unsubscribe footer with your address is always added.">
                  <HtmlEditor value={f.body} onChange={(v) => set('body', v)} invalid={!!errors.body} label="First e-mail text" />
                </Field>
              </div>
            </Card>

            <Card
              title="Follow-ups"
              subtitle="Sent only to people who have not replied, unsubscribed or bounced"
              actions={
                <Button size="sm" variant="outline" icon="plus" onClick={addStep} disabled={f.steps.length >= MAX_STEPS || !!locked}>
                  Add follow-up
                </Button>
              }
            >
              {errors.steps && <p className="mb-3 text-sm text-red-600">{errors.steps}</p>}
              {f.steps.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center">
                  <p className="text-sm text-slate-600">No follow-ups. Most replies to cold e-mails come after the second or third e-mail.</p>
                  <Button className="mt-3" size="sm" icon="list-plus" onClick={() => set('steps', FOLLOW_UP_TEMPLATES.map((t) => newStep(t.delayDays, t.body)))} disabled={!!locked}>
                    Add the usual 2 follow-ups (day 3 and day 7)
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Sequence timeline">
                    {days.map((d, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        {i > 0 && <Icon name="chevron-right" className="h-3.5 w-3.5 text-slate-400" />}
                        <span className={`rounded-full px-2.5 py-1 font-medium ${i === 0 ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700'}`}>
                          Day {d} · {i === 0 ? 'first e-mail' : `follow-up ${i}`}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {f.steps.map((st, i) => (
                    <div key={st.key} className="space-y-3 rounded-xl border border-line p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800">
                          Follow-up {i + 1} <span className="font-normal text-slate-500">· day {days[i + 1]}</span>
                        </p>
                        <Button size="sm" variant="ghost" icon="trash-2" aria-label={`Remove follow-up ${i + 1}`} onClick={() => removeStep(i)} disabled={!!locked}>
                          Remove
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                        <Field label="Wait (days)" required error={errors[`steps.${i}.delayDays`]} help={i === 0 ? 'after the first e-mail' : `after follow-up ${i}`}>
                          <NumberInput value={st.delayDays} onChange={(v) => setStep(i, { delayDays: v })} decimals={0} />
                        </Field>
                        <Field label="Subject" error={errors[`steps.${i}.subject`]} help="Empty = a reply in the same e-mail thread (recommended)">
                          <Input value={st.subject} onChange={(e) => setStep(i, { subject: e.target.value })} placeholder={`Re: ${f.subject}`} />
                        </Field>
                      </div>
                      <Field label="Message (HTML)" required error={errors[`steps.${i}.body`]}>
                        <HtmlEditor value={st.body} onChange={(v) => setStep(i, { body: v })} rows={8} invalid={!!errors[`steps.${i}.body`]} label={`Follow-up ${i + 1} text`} />
                      </Field>
                      {stepError(i) && !errors[`steps.${i}.delayDays`] && !errors[`steps.${i}.body`] && !errors[`steps.${i}.subject`] && <p className="text-xs text-red-600">{stepError(i)}</p>}
                    </div>
                  ))}
                  <Switch checked={f.followUpWeekdays} onChange={(v) => set('followUpWeekdays', v)} label="Office hours only (Mon–Fri, 08:00–17:00): a follow-up due at night goes out at 09:00, one due on a weekend on Monday" />
                </div>
              )}
            </Card>

            <Card
              title="Preview"
              subtitle="Example data; links do not open from the preview"
              actions={
                f.steps.length > 0 ? (
                  <div className="flex flex-wrap gap-1" role="tablist" aria-label="E-mail to preview">
                    {[0, ...f.steps.map((_, i) => i + 1)].map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="tab"
                        aria-selected={shownStep === n}
                        onClick={() => setPreviewStep(n)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium ${shownStep === n ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                      >
                        {n === 0 ? 'First' : `Follow-up ${n}`}
                      </button>
                    ))}
                  </div>
                ) : undefined
              }
            >
              <p className="mb-2 truncate text-sm">
                <span className="text-slate-500">Subject: </span>
                <span className="font-medium text-slate-800">{previewSubject.replace(/\{\{\s*company\s*\}\}/gi, 'PT Contoh Usaha').replace(/\{\{\s*name\s*\}\}/gi, 'Budi Santoso')}</span>
              </p>
              <EmailFrame html={previewHtml(previewBody, { sender, footerAddress: defaults.data?.footerAddress ?? '' })} />
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
