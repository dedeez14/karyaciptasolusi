import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, Field, Icon, Input, PageHeader, previewFile, Textarea, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';
import { GROUPS, TEMPLATES, type DocTemplate } from './templates';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Fills the placeholders the form already knows: day and date of the document, and the person's details.
 * Everything else in [square brackets] stays for the user to write.
 */
function autoFill(text: string, f: Form, client?: { name: string; contact: string }) {
  const d = new Date(`${f.letterDate}T00:00:00Z`);
  const valid = !Number.isNaN(d.getTime());
  const day = valid ? d.toLocaleDateString('id-ID', { weekday: 'long', timeZone: 'UTC' }) : '';
  const date = valid ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
  const map: [RegExp, string][] = [
    [/\[hari\]/gi, day],
    [/\[tanggal\]/gi, date],
    [/\[nama (karyawan|kandidat|klien|penerima kuasa)\]/gi, f.personName.trim()],
    [/\[NIK\]/g, f.personIdNumber.trim()],
    [/\[alamat\]/gi, f.personAddress.trim().replace(/\s*\n\s*/g, ', ')],
    [/\[jabatan\]/gi, f.personPosition.trim()],
    [/\[nama penerima\]/gi, f.personName.trim()],
    [/\[nama perusahaan klien\]/gi, client?.name ?? ''],
    [/\[nama kontak\]/gi, client?.contact || f.personName.trim()],
  ];
  let out = text;
  for (const [re, v] of map) if (v) out = out.replace(re, v);
  return out;
}

interface Form {
  letterDate: string;
  subject: string;
  recipient: string;
  personName: string;
  personIdNumber: string;
  personAddress: string;
  personPosition: string;
  body: string;
  place: string;
  signerName: string;
  signerTitle: string;
}

