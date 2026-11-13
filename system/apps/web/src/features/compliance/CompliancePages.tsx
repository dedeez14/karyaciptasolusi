import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { download } from '@/lib/download';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, Checkbox, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, StatCard, Switch, Textarea, toast } from '@/components/ui';
import { CERT_STATUS, CERT_TYPES, esc, printHtml, PRINT_CSS, tkdnCredit } from './common';

// ============================================================ overview
interface Overview {
  certificates: { id: string; type: string; number: string; title: string; status: string; expiresAt: string | null; daysLeft: number | null; reviewReason: string | null }[];
  counts: { total: number; valid: number; expiring: number; expired: number; review: number };
  missing: { id: string; code: string; name: string; missing: string[] }[];
  ingredients: { id: string; code: string; name: string; usedIn: string[] }[];
  k3: { id: string; code: string; name: string; inspectionCertNo: string | null; inspectionExpiry: string; daysLeft: number }[];
  waste: { id: string; date: string; type?: { code: string; name: string }; remainingQty: number; maxStorageDate: string; daysLeft: number }[];
  siinas: { year: number; quarter: number; due: string; status: string; submittedAt: string | null; daysLeft: number };
}

/** one place for what is due or at risk: certificates, required certifications, halal ingredients, K3, B3 waste, SIINas */
export function ComplianceOverviewPage() {
  const q = useQuery({ queryKey: ['compliance', 'overview'], queryFn: () => api.get<Overview>('/compliance/overview') });
  const o = q.data;
  if (q.isLoading || !o)
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  const s = o.siinas;
  const siinasLate = s.status !== 'SUBMITTED';
  return (
    <div className="space-y-5">
      <PageHeader title="Compliance Overview" subtitle="Certificates and licences, what each product must hold, K3 inspections, B3 waste storage limits and the quarterly SIINas report" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Certificates valid" value={`${o.counts.valid} / ${o.counts.total}`} icon="badge-check" tone="green" />
        <StatCard label="Expiring in 90 days" value={o.counts.expiring} icon="clock" tone="amber" />
        <StatCard label="Expired / to review" value={o.counts.expired + o.counts.review} icon="triangle-alert" tone={o.counts.expired + o.counts.review ? 'red' : 'gray'} />
        <StatCard label={`SIINas ${s.year} Q${s.quarter}`} value={s.status === 'SUBMITTED' ? 'Reported' : s.daysLeft >= 0 ? `${s.daysLeft} d left` : `${-s.daysLeft} d late`} hint={`due ${fmtDate(s.due)}`} icon="chart-column" tone={!siinasLate ? 'green' : s.daysLeft < 0 ? 'red' : 'amber'} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Certificates to act on" subtitle="Expired, expiring within 90 days, or changed since certification" bodyClass="p-0" actions={<Link className="text-sm text-brand-600" to="/compliance/certificates">All</Link>}>
          {!o.certificates.length ? (
            <p className="px-4 py-6 text-sm text-slate-500">Nothing to do.</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.certificates.map((c) => (
                <li key={c.id} className="px-4 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-medium">{c.title}</span> <span className="text-xs text-slate-500">{CERT_TYPES[c.type]?.label} · {c.number}</span>
                    </span>
                    <Badge tone={CERT_STATUS[c.status].tone}>{c.status === 'REVIEW' ? 'Review' : c.daysLeft !== null && c.daysLeft < 0 ? `expired ${-c.daysLeft} d ago` : `${fmtDate(c.expiresAt)} · ${c.daysLeft} d`}</Badge>
                  </div>
                  {c.status === 'REVIEW' && c.reviewReason && <p className="mt-1 whitespace-pre-line text-xs text-violet-700">{c.reviewReason}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Products without a required certificate" subtitle="Set on the product: must be halal certified, needs BPOM / PIRT, mandatory SNI" bodyClass="p-0">
          {!o.missing.length ? (
            <p className="px-4 py-6 text-sm text-slate-500">Every product holds what it must.</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.missing.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span>
                    {p.name} <span className="text-xs text-slate-500">{p.code}</span>
                  </span>
                  <span className="flex gap-1">
                    {p.missing.map((m) => (
                      <Badge key={m} tone="red">
                        {m}
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Ingredients of halal products without a halal certificate" subtitle="Every material of a halal product must be halal: register the supplier's certificate for it (PP 42/2024)" bodyClass="p-0">
          {!o.ingredients.length ? (
            <p className="px-4 py-6 text-sm text-slate-500">All ingredients are covered.</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.ingredients.map((p) => (
                <li key={p.id} className="px-4 py-2 text-sm">
                  {p.name} <span className="text-xs text-slate-500">{p.code}</span>
                  <div className="text-xs text-slate-500">used in {p.usedIn.join(', ')}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="B3 waste near its storage limit" subtitle="Hand it over, utilise or treat it before the date (Permen LHK 6/2021 Art. 79)" bodyClass="p-0" actions={<Link className="text-sm text-brand-600" to="/compliance/waste">B3 waste</Link>}>
          {!o.waste.length ? (
            <p className="px-4 py-6 text-sm text-slate-500">No waste within 14 days of its limit.</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.waste.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span>
                    {w.type?.code} {w.type?.name} <span className="text-xs text-slate-500">stored {fmtDate(w.date)} · {fmtNumber(w.remainingQty, 3)} kg</span>
                  </span>
                  <Badge tone={w.daysLeft < 0 ? 'red' : 'amber'}>{w.daysLeft < 0 ? `${-w.daysLeft} d over` : `${w.daysLeft} d left`}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="K3 inspection certificates (riksa uji)" subtitle="Machines, pressure vessels, lifting equipment expiring within 60 days" bodyClass="p-0" actions={<Link className="text-sm text-brand-600" to="/r/equipment">Equipment</Link>}>
          {!o.k3.length ? (
            <p className="px-4 py-6 text-sm text-slate-500">None due.</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.k3.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span>
                    {e.name} <span className="text-xs text-slate-500">{e.code}{e.inspectionCertNo ? ` · ${e.inspectionCertNo}` : ''}</span>
                  </span>
                  <Badge tone={e.daysLeft < 0 ? 'red' : 'amber'}>{e.daysLeft < 0 ? `expired ${-e.daysLeft} d ago` : `${e.daysLeft} d`}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="SIINas quarterly report" subtitle="Permenperin 13/2025: every quarter, by the 10th of the following month, one report per factory location">
          <p className="text-sm">
            {s.year} quarter {s.quarter}: {s.status === 'SUBMITTED' ? <Badge tone="green">reported {fmtDate(s.submittedAt)}</Badge> : <Badge tone={s.daysLeft < 0 ? 'red' : 'amber'}>{s.status === 'DRAFT' ? 'draft' : 'not started'} · due {fmtDate(s.due)}</Badge>}
          </p>
          <Link to={`/compliance/siinas?year=${s.year}&quarter=${s.quarter}`} className="mt-3 inline-block text-sm text-brand-600">
            Prepare the report
          </Link>
        </Card>
      </div>
    </div>
  );
}

// ============================================================ certificates
interface Cert {
  id: string;
  type: string;
  number: string;
  title: string;
  issuer: string | null;
  holder: 'OWN' | 'SUPPLIER';
  supplierId: string | null;
  supplier: { id: string; code: string; name: string } | null;
  issuedAt: string | null;
  expiresAt: string | null;
  tkdnValue: number | null;
  bmpValue: number | null;
  scope: string | null;
  notes: string | null;
  isActive: boolean;
  reviewNeeded: boolean;
  reviewReason: string | null;
  products: { id: string; code: string; name: string }[];
  status: string;
  daysLeft: number | null;
}

export function CertificatesPage() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [edit, setEdit] = useState<Cert | 'new' | null>(null);
  const q = useQuery({ queryKey: ['compliance', 'certs', type, status], queryFn: () => api.get<Cert[]>('/compliance/certificates', { type: type || undefined, status: status || undefined }) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Certificates & Licences"
        subtitle="Ours and our suppliers': halal, BPOM, PIRT, SNI, TKDN, ISO... with expiry alerts. A halal product whose recipe changes is flagged for review"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-44">
              <Select value={type} onChange={(e) => setType(e.target.value)} placeholder="All types" options={Object.entries(CERT_TYPES).map(([value, t]) => ({ value, label: t.label }))} />
            </div>
            <div className="w-36">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Any status" options={Object.entries(CERT_STATUS).map(([value, t]) => ({ value, label: t.label }))} />
            </div>
            {can('compliance.certificate.manage') && (
              <Button icon="plus" onClick={() => setEdit('new')}>
                New certificate
              </Button>
            )}
          </div>
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !q.data?.length ? (
          <EmptyState icon="badge-check" title="No certificates registered" description="Register the company's halal, BPOM, SNI or TKDN certificates and the halal certificates of your suppliers' materials" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setEdit(c)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {c.title} <span className="text-xs font-normal text-slate-500">{c.number}</span>
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {CERT_TYPES[c.type]?.label}
                      {c.holder === 'SUPPLIER' ? ` · supplier ${c.supplier?.name ?? ''}` : ''}
                      {c.tkdnValue !== null ? ` · TKDN ${fmtNumber(c.tkdnValue, 2)}%` : ''}
                      {c.products.length ? ` · ${c.products.length === 1 ? c.products[0].name : `${c.products.length} products`}` : ''}
                    </span>
                  </span>
                  <span className="text-xs text-slate-500">{c.expiresAt ? `until ${fmtDate(c.expiresAt)}` : 'no fixed expiry'}</span>
                  <Badge tone={CERT_STATUS[c.status].tone}>{CERT_STATUS[c.status].label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <CertificateEditor cert={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['compliance'] }))} />}
    </div>
  );
}

function CertificateEditor({ cert, onClose, onSaved }: { cert: Cert | null; onClose: () => void; onSaved: () => void }) {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const editable = can('compliance.certificate.manage');
  const [f, setF] = useState({
    type: cert?.type ?? 'HALAL',
    number: cert?.number ?? '',
    title: cert?.title ?? '',
    issuer: cert?.issuer ?? '',
    holder: cert?.holder ?? 'OWN',
    supplierId: cert?.supplierId ?? (null as string | null),
    issuedAt: cert?.issuedAt?.slice(0, 10) ?? '',
    expiresAt: cert?.expiresAt?.slice(0, 10) ?? '',
    tkdnValue: cert?.tkdnValue === null || cert?.tkdnValue === undefined ? '' : String(cert.tkdnValue),
    bmpValue: cert?.bmpValue === null || cert?.bmpValue === undefined ? '' : String(cert.bmpValue),
    scope: cert?.scope ?? '',
    notes: cert?.notes ?? '',
    isActive: cert?.isActive ?? true,
  });
  const [products, setProducts] = useState(cert?.products ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewNote, setReviewNote] = useState('');
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, supplierId: f.holder === 'SUPPLIER' ? f.supplierId : null, tkdnValue: f.type === 'TKDN' ? f.tkdnValue : null, bmpValue: f.type === 'TKDN' ? f.bmpValue : null, productIds: products.map((p) => p.id) };
      return cert ? api.put(`/compliance/certificates/${cert.id}`, body) : api.post('/compliance/certificates', body);
    },
    onSuccess: () => (toast.success('Certificate saved'), onSaved()),
    onError: (e: unknown) => {
      const errs = (e as { errors?: Record<string, string> })?.errors;
      if (errs) setErrors(errs);
      toast.error(e);
    },
  });
  const reviewed = useMutation({ mutationFn: () => api.post(`/compliance/certificates/${cert!.id}/reviewed`, { note: reviewNote || undefined }), onSuccess: () => (toast.success('Marked as reviewed'), onSaved()), onError: (e) => toast.error(e) });
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this certificate?', danger: true, confirmText: 'Delete' }))) return;
    try {
      await api.delete(`/compliance/certificates/${cert!.id}`);
      toast.success('Deleted');
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  };
  // scan of the certificate
  const files = useQuery({ queryKey: ['compliance', 'cert-files', cert?.id], enabled: !!cert && can('files.file.read'), queryFn: () => api.get<Paged<{ id: string; name: string }>>('/files', { entityType: 'CERTIFICATE', entityId: cert!.id, pageSize: 20 }) });
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = async (list: FileList | null) => {
    if (!list?.length || !cert) return;
    try {
      const fd = new FormData();
      Array.from(list).forEach((x) => fd.append('files', x));
      fd.append('entityType', 'CERTIFICATE');
      fd.append('entityId', cert.id);
      fd.append('categoryCode', 'LEGAL');
      await api.post('/files/upload', fd);
      toast.success('Scan attached');
      qc.invalidateQueries({ queryKey: ['compliance', 'cert-files', cert.id] });
    } catch (e) {
      toast.error(e);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const set = (k: keyof typeof f) => (v: unknown) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={cert ? cert.title : 'New certificate'}
      footer={
        editable ? (
          <div className="flex w-full items-center justify-between gap-2">
            {cert ? (
              <Button variant="ghost" icon="trash-2" onClick={remove}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <Button icon="check" loading={save.isPending} disabled={!f.number.trim() || !f.title.trim()} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        ) : undefined
      }
    >
      {cert?.reviewNeeded && (
        <div className="mb-4 rounded-lg bg-violet-50 p-3 text-sm text-violet-800">
          <p className="font-medium">Review needed</p>
          <p className="whitespace-pre-line text-xs">{cert.reviewReason}</p>
          <p className="mt-1 text-xs">A halal certificate stays valid only while ingredients and process are unchanged: report the new ingredient to the halal body (BPJPH) or confirm it was already covered.</p>
          {editable && (
            <div className="mt-2 flex gap-2">
              <Input value={reviewNote} maxLength={500} placeholder="What was checked / reported" onChange={(e) => setReviewNote(e.target.value)} />
              <Button size="sm" variant="outline" loading={reviewed.isPending} onClick={() => reviewed.mutate()}>
                Reviewed
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Type" required help={CERT_TYPES[f.type]?.hint}>
          <Select value={f.type} onChange={(e) => set('type')(e.target.value)} options={Object.entries(CERT_TYPES).map(([value, t]) => ({ value, label: t.label }))} />
        </Field>
        <Field label="Holder">
          <Select value={f.holder} onChange={(e) => set('holder')(e.target.value)} options={[{ value: 'OWN', label: 'Our company' }, { value: 'SUPPLIER', label: 'A supplier (for the materials it sells us)' }]} />
        </Field>
        {f.holder === 'SUPPLIER' && (
          <Field label="Supplier" required error={errors.supplierId} className="sm:col-span-2">
            <AsyncSelect resource="suppliers" value={f.supplierId} onChange={(v) => set('supplierId')(v)} initialLabel={cert?.supplier?.name} />
          </Field>
        )}
        <Field label="Certificate number" required error={errors.number}>
          <Input value={f.number} maxLength={100} onChange={(e) => set('number')(e.target.value)} />
        </Field>
        <Field label="Title" required help="e.g. Halal certificate - frozen nuggets">
          <Input value={f.title} maxLength={200} onChange={(e) => set('title')(e.target.value)} />
        </Field>
        <Field label="Issued by">
          <Input value={f.issuer} maxLength={150} placeholder="BPJPH, BPOM, LSPro..." onChange={(e) => set('issuer')(e.target.value)} />
        </Field>
        <div />
        <Field label="Issued on">
          <DatePicker value={f.issuedAt} onChange={(v) => set('issuedAt')(v ?? '')} />
        </Field>
        <Field label="Valid until" error={errors.expiresAt} help={f.type === 'HALAL' ? 'Leave empty: no fixed expiry while the composition is unchanged' : f.type === 'TKDN' ? '5 years from issue' : undefined}>
          <DatePicker value={f.expiresAt} onChange={(v) => set('expiresAt')(v ?? '')} />
        </Field>
        {f.type === 'TKDN' && (
          <>
            <Field label="TKDN value (%)" required error={errors.tkdnValue}>
              <NumberInput decimals={2} min={0} max={100} value={f.tkdnValue} onChange={set('tkdnValue')} />
            </Field>
            <Field label="BMP value (%)" help="Company benefit weight, if on the certificate">
              <NumberInput decimals={2} min={0} max={15} value={f.bmpValue} onChange={set('bmpValue')} />
            </Field>
          </>
        )}
        <Field label="Products covered" className="sm:col-span-2" help={f.holder === 'SUPPLIER' ? 'Our materials bought from this supplier that the certificate covers' : 'Our products covered by the certificate'}>
          <div className="space-y-2">
            {editable && <AsyncSelect resource="products" value={null} placeholder="Add a product..." onChange={(v, opt) => v && !products.some((p) => p.id === v) && setProducts([...products, { id: v, code: '', name: opt?.label ?? v }])} />}
            <div className="flex flex-wrap gap-1.5">
              {products.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs">
                  {p.name}
                  {editable && (
                    <button type="button" aria-label={`Remove ${p.name}`} className="text-slate-400 hover:text-red-600" onClick={() => setProducts(products.filter((x) => x.id !== p.id))}>
                      ×
                    </button>
                  )}
                </span>
              ))}
              {!products.length && <span className="text-xs text-slate-500">None yet</span>}
            </div>
          </div>
        </Field>
        <Field label="Scope" className="sm:col-span-2">
          <Textarea rows={2} maxLength={4000} value={f.scope} onChange={(e) => set('scope')(e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} maxLength={4000} value={f.notes} onChange={(e) => set('notes')(e.target.value)} />
        </Field>
        <Switch checked={f.isActive} onChange={set('isActive')} label="Active" />
      </div>
      {cert && can('files.file.read') && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Scan of the certificate</span>
            {can('files.file.upload') && (
              <>
                <input ref={fileInput} type="file" className="hidden" accept="application/pdf,image/*" onChange={(e) => upload(e.target.files)} />
                <Button size="sm" variant="outline" icon="paperclip" onClick={() => fileInput.current?.click()}>
                  Attach
                </Button>
              </>
            )}
          </div>
          {files.data?.data.length ? (
            <ul className="space-y-1 text-sm">
              {files.data.data.map((x) => (
                <li key={x.id}>
                  <button type="button" className="text-brand-600 hover:underline" onClick={() => download(`/files/${x.id}/download`).catch(toast.error)}>
                    {x.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">No scan attached.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

// ============================================================ TKDN
interface TkdnRow {
  id: string;
  number: string;
  date: string;
  status: string;
  product: { code: string; name: string } | null;
  productionMode: string;
  materialFactor: number;
  labourFactor: number;
  overheadFactor: number;
  brainware: number;
  tkdn: number;
}
const MODE: Record<string, string> = { OWN: 'Own (or rented) factory', OTHER_FACTORY: "Own workers in another firm's factory", OUTSOURCED: 'Made by another firm (maklon)' };

export function TkdnListPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['compliance', 'tkdn'], queryFn: () => api.get<TkdnRow[]>('/compliance/tkdn') });
  return (
    <div className="space-y-5">
      <PageHeader
        title="TKDN Self-assessment"
        subtitle="Local content of a product per Permenperin 35/2025: material 75%, labour 10%, factory overhead 15%, plus brainware. An estimate to prepare the certification by the verification body"
        actions={
          can('compliance.tkdn.manage') && (
            <Button icon="plus" onClick={() => navigate('/compliance/tkdn/new')}>
              New assessment
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !q.data?.length ? (
          <EmptyState icon="flag" title="No assessments yet" description="Start from a product: its bill of materials fills the components" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((r) => (
              <li key={r.id}>
                <Link to={`/compliance/tkdn/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {r.number} · {r.product?.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {fmtDate(r.date)} · material {fmtNumber(r.materialFactor, 2)}% · labour {r.labourFactor}% · overhead {r.overheadFactor}%{r.brainware ? ` · brainware +${fmtNumber(r.brainware, 2)}%` : ''}
                    </span>
                  </span>
                  <span className="text-base font-semibold">{fmtNumber(r.tkdn, 2)}%</span>
                  <Badge tone={r.status === 'FINAL' ? 'green' : 'gray'}>{r.status === 'FINAL' ? 'Final' : 'Draft'}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

interface TLine {
  productId: string | null;
  description: string;
  specification: string;
  uom: string;
  originCountry: string;
  qty: string;
  unitPrice: string;
  hasCertificate: boolean;
  certTkdn: string;
  domesticProducer: boolean;
  allDomesticMaterials: boolean;
}
interface TkdnDetail {
  id: string;
  number: string;
  status: string;
  date: string;
  productId: string;
  bomId: string | null;
  productType: string | null;
  specification: string | null;
  standard: string | null;
  productionMode: string;
  investedInIndonesia: boolean;
  directLabourTotal: number;
  directLabourWni: number;
  bwInvestment: number;
  bwUnit: number;
  bwProgram: number;
  bwImplementation: number;
  notes: string | null;
  product: { id: string; code: string; name: string } | null;
  company: { name: string; legalName: string | null; address: string | null } | null;
  lines: (Omit<TLine, 'qty' | 'unitPrice' | 'certTkdn' | 'specification' | 'uom'> & { qty: number; unitPrice: number; certTkdn: number | null; specification: string | null; uom: string | null; creditPct: number; share: number; cost: number; proportion: number })[];
  calc: { total: number; materialFactor: number; labourFactor: number; overheadFactor: number; materialTkdn: number; labourTkdn: number; overheadTkdn: number; goods: number; brainwareCriteria: number; brainware: number; tkdn: number; wniShare: number; warnings: string[] };
}

const blankLine = (): TLine => ({ productId: null, description: '', specification: '', uom: '', originCountry: 'ID', qty: '1', unitPrice: '0', hasCertificate: false, certTkdn: '', domesticProducer: true, allDomesticMaterials: false });

export function TkdnEditorPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['compliance', 'tkdn', id], enabled: !isNew, queryFn: () => api.get<TkdnDetail>(`/compliance/tkdn/${id}`) });
  const [h, setH] = useState({ productId: null as string | null, bomId: null as string | null, date: isoDate(), productType: '', specification: '', standard: '', productionMode: 'OWN', investedInIndonesia: true, directLabourTotal: '0', directLabourWni: '0', bwInvestment: '0', bwUnit: '0', bwProgram: '0', bwImplementation: '0', notes: '' });
  const [lines, setLines] = useState<TLine[]>([]);
  const [productLabel, setProductLabel] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const d = q.data;
    if (!d || loaded) return;
    setH({ productId: d.productId, bomId: d.bomId, date: d.date.slice(0, 10), productType: d.productType ?? '', specification: d.specification ?? '', standard: d.standard ?? '', productionMode: d.productionMode, investedInIndonesia: d.investedInIndonesia, directLabourTotal: String(d.directLabourTotal), directLabourWni: String(d.directLabourWni), bwInvestment: String(d.bwInvestment), bwUnit: String(d.bwUnit), bwProgram: String(d.bwProgram), bwImplementation: String(d.bwImplementation), notes: d.notes ?? '' });
    setLines(d.lines.map((l) => ({ productId: l.productId, description: l.description, specification: l.specification ?? '', uom: l.uom ?? '', originCountry: l.originCountry, qty: String(l.qty), unitPrice: String(l.unitPrice), hasCertificate: l.hasCertificate, certTkdn: l.certTkdn === null ? '' : String(l.certTkdn), domesticProducer: l.domesticProducer, allDomesticMaterials: l.allDomesticMaterials })));
    setProductLabel(d.product?.name ?? '');
    setLoaded(true);
  }, [q.data, loaded]);
  const final = q.data?.status === 'FINAL';
  const editable = can('compliance.tkdn.manage') && !final;

  const prefill = async (productId: string) => {
    try {
      const r = await api.get<{ bomId: string | null; bomCode: string | null; lines: (TLine & { qty: number; unitPrice: number; certTkdn: number | null; certNumber: string | null })[]; directLabourTotal: number; directLabourWni: number }>('/compliance/tkdn/prefill', { productId });
      setH((x) => ({ ...x, productId, bomId: r.bomId, directLabourTotal: String(r.directLabourTotal), directLabourWni: String(r.directLabourWni) }));
      setLines(r.lines.map((l) => ({ ...l, specification: l.specification ?? '', uom: l.uom ?? '', qty: String(l.qty), unitPrice: String(l.unitPrice), certTkdn: l.certTkdn === null ? '' : String(l.certTkdn) })));
      toast.success(r.bomId ? `Components taken from ${r.bomCode}` : 'This product has no bill of materials: add the components');
    } catch (e) {
      toast.error(e);
    }
  };

  // live calculation, same rules as the server
  const calc = useMemo(() => {
    const costs = lines.map((l) => Math.max(0, Number(l.qty || 0) * Number(l.unitPrice || 0)));
    const total = costs.reduce((a, b) => a + b, 0);
    const rows = lines.map((l, i) => {
      const credit = tkdnCredit({ ...l, certTkdn: l.certTkdn === '' ? null : Number(l.certTkdn) });
      const prop = total ? (costs[i] / total) * 100 : 0;
      return { cost: costs[i], prop, credit, share: (prop * credit) / 100 };
    });
    const material = rows.reduce((a, r) => a + r.share, 0);
    const tot = Number(h.directLabourTotal || 0);
    const wni = Number(h.directLabourWni || 0);
    const mode = h.productionMode === 'OWN' ? 100 : h.productionMode === 'OTHER_FACTORY' ? 60 : 30;
    const labour = tot > 0 && (wni / tot) * 100 >= 50 ? mode : 0;
    const overhead = h.investedInIndonesia ? mode : 0;
    const goods = material * 0.75 + labour * 0.1 + overhead * 0.15;
    const criteria = Number(h.bwInvestment) * 0.3 + Number(h.bwUnit) * 0.2 + Number(h.bwProgram) * 0.2 + Number(h.bwImplementation) * 0.3;
    const brainware = (criteria * 20) / 100;
    return { total, rows, material, labour, overhead, goods, criteria, brainware, tkdn: Math.min(100, goods + brainware), wniShare: tot ? (wni / tot) * 100 : 0 };
  }, [lines, h]);

  const body = () => ({ ...h, lines: lines.map((l) => ({ ...l, certTkdn: l.hasCertificate ? l.certTkdn : null })) });
  const save = useMutation({
    mutationFn: () => (isNew ? api.post<TkdnDetail>('/compliance/tkdn', body()) : api.put<TkdnDetail>(`/compliance/tkdn/${id}`, body())),
    onSuccess: (r) => {
      toast.success(`${r.number} saved: TKDN ${fmtNumber(r.calc.tkdn, 2)}%`);
      qc.invalidateQueries({ queryKey: ['compliance', 'tkdn'] });
      setLoaded(false);
      if (isNew) navigate(`/compliance/tkdn/${r.id}`, { replace: true });
    },
    onError: (e) => toast.error(e),
  });
  const finalise = useMutation({ mutationFn: () => api.post(`/compliance/tkdn/${id}/finalise`), onSuccess: () => (toast.success('Assessment finalised'), setLoaded(false), qc.invalidateQueries({ queryKey: ['compliance', 'tkdn'] })), onError: (e) => toast.error(e) });
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this draft?', danger: true, confirmText: 'Delete' }))) return;
    try {
      await api.delete(`/compliance/tkdn/${id}`);
      qc.invalidateQueries({ queryKey: ['compliance', 'tkdn'] });
      navigate('/compliance/tkdn');
    } catch (e) {
      toast.error(e);
    }
  };
  const copy = () => {
    setLoaded(true);
    navigate('/compliance/tkdn/new');
    toast.success('Copied into a new draft');
  };
  const print = () => {
    const d = q.data!;
    const c = d.calc;
    const pct = (v: number) => `${fmtNumber(v, 2)}%`;
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>TKDN ${esc(d.number)}</title><style>${PRINT_CSS}</style></head><body>
<b>${esc(d.company?.legalName || d.company?.name)}</b> <span class="muted">· ${esc(d.company?.address)}</span>
<h1>TKDN self-assessment ${esc(d.number)} (${d.status === 'FINAL' ? 'final' : 'draft'})</h1>
<div class="muted">Permenperin 35/2025 · product: <b>${esc(d.product?.name)}</b> ${esc(d.product?.code)} · type ${esc(d.productType)} · specification ${esc(d.specification)} · standard ${esc(d.standard)} · ${esc(fmtDate(d.date))}</div>
<h2>Form 1.1 - Direct material</h2>
<table><thead><tr><th>No</th><th>Component</th><th>Specification</th><th>Unit</th><th>Origin</th><th class="r">Qty</th><th class="r">Unit price (Rp)</th><th class="r">Cost (Rp)</th><th class="r">Proportion</th><th class="r">TKDN of component</th><th class="r">Domestic %</th><th class="r">Domestic content</th></tr></thead><tbody>
${d.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description)}</td><td>${esc(l.specification)}</td><td>${esc(l.uom)}</td><td>${esc(l.originCountry)}</td><td class="r">${esc(fmtNumber(l.qty))}</td><td class="r">${esc(fmtMoney(l.unitPrice, 0))}</td><td class="r">${esc(fmtMoney(l.cost, 0))}</td><td class="r">${pct(l.proportion)}</td><td class="r">${l.hasCertificate && l.certTkdn !== null ? pct(l.certTkdn) : l.originCountry === 'ID' ? '-' : '0%'}</td><td class="r">${pct(l.creditPct)}</td><td class="r">${pct(l.share)}</td></tr>`).join('')}
<tr class="b"><td colspan="7">Total</td><td class="r">${esc(fmtMoney(c.total, 0))}</td><td class="r">100%</td><td colspan="2">TKDN of the direct material factor</td><td class="r">${pct(c.materialFactor)}</td></tr></tbody></table>
<h2>Form 1.2 / 1.3 - Direct labour and factory overhead</h2>
<table><tbody><tr><td>Production</td><td>${esc(MODE[d.productionMode])}</td></tr><tr><td>Direct workers</td><td>${d.directLabourWni} Indonesian of ${d.directLabourTotal} (${pct(c.wniShare)})</td></tr><tr><td>Investment in Indonesia</td><td>${d.investedInIndonesia ? 'Yes' : 'No'}</td></tr></tbody></table>
<h2>Form 1.4 - Recapitulation</h2>
<table><thead><tr><th>Factor</th><th class="r">Weight</th><th class="r">Factor TKDN</th><th class="r">TKDN</th></tr></thead><tbody>
<tr><td>I. Direct material</td><td class="r">75%</td><td class="r">${pct(c.materialFactor)}</td><td class="r">${pct(c.materialTkdn)}</td></tr>
<tr><td>II. Direct labour</td><td class="r">10%</td><td class="r">${pct(c.labourFactor)}</td><td class="r">${pct(c.labourTkdn)}</td></tr>
<tr><td>III. Factory overhead</td><td class="r">15%</td><td class="r">${pct(c.overheadFactor)}</td><td class="r">${pct(c.overheadTkdn)}</td></tr>
<tr class="b"><td colspan="3">TKDN of the goods</td><td class="r">${pct(c.goods)}</td></tr></tbody></table>
${c.brainware ? `<h2>Brainware (Annex II, form 1.5)</h2><table><thead><tr><th>Criterion</th><th class="r">Weight</th><th class="r">Score</th><th class="r">Value</th></tr></thead><tbody>
<tr><td>R&amp;D investment in the last 5 years</td><td class="r">30%</td><td class="r">${pct(d.bwInvestment)}</td><td class="r">${pct(d.bwInvestment * 0.3)}</td></tr>
<tr><td>R&amp;D unit</td><td class="r">20%</td><td class="r">${pct(d.bwUnit)}</td><td class="r">${pct(d.bwUnit * 0.2)}</td></tr>
<tr><td>R&amp;D programme for products and processes</td><td class="r">20%</td><td class="r">${pct(d.bwProgram)}</td><td class="r">${pct(d.bwProgram * 0.2)}</td></tr>
<tr><td>Use of R&amp;D results in production</td><td class="r">30%</td><td class="r">${pct(d.bwImplementation)}</td><td class="r">${pct(d.bwImplementation * 0.3)}</td></tr>
<tr class="b"><td colspan="3">Total ${pct(c.brainwareCriteria)} x 20%</td><td class="r">${pct(c.brainware)}</td></tr></tbody></table>` : ''}
<h2>TKDN (goods + brainware, at most 100%): ${pct(c.tkdn)}</h2>
${c.warnings.length ? `<p>${c.warnings.map(esc).join('<br>')}</p>` : ''}
<p class="muted">Self-assessment for preparation only; the TKDN certificate is issued after verification by an appointed verification body.</p>
</body></html>`);
  };

  if (!isNew && (q.isLoading || !loaded))
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  const setL = (i: number, patch: Partial<TLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pct = (v: number) => `${fmtNumber(v, 2)}%`;
  return (
    <div className="space-y-5">
      <PageHeader
        title={isNew ? 'New TKDN assessment' : `${q.data!.number}`}
        subtitle={isNew ? 'Choose the product: its bill of materials fills the main components per unit' : `${q.data!.product?.name} · ${final ? 'final' : 'draft'}`}
        back={() => navigate('/compliance/tkdn')}
        actions={
          <div className="flex flex-wrap gap-2">
            {!isNew && (
              <Button variant="outline" icon="printer" onClick={print}>
                Print forms
              </Button>
            )}
            {!isNew && final && can('compliance.tkdn.manage') && (
              <Button variant="outline" icon="copy" onClick={copy}>
                Copy to new
              </Button>
            )}
            {!isNew && editable && (
              <>
                <Button variant="ghost" icon="trash-2" onClick={remove}>
                  Delete
                </Button>
                <Button variant="outline" icon="lock" loading={finalise.isPending} onClick={() => finalise.mutate()}>
                  Finalise
                </Button>
              </>
            )}
            {(isNew ? can('compliance.tkdn.manage') : editable) && (
              <Button icon="check" loading={save.isPending} disabled={!h.productId || !lines.length} onClick={() => save.mutate()}>
                Save
              </Button>
            )}
          </div>
        }
      />
      <Card bodyClass="p-0">
        <dl className="grid grid-cols-2 divide-line sm:grid-cols-3 xl:grid-cols-5 [&>div]:border-line [&>div]:px-4 [&>div]:py-3">
          {[
            { label: 'Material x 75%', value: pct(calc.material), hint: `= ${pct(calc.material * 0.75)}` },
            { label: 'Labour x 10%', value: pct(calc.labour), hint: `= ${pct(calc.labour * 0.1)}` },
            { label: 'Overhead x 15%', value: pct(calc.overhead), hint: `= ${pct(calc.overhead * 0.15)}` },
            { label: 'Brainware', value: `+${pct(calc.brainware)}`, hint: `${pct(calc.criteria)} x 20%` },
            { label: 'TKDN', value: pct(calc.tkdn), hint: `goods ${pct(calc.goods)}`, strong: true },
          ].map((x) => (
            <div key={x.label} className="border-b xl:border-b-0 xl:border-r last:border-r-0">
              <dt className="text-xs text-slate-500">{x.label}</dt>
              <dd className={x.strong ? (calc.tkdn >= 40 ? 'text-2xl font-semibold text-emerald-700' : calc.tkdn >= 25 ? 'text-2xl font-semibold text-amber-700' : 'text-2xl font-semibold text-red-700') : 'text-xl font-semibold'}>{x.value}</dd>
              <dd className="text-xs text-slate-500">{x.hint}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title="Product">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Product" required className="sm:col-span-2">
            <AsyncSelect
              resource="products"
              value={h.productId}
              initialLabel={productLabel}
              disabled={!editable && !isNew}
              onChange={(v, opt) => {
                if (!v) return;
                setProductLabel(opt?.label ?? '');
                prefill(v);
              }}
            />
          </Field>
          <Field label="Date">
            <DatePicker value={h.date} onChange={(v) => setH({ ...h, date: v ?? isoDate() })} />
          </Field>
          <Field label="Standard">
            <Input value={h.standard} maxLength={100} placeholder="SNI ..." onChange={(e) => setH({ ...h, standard: e.target.value })} />
          </Field>
          <Field label="Product type">
            <Input value={h.productType} maxLength={150} onChange={(e) => setH({ ...h, productType: e.target.value })} />
          </Field>
          <Field label="Specification" className="sm:col-span-3">
            <Input value={h.specification} maxLength={300} onChange={(e) => setH({ ...h, specification: e.target.value })} />
          </Field>
        </div>
      </Card>
      <Card
        title="Form 1.1 - Direct material (main components per unit)"
        subtitle="Certified components count by their TKDN band (above 80% = 100%, above 60% = 80%, above 40% = 60%, 25-40% = 40%, below 25% = 25%). Without certificate: made here from all-domestic materials or a domestic natural resource 100%, made here by an industrial company 25%, imported 0% (Art. 5)"
        bodyClass="p-0 overflow-x-auto"
        actions={
          editable && (
            <Button size="sm" variant="outline" icon="plus" onClick={() => setLines([...lines, blankLine()])}>
              Component
            </Button>
          )
        }
      >
        <table className={editable ? 'w-full min-w-[1000px] text-sm' : 'w-full min-w-[720px] text-sm'}>
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Component</th>
              <th className="px-2 py-2 text-left">Origin</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Unit price</th>
              <th className="px-2 py-2 text-left">TKDN certificate</th>
              <th className="px-2 py-2 text-left">Without certificate</th>
              <th className="px-2 py-2 text-right">Proportion</th>
              <th className="px-2 py-2 text-right">Credit</th>
              <th className="px-2 py-2 text-right">Domestic</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((l, i) => {
              const r = calc.rows[i];
              const dom = ['ID', 'IDN'].includes(l.originCountry.toUpperCase());
              if (!editable)
                return (
                  <tr key={i} className="align-top">
                    <td className="px-3 py-2">
                      {l.description}
                      <div className="text-xs text-slate-500">
                        {l.specification} {l.uom ? `· ${l.uom}` : ''}
                      </div>
                    </td>
                    <td className="px-2 py-2">{dom ? l.originCountry : <Badge tone="amber">{l.originCountry}</Badge>}</td>
                    <td className="px-2 py-2 text-right">{fmtNumber(l.qty)}</td>
                    <td className="px-2 py-2 text-right">{fmtMoney(l.unitPrice, 0)}</td>
                    <td className="px-2 py-2">{l.hasCertificate ? pct(Number(l.certTkdn || 0)) : '-'}</td>
                    <td className="px-2 py-2 text-xs text-slate-600">{!dom ? 'Imported' : l.hasCertificate ? '' : l.allDomesticMaterials ? 'All materials domestic' : l.domesticProducer ? 'Made by a domestic industry' : 'Not made by a domestic industry'}</td>
                    <td className="px-2 py-2 text-right">{pct(r?.prop ?? 0)}</td>
                    <td className="px-2 py-2 text-right">{r?.credit ?? 0}%</td>
                    <td className="px-2 py-2 text-right font-medium">{pct(r?.share ?? 0)}</td>
                    <td />
                  </tr>
                );
              return (
                <tr key={i} className="align-top">
                  <td className="min-w-[12rem] px-3 py-2">
                    <Input value={l.description} maxLength={200} onChange={(e) => setL(i, { description: e.target.value })} />
                    <div className="mt-1 text-xs text-slate-500">
                      {l.specification} {l.uom ? `· ${l.uom}` : ''}
                    </div>
                  </td>
                  <td className="w-20 px-2 py-2">
                    <Input value={l.originCountry} maxLength={3} onChange={(e) => setL(i, { originCountry: e.target.value.toUpperCase() })} aria-label="Country of origin" />
                  </td>
                  <td className="w-24 px-2 py-2">
                    <NumberInput value={l.qty} min={0} onChange={(v) => setL(i, { qty: v })} aria-label="Quantity" />
                  </td>
                  <td className="w-32 px-2 py-2">
                    <NumberInput value={l.unitPrice} decimals={2} min={0} onChange={(v) => setL(i, { unitPrice: v })} aria-label="Unit price" />
                  </td>
                  <td className="w-32 px-2 py-2">
                    <Checkbox checked={l.hasCertificate} disabled={!dom} onChange={(v) => setL(i, { hasCertificate: v })} label="Has one" />
                    {l.hasCertificate && <NumberInput className="mt-1" decimals={2} min={0} max={100} value={l.certTkdn} placeholder="TKDN %" onChange={(v) => setL(i, { certTkdn: v })} aria-label="TKDN on the certificate" />}
                  </td>
                  <td className="w-52 px-2 py-2">
                    {dom && !l.hasCertificate ? (
                      <div className="space-y-1">
                        <Checkbox checked={l.domesticProducer} onChange={(v) => setL(i, { domesticProducer: v })} label="Made here by an industrial company" />
                        <Checkbox checked={l.allDomesticMaterials} onChange={(v) => setL(i, { allDomesticMaterials: v })} label="All its materials domestic / natural resource" />
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">{dom ? '-' : 'Imported'}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">{pct(r?.prop ?? 0)}</td>
                  <td className="px-2 py-2 text-right">{r?.credit ?? 0}%</td>
                  <td className="px-2 py-2 text-right font-medium">{pct(r?.share ?? 0)}</td>
                  <td className="px-2 py-2">
                    {editable && (
                      <Button variant="ghost" size="icon" icon="x" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))} />
                    )}
                  </td>
                </tr>
              );
            })}
            {!lines.length && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-slate-500">
                  Choose the product to load its components, or add them.
                </td>
              </tr>
            )}
          </tbody>
          {lines.length > 0 && (
            <tfoot className="bg-slate-50 font-medium">
              <tr>
                <td className="px-3 py-2" colSpan={6}>
                  Total cost {fmtMoney(calc.total, 0)}
                </td>
                <td className="px-2 py-2 text-right">100%</td>
                <td />
                <td className="px-2 py-2 text-right">{pct(calc.material)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Forms 1.2 / 1.3 - Labour and factory overhead" subtitle="100% own (or rented) factory, 60% own workers in another firm's factory, 30% made by another firm; labour 0% if fewer than half the direct workers are Indonesian, overhead 0% without investment in Indonesia (Art. 6-7)">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Where it is produced" className="sm:col-span-2">
              <Select value={h.productionMode} disabled={!editable} onChange={(e) => setH({ ...h, productionMode: e.target.value })} options={Object.entries(MODE).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="Direct workers" help="Operators, welders, helpers, QC, foremen - not management">
              <NumberInput decimals={0} min={0} value={h.directLabourTotal} disabled={!editable} onChange={(v) => setH({ ...h, directLabourTotal: v })} />
            </Field>
            <Field label="of whom Indonesian" help={`${fmtNumber(calc.wniShare, 1)}% Indonesian`}>
              <NumberInput decimals={0} min={0} value={h.directLabourWni} disabled={!editable} onChange={(v) => setH({ ...h, directLabourWni: v })} />
            </Field>
            <Switch checked={h.investedInIndonesia} disabled={!editable} onChange={(v) => setH({ ...h, investedInIndonesia: v })} label="We invested in Indonesia (deed, NIB, LKPM)" />
          </div>
        </Card>
        <Card title="Brainware (optional)" subtitle="Score each criterion 0-100%; the weighted total x 20% is added (Art. 10-11, Annex II)">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="R&D investment, last 5 years (30%)">
              <NumberInput decimals={2} min={0} max={100} value={h.bwInvestment} disabled={!editable} onChange={(v) => setH({ ...h, bwInvestment: v })} />
            </Field>
            <Field label="R&D unit (20%)">
              <NumberInput decimals={2} min={0} max={100} value={h.bwUnit} disabled={!editable} onChange={(v) => setH({ ...h, bwUnit: v })} />
            </Field>
            <Field label="R&D programme (20%)">
              <NumberInput decimals={2} min={0} max={100} value={h.bwProgram} disabled={!editable} onChange={(v) => setH({ ...h, bwProgram: v })} />
            </Field>
            <Field label="R&D results used in production (30%)">
              <NumberInput decimals={2} min={0} max={100} value={h.bwImplementation} disabled={!editable} onChange={(v) => setH({ ...h, bwImplementation: v })} />
            </Field>
          </div>
        </Card>
      </div>
      {q.data?.calc.warnings.length ? (
        <Card title="Notes">
          <ul className="list-disc pl-5 text-sm text-amber-700">
            {q.data.calc.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title="Notes">
        <Textarea rows={2} maxLength={4000} value={h.notes} disabled={!editable} onChange={(e) => setH({ ...h, notes: e.target.value })} />
        <p className="mt-2 text-xs text-slate-500">A self-assessment to prepare the application; the TKDN certificate (valid 5 years) is issued after verification by an appointed verification body through SIINas.</p>
      </Card>
    </div>
  );
}
