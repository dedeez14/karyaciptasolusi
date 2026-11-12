import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Icon, Input, Modal, PageHeader, previewFile, Textarea, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';
import { GROUPS, TEMPLATES, type DocTemplate } from './templates';

const today = () => new Date().toISOString().slice(0, 10);

interface Person {
  personName: string;
  personIdNumber: string;
  personAddress: string;
  personPosition: string;
}
interface Form extends Person {
  letterDate: string;
  subject: string;
  recipient: string;
  body: string;
  place: string;
  signerName: string;
  signerTitle: string;
}
interface Client {
  name: string;
  contact: string;
}
interface SavedTemplate {
  id: string;
  name: string;
  letterType: string;
  layout: 'PERSON' | 'PLAIN';
  subject: string;
  recipient: string | null;
  body: string;
}
interface Issued {
  id: string;
  number: string;
  subject: string;
  letterDate: string;
  personName: string | null;
  letterType: string;
}

const emptyPerson = (): Person => ({ personName: '', personIdNumber: '', personAddress: '', personPosition: '' });

/**
 * Fills the placeholders the form already knows: day and date of the document, the person's details, the client
 * and the signer. Everything else in [square brackets] stays for the user to write.
 */
function autoFill(text: string, f: Form, p: Person = f, client?: Client) {
  const d = new Date(`${f.letterDate}T00:00:00Z`);
  const valid = !Number.isNaN(d.getTime());
  const day = valid ? d.toLocaleDateString('id-ID', { weekday: 'long', timeZone: 'UTC' }) : '';
  const date = valid ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
  const map: [RegExp, string][] = [
    [/\[hari\]/gi, day],
    [/\[tanggal\]/gi, date],
    [/\[nama (karyawan|kandidat|klien|penerima kuasa|penerima)\]/gi, p.personName.trim()],
    [/\[NIK\]/g, p.personIdNumber.trim()],
    [/\[alamat\]/gi, p.personAddress.trim().replace(/\s*\n\s*/g, ', ')],
    [/\[jabatan\]/gi, p.personPosition.trim()],
    [/\[nama penanda tangan\]/gi, f.signerName.trim()],
    [/\[nama perusahaan klien\]/gi, client?.name ?? ''],
    [/\[nama kontak\]/gi, client?.contact || p.personName.trim()],
  ];
  let out = text;
  for (const [re, v] of map) if (v) out = out.replace(re, v);
  return out;
}

const openBrackets = (...texts: string[]) => [...new Set(texts.join('\n').match(/\[[^\]]{2,60}\]/g) ?? [])];
const templateOf = (type: string) => TEMPLATES.find((t) => t.type === type) ?? TEMPLATES[TEMPLATES.length - 1];