/** Director's document center: pick a template, fill it in (an employee fills the person details), get a signed PDF */
export default function DocumentCenterPage() {
  const { can } = useSession();
  const [tpl, setTpl] = useState<DocTemplate | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [client, setClient] = useState<{ name: string; contact: string } | undefined>();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const signer = useQuery({
    queryKey: ['settings', 'signer'],
    queryFn: () => api.get<{ signerName: string; signerTitle: string; hasSignature: boolean }>('/letters/signer'),
  });

  const start = (t: DocTemplate) => {
    setTpl(t);
    setEmployeeId('');
    setCustomerId('');
    setClient(undefined);
    setForm({
      letterDate: today(),
      subject: t.subject,
      recipient: t.recipient,
      personName: '',
      personIdNumber: '',
      personAddress: '',
      personPosition: '',
      body: t.body,
      place: 'Depok',
      signerName: signer.data?.signerName || 'Dede Febriansyah',
      signerTitle: signer.data?.signerTitle || 'Direktur',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const set = (k: keyof Form, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  // choosing an employee fills name, NIK, address and position
  const pickEmployee = async (id: string) => {
    setEmployeeId(id);
    if (!id) return;
    try {
      const e = await api.get<Record<string, any>>(`/resources/employees/${id}`);
      setForm((f) => (f ? { ...f, personName: e.fullName ?? f.personName, personIdNumber: e.identityNo ?? '', personAddress: e.address ?? '', personPosition: e._labels?.positionId?.replace(/^[A-Z0-9]+ - /, '') ?? f.personPosition } : f));
    } catch (err) {
      toast.error(err);
    }
  };

  // choosing a customer fills the client company, its contact person and address
  const pickCustomer = async (id: string) => {
    setCustomerId(id);
    if (!id) return setClient(undefined);
    try {
      const c = await api.get<Record<string, any>>(`/resources/customers/${id}`);
      const name = String(c.name ?? '');
      const contact = String(c.contactPerson ?? '');
      setClient({ name, contact });
      setForm((f) =>
        f && tpl?.person
          ? { ...f, personName: contact || name, personPosition: contact ? `Perwakilan ${name}` : '', personAddress: [c.address, c.city].filter(Boolean).join(', '), personIdNumber: '' }
          : f,
      );
    } catch (err) {
      toast.error(err);
    }
  };

  const placeholders = useMemo(() => (form ? [...new Set(autoFill(`${form.subject}\n${form.recipient}\n${form.body}`, form, client).match(/\[[^\]]{2,60}\]/g) ?? [])] : []), [form, client]);

  const generate = async () => {
    if (!tpl || !form) return;
    if (tpl.person && !form.personName.trim()) return toast.error(`Fill in the ${(tpl.personLabel ?? 'person').toLowerCase()} (or choose an employee)`);
    const filled = { ...form, subject: autoFill(form.subject, form, client), recipient: autoFill(form.recipient, form, client), body: autoFill(form.body, form, client) };
    const left = [...new Set(`${filled.subject}\n${filled.recipient}\n${filled.body}`.match(/\[[^\]]{2,60}\]/g) ?? [])];
    if (
      left.length &&
      !(await confirm({
        title: `${left.length} part${left.length > 1 ? 's are' : ' is'} still to fill in`,
        message: `${left.slice(0, 6).join(', ')}${left.length > 6 ? ', ...' : ''} will be printed as written. Generate anyway?`,
        confirmText: 'Generate anyway',
      }))
    )
      return;
    setBusy(true);
    try {
      const created = await api.post<{ id: string; number: string }>('/resources/letters', {
        letterType: tpl.type,
        layout: tpl.layout,
        ...filled,
        personName: form.personName || null,
        personIdNumber: form.personIdNumber || null,
        personAddress: form.personAddress || null,
        personPosition: form.personPosition || null,
        recipient: form.recipient || null,
      });
      toast.success(`Document ${created.number ?? ''} created`);
      await previewFile({ path: `/letters/${created.id}/pdf`, title: `${form.subject} ${created.number ?? ''}`.trim() });
      setTpl(null);
      setForm(null);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const shown = TEMPLATES.filter((t) => !filter || `${t.title} ${t.description}`.toLowerCase().includes(filter.toLowerCase()));

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
              ? `Documents are signed by ${signer.data.signerName}${signer.data.signerTitle ? `, ${signer.data.signerTitle}` : ''} with the saved signature and a verification QR code.`
              : 'No signature image is set: documents get the electronic signature QR only. Save your signature in My Profile and choose the signer in Settings > Documents.'}
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
            <Button variant="ghost" icon="x" onClick={() => (setTpl(null), setForm(null))}>
              Close
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
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
                  <p className="mb-3 text-sm font-semibold text-slate-800">{tpl.personLabel ?? 'Person'}</p>
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
                </div>
              )}

              <Field label="Text" required help='Replace everything in [square brackets]. A line starting with "# " is a heading; lines starting with "- " or "1." become a list.'>
                <Textarea rows={14} value={form.body} maxLength={6000} onChange={(e) => set('body', e.target.value)} className="font-[inherit] leading-relaxed" />
              </Field>
            </div>

            <aside className="space-y-4">
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
              <div className={cn('rounded-xl p-4 text-sm', placeholders.length ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800')}>
                {placeholders.length ? (
                  <>
                    <p className="mb-2 font-semibold">Still to fill in ({placeholders.length})</p>
                    <ul className="space-y-1 text-xs">
                      {placeholders.slice(0, 10).map((p) => (
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
              <Button icon="file-signature" className="w-full" loading={busy} onClick={generate}>
                Generate signed PDF
              </Button>
              <p className="text-xs text-slate-500">The number is given on saving (e.g. 001/SR/KCS/XI/2026). Every document stays in Issued documents and can be printed again.</p>
            </aside>
          </div>
        </Card>
      ) : (
        <>
          <div className="max-w-sm">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a document type..." aria-label="Find a document type" />
          </div>
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
                    <button key={t.type + t.title} type="button" onClick={() => start(t)} disabled={!can('hris.letter.create')} className="card group flex items-start gap-3 p-4 text-left transition-shadow hover:shadow-pop disabled:opacity-60">
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
        </>
      )}
    </div>
  );
}