/** E-mail a signed document to one address */
function EmailDialog({ doc, onClose }: { doc: Issued | null; onClose: () => void }) {
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTo('');
    setMessage('');
  }, [doc]);
  const send = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      await api.post(`/letters/${doc.id}/email`, { to, message: message || undefined });
      toast.success(`Sent to ${to}`);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!doc}
      onClose={onClose}
      title="Send by e-mail"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="send" loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(to)} onClick={send}>
            Send
          </Button>
        </>
      }
    >
      {doc && (
        <div className="space-y-4">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <span className="font-medium text-slate-800">{doc.subject}</span> · {doc.number} · signed PDF attached
          </p>
          <Field label="To" required>
            <Input type="email" value={to} maxLength={150} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" autoFocus />
          </Field>
          <Field label="Message" help="Empty = a short standard text with your name and title">
            <Textarea rows={4} value={message} maxLength={4000} onChange={(e) => setMessage(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

/** Director's document center: pick a template, fill it in, preview, issue one or many signed PDFs */
export default function DocumentCenterPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [tpl, setTpl] = useState<DocTemplate | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [many, setMany] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [client, setClient] = useState<Client | undefined>();
  const [busy, setBusy] = useState<'' | 'preview' | 'save' | 'template'>('');
  const [filter, setFilter] = useState('');
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [emailDoc, setEmailDoc] = useState<Issued | null>(null);

  const signer = useQuery({ queryKey: ['letters', 'signer'], queryFn: () => api.get<{ signerName: string; signerTitle: string; hasSignature: boolean }>('/letters/signer') });
  const saved = useQuery({
    queryKey: ['resources', 'letter-templates', 'center'],
    queryFn: () => api.get<{ data: SavedTemplate[] }>('/resources/letter-templates', { pageSize: 100, sort: 'name', order: 'asc', 'f.isActive': true }),
  });
  const recent = useQuery({
    queryKey: ['resources', 'letters', 'recent'],
    queryFn: () => api.get<{ data: Issued[] }>('/resources/letters', { pageSize: 6, sort: 'createdAt', order: 'desc' }),
  });

  const start = (t: DocTemplate, over?: Partial<Form>) => {
    setTpl(t);
    setMany(false);
    setPeople([]);
    setEmployeeId('');
    setCustomerId('');
    setClient(undefined);
    setTemplateName(null);
    setForm({
      letterDate: today(),
      subject: t.subject,
      recipient: t.recipient,
      ...emptyPerson(),
      body: t.body,
      place: 'Depok',
      signerName: signer.data?.signerName || 'Dede Febriansyah',
      signerTitle: signer.data?.signerTitle || 'Direktur',
      ...over,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const close = () => {
    setTpl(null);
    setForm(null);
    if (sp.get('from')) setSp({}, { replace: true });
  };
  const set = (k: keyof Form, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  // "Use again" from Issued Documents: /document-center?from=<letter id>
  useEffect(() => {
    const id = sp.get('from');
    if (!id || !signer.data) return;
    api
      .get<Record<string, any>>(`/resources/letters/${id}`)
      .then((l) =>
        start({ ...templateOf(l.letterType), layout: l.layout ?? templateOf(l.letterType).layout }, {
          subject: l.subject ?? '',
          recipient: l.recipient ?? '',
          body: l.body ?? '',
          personName: l.personName ?? '',
          personIdNumber: l.personIdNumber ?? '',
          personAddress: l.personAddress ?? '',
          personPosition: l.personPosition ?? '',
          place: l.place ?? 'Depok',
        }),
      )
      .catch((e) => toast.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.get('from'), signer.data]);

  const loadEmployee = async (id: string): Promise<Person | null> => {
    try {
      const e = await api.get<Record<string, any>>(`/resources/employees/${id}`);
      return { personName: e.fullName ?? '', personIdNumber: e.identityNo ?? '', personAddress: e.address ?? '', personPosition: e._labels?.positionId?.replace(/^[A-Z0-9]+ - /, '') ?? '' };
    } catch (err) {
      toast.error(err);
      return null;
    }
  };
  const pickEmployee = async (id: string) => {
    setEmployeeId(id);
    if (!id) return;
    const p = await loadEmployee(id);
    if (p) setForm((f) => (f ? { ...f, ...p } : f));
  };
  const addEmployee = async (id: string) => {
    if (!id) return;
    const p = await loadEmployee(id);
    if (p) setPeople((list) => (list.some((x) => x.personName === p.personName) ? list : [...list, p]));
  };
  const pickCustomer = async (id: string) => {
    setCustomerId(id);
    if (!id) return setClient(undefined);
    try {
      const c = await api.get<Record<string, any>>(`/resources/customers/${id}`);
      const name = String(c.name ?? '');
      const contact = String(c.contactPerson ?? '');
      setClient({ name, contact });
      setForm((f) => (f && tpl?.person ? { ...f, personName: contact || name, personPosition: contact ? `Perwakilan ${name}` : '', personAddress: [c.address, c.city].filter(Boolean).join(', '), personIdNumber: '' } : f));
    } catch (err) {
      toast.error(err);
    }
  };

  /** the letter(s) to send: one per person when issuing for several people */
  const letters = () => {
    if (!tpl || !form) return [];
    const list = many ? people : [form as Person];
    return list.map((p) => ({
      letterType: tpl.type,
      layout: tpl.layout,
      letterDate: form.letterDate,
      subject: autoFill(form.subject, form, p, client),
      recipient: autoFill(form.recipient, form, p, client) || null,
      body: autoFill(form.body, form, p, client),
      place: form.place,
      signerName: form.signerName,
      signerTitle: form.signerTitle,
      personName: p.personName.trim() || null,
      personIdNumber: p.personIdNumber.trim() || null,
      personAddress: p.personAddress.trim() || null,
      personPosition: p.personPosition.trim() || null,
    }));
  };

  const open = useMemo(() => {
    if (!form) return [];
    const first = many ? people[0] ?? emptyPerson() : form;
    return openBrackets(autoFill(`${form.subject}\n${form.recipient}\n${form.body}`, form, first, client));
  }, [form, client, many, people]);

  const check = async () => {
    if (!tpl || !form) return false;
    if (tpl.person && many && !people.length) return toast.error('Add at least one person'), false;
    if (tpl.person && !many && !form.personName.trim()) return toast.error(`Fill in the ${(tpl.personLabel ?? 'person').toLowerCase()} (or choose one)`), false;
    if (open.length)
      return confirm({
        title: `${open.length} part${open.length > 1 ? 's are' : ' is'} still to fill in`,
        message: `${open.slice(0, 6).join(', ')}${open.length > 6 ? ', ...' : ''} will be printed as written. Continue?`,
        confirmText: 'Continue',
      });
    return true;
  };

  const preview = async () => {
    const first = letters()[0];
    if (!first) return;
    setBusy('preview');
    try {
      await previewFile({ path: '/letters/preview', body: first, title: `Preview - ${first.subject}` });
    } finally {
      setBusy('');
    }
  };

  const generate = async () => {
    if (!(await check())) return;
    const list = letters();
    setBusy('save');
    try {
      let ids: string[];
      if (list.length === 1) {
        const c = await api.post<{ id: string; number: string }>('/resources/letters', list[0]);
        ids = [c.id];
        toast.success(`Document ${c.number} issued`);
      } else {
        const r = await api.post<{ created: { id: string; number: string }[] }>('/letters/bulk', { letters: list });
        ids = r.created.map((c) => c.id);
        toast.success(`${ids.length} documents issued (${r.created[0].number} - ${r.created[r.created.length - 1].number})`);
      }
      qc.invalidateQueries({ queryKey: ['resources', 'letters'] });
      await previewFile(ids.length === 1 ? { path: `/letters/${ids[0]}/pdf`, title: list[0].subject } : { path: '/letters/merged', params: { ids: ids.join(',') }, title: `${list[0].subject} (${ids.length})` });
      close();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy('');
    }
  };

  const saveTemplate = async () => {
    if (!tpl || !form || !templateName?.trim()) return;
    setBusy('template');
    try {
      await api.post('/resources/letter-templates', { name: templateName.trim(), letterType: tpl.type, layout: tpl.layout, subject: form.subject, recipient: form.recipient || null, body: form.body });
      toast.success('Saved to My templates');
      setTemplateName(null);
      qc.invalidateQueries({ queryKey: ['resources', 'letter-templates'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy('');
    }
  };
  const removeTemplate = async (t: SavedTemplate) => {
    if (!(await confirm({ title: `Delete template "${t.name}"?`, danger: true, confirmText: 'Delete' }))) return;
    try {
      await api.delete(`/resources/letter-templates/${t.id}`);
      qc.invalidateQueries({ queryKey: ['resources', 'letter-templates'] });
    } catch (e) {
      toast.error(e);
    }
  };

  const shown = TEMPLATES.filter((t) => !filter || `${t.title} ${t.description}`.toLowerCase().includes(filter.toLowerCase()));
  const mine = (saved.data?.data ?? []).filter((t) => !filter || `${t.name} ${t.subject}`.toLowerCase().includes(filter.toLowerCase()));
  const canCreate = can('hris.letter.create');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Document Center"
        subtitle="Official letters on the company letterhead, numbered and signed by the system"
        actions={
          <Link to="/r/letters">
            <Button variant="outline" icon="folder-open">
              Issued documents
            </Button>
          </Link>
        }
      />

      {signer.data && (
        <div className={cn('flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-sm', signer.data.hasSignature ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>
          <Icon name={signer.data.hasSignature ? 'badge-check' : 'pen-line'} className="h-5 w-5 shrink-0" />
          <span className="flex-1">
            {signer.data.hasSignature
              ? `Documents are signed by ${signer.data.signerName}${signer.data.signerTitle ? `, ${signer.data.signerTitle}` : ''} with the saved signature.`
              : 'No signature image is set. Save your signature in My Profile and choose the signer in Settings > Documents.'}
          </span>
          {!signer.data.hasSignature && (
            <Link to="/profile" className="font-medium underline">
              My Profile
            </Link>
          )}
        </div>
      )}

      {tpl && form ? (
        <Card
          title={
            <span className="flex items-center gap-2">
              <Icon name={tpl.icon} className="h-5 w-5 text-brand-600" /> {tpl.title}
            </span>
          }
          actions={
            <Button variant="ghost" icon="x" onClick={close}>
              Close
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Subject (Perihal)" required className="sm:col-span-2">
                  <Input value={form.subject} maxLength={200} onChange={(e) => set('subject', e.target.value)} />
                </Field>
                <Field label="Date" required>
                  <DatePicker value={form.letterDate} onChange={(v) => set('letterDate', v)} clearable={false} />
                </Field>
                <Field label="Place">
                  <Input value={form.place} maxLength={80} onChange={(e) => set('place', e.target.value)} />
                </Field>
                <Field label="To (Kepada Yth.)" help="One line per row; leave empty when the document has no addressee" className="sm:col-span-2">
                  <Textarea rows={2} value={form.recipient} maxLength={500} onChange={(e) => set('recipient', e.target.value)} />
                </Field>
              </div>

              {!tpl.person && tpl.party === 'customer' && can('master.customer.read') && (
                <Field label="Customer" help="Fills the client name and contact in the text">
                  <AsyncSelect resource="customers" value={customerId} onChange={(v) => pickCustomer(v ?? '')} placeholder="Search customer..." />
                </Field>
              )}

              {tpl.person && (
                <div className="rounded-xl border border-line p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">{tpl.personLabel ?? 'Person'}</p>
                    {tpl.party !== 'customer' && (
                      <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
                        {[
                          ['One person', false],
                          ['Several people', true],
                        ].map(([label, v]) => (
                          <button key={String(label)} type="button" onClick={() => setMany(v as boolean)} className={cn('rounded-md px-3 py-1.5', many === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
                            {label as string}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {many ? (
                    <div className="space-y-3">
                      {can('hris.employee.read') && (
                        <Field label="Add an employee" help="One document per person, numbered in order, in one PDF to print">
                          <AsyncSelect resource="employees" value="" onChange={(v) => addEmployee(v ?? '')} placeholder="Search employee to add..." />
                        </Field>
                      )}
                      {people.length ? (
                        <ul className="divide-y divide-line rounded-xl border border-line">
                          {people.map((p, i) => (
                            <li key={i} className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-center">
                              <Input value={p.personName} aria-label="Name" placeholder="Name" onChange={(e) => setPeople((l) => l.map((x, j) => (j === i ? { ...x, personName: e.target.value } : x)))} />
                              <Input value={p.personIdNumber} aria-label="NIK" placeholder="NIK" inputMode="numeric" onChange={(e) => setPeople((l) => l.map((x, j) => (j === i ? { ...x, personIdNumber: e.target.value } : x)))} />
                              <Input value={p.personPosition} aria-label="Position" placeholder="Position" onChange={(e) => setPeople((l) => l.map((x, j) => (j === i ? { ...x, personPosition: e.target.value } : x)))} />
                              <Button variant="ghost" size="icon" icon="x" aria-label={`Remove ${p.personName || 'person'}`} onClick={() => setPeople((l) => l.filter((_, j) => j !== i))} />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">No one added yet.</p>
                      )}
                      <Button variant="outline" size="sm" icon="plus" onClick={() => setPeople((l) => [...l, emptyPerson()])}>
                        Add someone manually
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {tpl.party === 'customer'
                        ? can('master.customer.read') && (
                            <Field label="Choose a customer" help="Fills the client, contact person and address" className="sm:col-span-2">
                              <AsyncSelect resource="customers" value={customerId} onChange={(v) => pickCustomer(v ?? '')} placeholder="Search customer..." />
                            </Field>
                          )
                        : can('hris.employee.read') && (
                            <Field label="Choose an employee" help="Fills the details below" className="sm:col-span-2">
                              <AsyncSelect resource="employees" value={employeeId} onChange={(v) => pickEmployee(v ?? '')} placeholder="Search employee..." />
                            </Field>
                          )}
                      <Field label="Name" required>
                        <Input value={form.personName} maxLength={150} onChange={(e) => set('personName', e.target.value)} />
                      </Field>
                      <Field label="NIK" help="Stored encrypted">
                        <Input value={form.personIdNumber} maxLength={40} inputMode="numeric" onChange={(e) => set('personIdNumber', e.target.value)} />
                      </Field>
                      <Field label="Position">
                        <Input value={form.personPosition} maxLength={150} onChange={(e) => set('personPosition', e.target.value)} />
                      </Field>
                      <Field label="Address" className="sm:col-span-2">
                        <Textarea rows={2} value={form.personAddress} maxLength={500} onChange={(e) => set('personAddress', e.target.value)} />
                      </Field>
                    </div>
                  )}
                </div>
              )}

              <Field label="Text" required help='Replace everything in [square brackets]. Day, date, names, NIK, address and position are filled in for you. "# " starts a heading; lines starting with "- " or "1." become a list.'>
                <Textarea rows={16} value={form.body} maxLength={6000} onChange={(e) => set('body', e.target.value)} className="leading-relaxed" />
              </Field>
            </div>

            <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
              <div className="rounded-xl border border-line p-4">
                <p className="mb-3 text-sm font-semibold text-slate-800">Signed by</p>
                <div className="space-y-3">
                  <Field label="Name">
                    <Input value={form.signerName} maxLength={150} onChange={(e) => set('signerName', e.target.value)} />
                  </Field>
                  <Field label="Title">
                    <Input value={form.signerTitle} maxLength={100} onChange={(e) => set('signerTitle', e.target.value)} />
                  </Field>
                </div>
              </div>
              <div className={cn('rounded-xl p-4 text-sm', open.length ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800')}>
                {open.length ? (
                  <>
                    <p className="mb-2 font-semibold">Still to fill in ({open.length})</p>
                    <ul className="space-y-1 text-xs">
                      {open.slice(0, 10).map((p) => (
                        <li key={p} className="truncate">
                          {p}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="flex items-center gap-2 font-medium">
                    <Icon name="check-circle-2" className="h-4 w-4" /> Everything is filled in
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Button variant="outline" icon="eye" className="w-full" loading={busy === 'preview'} onClick={preview}>
                  Preview
                </Button>
                <Button icon="file-signature" className="w-full" loading={busy === 'save'} onClick={generate}>
                  {many && people.length > 1 ? `Issue ${people.length} signed documents` : 'Issue signed PDF'}
                </Button>
                {templateName === null ? (
                  <Button variant="ghost" icon="bookmark-plus" className="w-full" onClick={() => setTemplateName(form.subject)}>
                    Save as my template
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-xl border border-line p-3">
                    <Field label="Template name">
                      <Input value={templateName} maxLength={150} onChange={(e) => setTemplateName(e.target.value)} autoFocus />
                    </Field>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setTemplateName(null)}>
                        Cancel
                      </Button>
                      <Button size="sm" icon="save" loading={busy === 'template'} disabled={!templateName.trim()} onClick={saveTemplate}>
                        Save
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-500">The preview is not saved and has no number. Issued documents get the next number (e.g. 001/SR/KCS/XI/2026) and stay in Issued documents.</p>
            </aside>
          </div>
        </Card>
      ) : (
        <>
          {!!recent.data?.data.length && (
            <Card title="Recently issued" actions={<Link to="/r/letters" className="link text-sm">All documents</Link>}>
              <ul className="divide-y divide-line">
                {recent.data.data.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{d.subject}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {d.number} · {fmtDate(d.letterDate)}
                        {d.personName ? ` · ${d.personName}` : ''}
                      </span>
                    </span>
                    <span className="flex gap-1">
                      <Button variant="ghost" size="sm" icon="printer" onClick={() => previewFile({ path: `/letters/${d.id}/pdf`, title: `${d.subject} ${d.number}` })}>
                        Print
                      </Button>
                      {canCreate && (
                        <Button variant="ghost" size="sm" icon="copy" onClick={() => setSp({ from: d.id })}>
                          Use again
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" icon="send" onClick={() => setEmailDoc(d)}>
                        E-mail
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="max-w-sm">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a document type..." aria-label="Find a document type" />
          </div>

          {!!mine.length && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
                <Icon name="bookmark" className="h-4 w-4" /> My templates
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {mine.map((t) => {
                  const base = templateOf(t.letterType);
                  return (
                    <div key={t.id} className="card group flex items-start gap-3 p-4">
                      <button type="button" disabled={!canCreate} onClick={() => start({ ...base, title: t.name, layout: t.layout }, { subject: t.subject, recipient: t.recipient ?? '', body: t.body })} className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:opacity-60">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-100 text-accent-700">
                          <Icon name={base.icon} className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-slate-900">{t.name}</span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500">{t.subject}</span>
                        </span>
                      </button>
                      {canCreate && <Button variant="ghost" size="icon" icon="trash-2" aria-label={`Delete template ${t.name}`} onClick={() => removeTemplate(t)} />}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {(Object.keys(GROUPS) as DocTemplate['group'][]).map((g) => {
            const list = shown.filter((t) => t.group === g);
            if (!list.length) return null;
            return (
              <section key={g}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
                  <Icon name={GROUPS[g].icon} className="h-4 w-4" /> {GROUPS[g].label}
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((t) => (
                    <button key={t.type + t.title} type="button" onClick={() => start(t)} disabled={!canCreate} className="card group flex items-start gap-3 p-4 text-left transition-shadow hover:shadow-pop disabled:opacity-60">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 group-hover:bg-brand-600 group-hover:text-white">
                        <Icon name={t.icon} className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-slate-900">{t.title}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{t.description}</span>
                        {t.layout === 'PLAIN' && (
                          <span className="mt-2 inline-block">
                            <Badge>Free layout</Badge>
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
          {!shown.length && !mine.length && <EmptyState icon="search" title="No document type matches" />}
        </>
      )}

      <EmailDialog doc={emailDoc} onClose={() => setEmailDoc(null)} />
    </div>
  );
}
