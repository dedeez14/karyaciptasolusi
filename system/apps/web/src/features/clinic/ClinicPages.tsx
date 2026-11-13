import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import { Checkbox, Tabs, type Tone } from '@/components/ui/primitives';

const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const Loading = () => (
  <div className="flex justify-center py-10">
    <Spinner />
  </div>
);
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const num = (v: string) => Number(v || 0);
const STATUS: Record<string, { label: string; tone: Tone }> = {
  WAITING: { label: 'Waiting', tone: 'gray' },
  IN_EXAM: { label: 'In examination', tone: 'blue' },
  DONE: { label: 'To bill', tone: 'amber' },
  BILLED: { label: 'Billed', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
};
const PAYER: Record<string, string> = { GENERAL: 'General (self-pay)', BPJS: 'BPJS Kesehatan', INSURANCE: 'Insurance', CORPORATE: 'Company' };
const PROF: Record<string, string> = { DOCTOR: 'Doctor', DENTIST: 'Dentist', MIDWIFE: 'Midwife', NURSE: 'Nurse', OTHER: 'Other' };

interface Setup {
  config: { id: string; name: string; facilityCode: string | null; pharmacyWarehouseId: string | null; warehouse: { id: string; code: string; name: string } | null };
  practitioners: {
    id: string;
    name: string;
    profession: string;
    strNo: string | null;
    strExpiry: string | null;
    sipNo: string | null;
    sipExpiry: string | null;
    employeeId: string | null;
    isEmployee: boolean;
    feePct: number;
    isActive: boolean;
    licenceDue: boolean;
  }[];
  services: { id: string; code: string; name: string; kind: string; price: number; feeable: boolean; isActive: boolean }[];
  controlled: { id: string; productId: string; class: string; product: { id: string; code: string; name: string } | null }[];
}
interface Patient {
  id: string;
  rmNumber: string;
  name: string;
  sex: string;
  birthDate: string;
  age: number;
  nik: string | null;
  bpjsNo: string | null;
  phone: string | null;
  address: string | null;
  allergies: string | null;
  bloodType: string | null;
  isActive: boolean;
}

// ============================================================ queue
interface QueueRow {
  id: string;
  number: string;
  queueNo: number;
  date: string;
  status: string;
  payer: string;
  patient: { id: string; rmNumber: string; name: string; sex: string; age: number } | null;
  practitioner: string | null;
  invoice: { id: string; number: string; grandTotal: number | string; paidAmount: number | string } | null;
}

export function QueuePage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [date, setDate] = useState(isoDate());
  const [reg, setReg] = useState(false);
  const q = useQuery({ queryKey: ['clinic', 'queue', date], queryFn: () => api.get<QueueRow[]>('/clinic/queue', { date }) });
  const act = useMutation({ mutationFn: (path: string) => api.post(path), onSuccess: () => (toast.success('Done'), qc.invalidateQueries({ queryKey: ['clinic'] })), onError: (e) => toast.error(e) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Registration & Queue"
        subtitle="Patients registered to a practitioner with a valid SIP; examination with the electronic medical record (Permenkes 24/2022); billing: medical services PPN-exempt, medicines with PPN"
        actions={
          <div className="flex gap-2">
            <div className="w-40">
              <DatePicker value={date} clearable={false} onChange={(v) => setDate(v ?? isoDate())} aria-label="Date" />
            </div>
            {can('clinic.register') && (
              <Button icon="plus" onClick={() => setReg(true)}>
                Register visit
              </Button>
            )}
          </div>
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="clipboard-plus" title="No visits on this day" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 font-semibold">{v.queueNo}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {v.patient?.name} · {v.patient?.rmNumber}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {v.patient?.sex === 'F' ? 'F' : 'M'} {v.patient?.age} y · {v.practitioner} · {PAYER[v.payer]} {v.invoice ? `· ${v.invoice.number} ${fmtMoney(v.invoice.grandTotal, 0)}` : ''}
                  </span>
                </span>
                <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
                {v.status !== 'CANCELLED' && can('clinic.records') && (
                  <Button size="sm" variant="outline" icon="stethoscope" onClick={() => navigate(`/clinic/visits/${v.id}`)}>
                    {v.status === 'BILLED' ? 'Record' : 'Examine'}
                  </Button>
                )}
                {v.status === 'DONE' && can('clinic.billing') && (
                  <Button size="sm" icon="receipt" loading={act.isPending} onClick={() => act.mutate(`/clinic/visits/${v.id}/bill`)}>
                    Bill
                  </Button>
                )}
                {v.status === 'BILLED' && can('clinic.billing') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="undo"
                    onClick={async () =>
                      (await confirm({ title: `Undo the billing of ${v.number}?`, message: 'The invoice and the dispensing are cancelled (only while unpaid).', danger: true, confirmText: 'Undo' })) &&
                      act.mutate(`/clinic/visits/${v.id}/unbill`)
                    }
                  />
                )}
                {['WAITING', 'IN_EXAM'].includes(v.status) && can('clinic.register') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="x"
                    aria-label="Cancel visit"
                    onClick={async () => (await confirm({ title: `Cancel ${v.number}?`, danger: true, confirmText: 'Cancel visit' })) && act.mutate(`/clinic/visits/${v.id}/cancel`)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {reg && <RegisterForm date={date} onClose={() => setReg(false)} onSaved={() => (setReg(false), qc.invalidateQueries({ queryKey: ['clinic'] }))} />}
    </div>
  );
}

function PatientPicker({ value, onChange }: { value: Patient | null; onChange: (p: Patient | null) => void }) {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['clinic', 'patients', q], queryFn: () => api.get<Patient[]>('/clinic/patients', q ? { q } : {}), enabled: q.length >= 2 && !value });
  if (value)
    return (
      <div className="flex items-center gap-2 rounded border border-line px-3 py-2 text-sm">
        <span className="flex-1">
          {value.rmNumber} · {value.name} · {value.sex} {value.age} y
        </span>
        <Button size="sm" variant="ghost" icon="x" aria-label="Change patient" onClick={() => onChange(null)} />
      </div>
    );
  return (
    <div>
      <Input placeholder="Name or RM number (2+ letters)" value={q} onChange={(e) => setQ(e.target.value)} />
      {(list.data ?? []).length > 0 && (
        <ul className="mt-1 max-h-48 divide-y divide-line overflow-y-auto rounded border border-line text-sm">
          {list.data!.map((p) => (
            <li key={p.id}>
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => onChange(p)}>
                {p.rmNumber} · {p.name} · {p.sex} {p.age} y {p.bpjsNo ? '· JKN' : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RegisterForm({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
  const setup = useQuery({ queryKey: ['clinic', 'setup'], queryFn: () => api.get<Setup>('/clinic/setup') });
  const [patient, setPatient] = useState<Patient | null>(null);
  const [newP, setNewP] = useState(false);
  const [f, setF] = useState({ practitionerId: '', payer: 'GENERAL', customerId: null as string | null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.post<QueueRow>('/clinic/visits', { ...f, patientId: patient!.id, date }),
    onSuccess: (r) => (toast.success(`Queue number ${r.queueNo}`), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Register a visit · ${fmtDate(date)}`}
      footer={
        <Button icon="check" disabled={!patient || !f.practitionerId} loading={save.isPending} onClick={() => save.mutate()}>
          Register
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Patient" required error={errors.patientId} className="sm:col-span-2">
          <PatientPicker value={patient} onChange={setPatient} />
        </Field>
        {!patient && (
          <div className="sm:col-span-2">
            <Button size="sm" variant="outline" icon="plus" onClick={() => setNewP(true)}>
              New patient
            </Button>
          </div>
        )}
        <Field label="Practitioner" required error={errors.practitionerId}>
          <Select
            value={f.practitionerId}
            placeholder="Choose"
            onChange={(e) => setF({ ...f, practitionerId: e.target.value })}
            options={(setup.data?.practitioners ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.name} · ${PROF[p.profession]}${p.licenceDue ? ' (licence due)' : ''}` }))}
          />
        </Field>
        <Field label="Payer" error={errors.payer}>
          <Select value={f.payer} onChange={(e) => setF({ ...f, payer: e.target.value })} options={Object.entries(PAYER).map(([value, label]) => ({ value, label }))} />
        </Field>
        {['INSURANCE', 'CORPORATE'].includes(f.payer) && (
          <Field label="Insurer / company billed" required error={errors.customerId} className="sm:col-span-2">
            <AsyncSelect resource="customers" value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} />
          </Field>
        )}
      </div>
      {newP && <PatientForm onClose={() => setNewP(false)} onSaved={(p) => (setPatient(p), setNewP(false))} />}
    </Modal>
  );
}

// ============================================================ visit (medical record)
interface Visit {
  id: string;
  number: string;
  date: string;
  status: string;
  payer: string;
  subjective: string | null;
  objective: string | null;
  plan: string | null;
  vitals: Record<string, string> | null;
  diagnoses: { code: string; name: string; primary: boolean }[] | null;
  referral: string | null;
  followUp: string | null;
  practitionerFee: number;
  patient: Patient;
  practitioner: { id: string; name: string; profession: string; feePct: number; isEmployee: boolean } | null;
  customer: { id: string; name: string } | null;
  invoice: { id: string; number: string; status: string; grandTotal: number; taxTotal: number; paidAmount: number } | null;
  items: {
    id: string;
    kind: string;
    serviceId: string | null;
    productId: string | null;
    description: string;
    qty: number;
    price: number;
    dosage: string | null;
    code: string | null;
    controlled: string | null;
  }[];
}
const VITALS: [string, string][] = [
  ['bp', 'Blood pressure'],
  ['hr', 'Pulse /min'],
  ['temp', 'Temp °C'],
  ['rr', 'Resp /min'],
  ['weight', 'Weight kg'],
  ['height', 'Height cm'],
  ['spo2', 'SpO2 %'],
];

export function VisitPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['clinic', 'visit', id], queryFn: () => api.get<Visit>(`/clinic/visits/${id}`), staleTime: Infinity });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <EmptyState icon="stethoscope" title="Visit not found" />;
  return <VisitForm key={`${q.data.id}-${q.data.status}`} v={q.data} />;
}

function VisitForm({ v }: { v: Visit }) {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setup = useQuery({ queryKey: ['clinic', 'setup'], queryFn: () => api.get<Setup>('/clinic/setup') });
  const editable = ['WAITING', 'IN_EXAM', 'DONE'].includes(v.status) && can('clinic.records');
  const [f, setF] = useState({ subjective: v.subjective ?? '', objective: v.objective ?? '', plan: v.plan ?? '', referral: v.referral ?? '', followUp: v.followUp });
  const [vitals, setVitals] = useState<Record<string, string>>(v.vitals ?? {});
  const [dx, setDx] = useState(v.diagnoses?.length ? v.diagnoses : [{ code: '', name: '', primary: true }]);
  const [items, setItems] = useState(
    v.items.map((i) => ({
      kind: i.kind,
      serviceId: i.serviceId ?? '',
      productId: i.productId,
      label: `${i.code ?? ''} - ${i.description}`,
      qty: str(i.qty),
      price: str(i.price),
      dosage: i.dosage ?? '',
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (finish: boolean) =>
      api.put<Visit>(`/clinic/visits/${v.id}/exam`, {
        ...f,
        vitals,
        diagnoses: dx.filter((d) => d.code),
        items: items.map((i) => ({
          kind: i.kind,
          serviceId: i.kind === 'SERVICE' ? i.serviceId : null,
          productId: i.kind === 'DRUG' ? i.productId : null,
          qty: i.qty || 1,
          price: i.price === '' ? null : i.price,
          dosage: i.dosage,
        })),
        finish,
      }),
    onSuccess: (r) => (
      toast.success(r.status === 'DONE' ? 'Examination finished' : 'Saved'),
      setErrors({}),
      qc.invalidateQueries({ queryKey: ['clinic'] }),
      r.status === 'DONE' && navigate('/clinic/queue')
    ),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const services = setup.data?.services.filter((s) => s.isActive) ?? [];
  const setItem = (k: number, patch: Partial<(typeof items)[number]>) => setItems(items.map((x, j) => (j === k ? { ...x, ...patch } : x)));
  const total = items.reduce((s, i) => s + num(i.qty) * num(i.price), 0);
  return (
    <div className="space-y-5">
      <PageHeader
        title={`${v.patient.name} · ${v.patient.rmNumber}`}
        subtitle={`${v.patient.sex === 'F' ? 'Female' : 'Male'}, ${v.patient.age} y${v.patient.bloodType ? `, blood ${v.patient.bloodType}` : ''} · ${v.number} · ${fmtDate(v.date)} · ${v.practitioner?.name ?? ''} · ${PAYER[v.payer]}${v.customer ? ` (${v.customer.name})` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
            {editable && (
              <>
                <Button variant="outline" icon="save" loading={save.isPending} onClick={() => save.mutate(false)}>
                  Save
                </Button>
                <Button icon="check" loading={save.isPending} onClick={() => save.mutate(true)}>
                  Finish examination
                </Button>
              </>
            )}
          </div>
        }
      />
      {v.patient.allergies && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          <b>Allergies:</b> {v.patient.allergies}
        </div>
      )}
      <Card title="Vital signs">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {VITALS.map(([k, label]) => (
            <Field key={k} label={label}>
              <Input disabled={!editable} value={vitals[k] ?? ''} maxLength={10} onChange={(e) => setVitals({ ...vitals, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card title="S · Complaint">
          <Textarea disabled={!editable} rows={5} value={f.subjective} maxLength={4000} onChange={(e) => setF({ ...f, subjective: e.target.value })} />
        </Card>
        <Card title="O · Examination">
          <Textarea disabled={!editable} rows={5} value={f.objective} maxLength={4000} onChange={(e) => setF({ ...f, objective: e.target.value })} />
        </Card>
        <Card title="P · Plan">
          <Textarea disabled={!editable} rows={5} value={f.plan} maxLength={4000} onChange={(e) => setF({ ...f, plan: e.target.value })} />
        </Card>
      </div>
      <Card title="A · Diagnoses (ICD-10)">
        {errors.diagnoses && <p className="mb-2 text-xs text-red-600">{errors.diagnoses}</p>}
        <div className="space-y-2">
          {dx.map((d, k) => (
            <div key={k} className="grid grid-cols-[7rem_minmax(0,1fr)_8rem_2.5rem] items-center gap-2">
              <Input
                disabled={!editable}
                value={d.code}
                placeholder="J06.9"
                maxLength={8}
                onChange={(e) => setDx(dx.map((x, j) => (j === k ? { ...x, code: e.target.value.toUpperCase() } : x)))}
                aria-label="ICD-10 code"
              />
              <Input
                disabled={!editable}
                value={d.name}
                placeholder="Diagnosis"
                maxLength={200}
                onChange={(e) => setDx(dx.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)))}
                aria-label="Diagnosis"
              />
              <label className="flex items-center gap-1 text-xs">
                <input type="radio" disabled={!editable} checked={d.primary} onChange={() => setDx(dx.map((x, j) => ({ ...x, primary: j === k })))} /> primary
              </label>
              {editable && <Button variant="ghost" size="icon" icon="x" aria-label="Remove diagnosis" onClick={() => setDx(dx.filter((_, j) => j !== k))} />}
            </div>
          ))}
        </div>
        {editable && (
          <Button size="sm" variant="outline" icon="plus" className="mt-2" onClick={() => setDx([...dx, { code: '', name: '', primary: !dx.length }])}>
            Diagnosis
          </Button>
        )}
      </Card>
      <Card title={`Services & prescription · ${fmtMoney(total, 0)}`}>
        {errors.items && <p className="mb-2 text-xs text-red-600">{errors.items}</p>}
        <div className="space-y-2">
          {items.map((i, k) => (
            <div key={k} className="grid grid-cols-1 gap-2 rounded border border-line p-2 sm:grid-cols-[7rem_minmax(0,2fr)_5rem_8rem_minmax(0,1.5fr)_2.5rem]">
              <Select
                disabled={!editable}
                value={i.kind}
                onChange={(e) => setItem(k, { kind: e.target.value, serviceId: '', productId: null, label: '' })}
                options={[
                  { value: 'SERVICE', label: 'Service' },
                  { value: 'DRUG', label: 'Medicine' },
                ]}
                aria-label="Kind"
              />
              {i.kind === 'SERVICE' ? (
                <Select
                  disabled={!editable}
                  value={i.serviceId}
                  placeholder="Tariff"
                  onChange={(e) => setItem(k, { serviceId: e.target.value, price: str(services.find((s) => s.id === e.target.value)?.price) })}
                  options={services.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
                  aria-label="Tariff"
                />
              ) : (
                <AsyncSelect
                  disabled={!editable}
                  resource="products"
                  value={i.productId}
                  initialLabel={i.label || undefined}
                  onChange={(val, o) => setItem(k, { productId: val, label: o?.label ?? '' })}
                  aria-label="Medicine"
                />
              )}
              <NumberInput disabled={!editable} decimals={2} min={0} value={i.qty} onChange={(x) => setItem(k, { qty: x })} aria-label="Quantity" />
              <NumberInput disabled={!editable} decimals={0} min={0} value={i.price} placeholder="price" onChange={(x) => setItem(k, { price: x })} aria-label="Price" />
              <Input
                disabled={!editable || i.kind !== 'DRUG'}
                value={i.dosage}
                placeholder={i.kind === 'DRUG' ? 'Signa, e.g. 3 x 1 after meals' : ''}
                maxLength={120}
                onChange={(e) => setItem(k, { dosage: e.target.value })}
                aria-label="Signa"
              />
              {editable && <Button variant="ghost" size="icon" icon="x" aria-label="Remove line" onClick={() => setItems(items.filter((_, j) => j !== k))} />}
            </div>
          ))}
        </div>
        {editable && (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" icon="plus" onClick={() => setItems([...items, { kind: 'SERVICE', serviceId: '', productId: null, label: '', qty: '1', price: '', dosage: '' }])}>
              Service
            </Button>
            <Button size="sm" variant="outline" icon="pill" onClick={() => setItems([...items, { kind: 'DRUG', serviceId: '', productId: null, label: '', qty: '1', price: '', dosage: '' }])}>
              Medicine
            </Button>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">Empty price: the tariff / the medicine's sale price. Medicines are dispensed from the pharmacy (earliest expiry first) when the visit is billed.</p>
      </Card>
      <Card title="Referral & follow-up">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Referral" className="sm:col-span-2">
            <Input disabled={!editable} value={f.referral} maxLength={300} onChange={(e) => setF({ ...f, referral: e.target.value })} />
          </Field>
          <Field label="Follow-up">
            <DatePicker disabled={!editable} value={f.followUp} onChange={(x) => setF({ ...f, followUp: x })} />
          </Field>
        </div>
      </Card>
      {v.invoice && (
        <Card bodyClass="px-4 py-3 text-sm">
          Invoice{' '}
          <Link className="text-brand-600" to={`/documents/SI/${v.invoice.id}`}>
            {v.invoice.number}
          </Link>{' '}
          · {fmtMoney(v.invoice.grandTotal, 0)} (PPN {fmtMoney(v.invoice.taxTotal, 0)}) · paid {fmtMoney(v.invoice.paidAmount, 0)}
        </Card>
      )}
      <p className="text-xs text-slate-500">Medical record: kept at least 25 years from the last visit (Permenkes 24/2022); the notes are stored encrypted and every read is logged.</p>
    </div>
  );
}

// ============================================================ patients
export function PatientsPage() {
  const can = useSession((s) => s.can);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Patient | 'new' | null>(null);
  const [view, setView] = useState<string | null>(null);
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['clinic', 'patients', 'list', q], queryFn: () => api.get<Patient[]>('/clinic/patients', q ? { q } : {}) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Patients"
        subtitle="Medical record numbers with the identity stored encrypted; the history and allergies only for those who may read the medical record"
        actions={
          can('clinic.register') && (
            <Button icon="plus" onClick={() => setEdit('new')}>
              New patient
            </Button>
          )
        }
      />
      <div className="w-72">
        <Input placeholder="Search name or RM number" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card bodyClass="p-0">
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.length ? (
          <EmptyState icon="user-round" title="No patients" />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((p) => (
              <li key={p.id}>
                <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50" onClick={() => setView(p.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {p.rmNumber} · {p.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {p.sex === 'F' ? 'F' : 'M'} {p.age} y · born {fmtDate(p.birthDate)} {p.nik ? `· NIK ${p.nik}` : ''} {p.bpjsNo ? `· JKN ${p.bpjsNo}` : ''}
                    </span>
                  </span>
                  {p.allergies && <Badge tone="red">allergy</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {view && <PatientView id={view} onClose={() => setView(null)} onEdit={(p) => (setView(null), setEdit(p))} />}
      {edit && <PatientForm p={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['clinic'] }))} />}
    </div>
  );
}

function PatientView({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (p: Patient) => void }) {
  const can = useSession((s) => s.can);
  const q = useQuery({
    queryKey: ['clinic', 'patient', id],
    queryFn: () =>
      api.get<
        Patient & {
          visits: { id: string; number: string; date: string; status: string; payer: string; practitioner: string | null; diagnoses: { code: string; name: string; primary: boolean }[] | null }[];
        }
      >(`/clinic/patients/${id}`),
  });
  const p = q.data;
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={p ? `${p.rmNumber} · ${p.name}` : 'Patient'}
      footer={
        p &&
        can('clinic.register') && (
          <Button variant="outline" icon="pencil" onClick={() => onEdit(p)}>
            Edit
          </Button>
        )
      }
    >
      {!p ? (
        <Loading />
      ) : (
        <div className="space-y-3 text-sm">
          <p>
            {p.sex === 'F' ? 'Female' : 'Male'}, {p.age} y · {p.phone ?? ''} · {p.address ?? ''}
          </p>
          {p.allergies && <p className="text-red-700">Allergies: {p.allergies}</p>}
          <ul className="divide-y divide-line rounded border border-line">
            {p.visits.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                {can('clinic.records') ? (
                  <Link to={`/clinic/visits/${v.id}`} className="flex-1 text-brand-600">
                    {fmtDate(v.date)} · {v.practitioner}
                  </Link>
                ) : (
                  <span className="flex-1">
                    {fmtDate(v.date)} · {v.practitioner}
                  </span>
                )}
                <span className="text-xs text-slate-500">{v.diagnoses ? v.diagnoses.map((d) => `${d.code} ${d.name}`).join('; ') : 'medical record restricted'}</span>
                <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
              </li>
            ))}
            {!p.visits.length && <li className="px-3 py-2 text-slate-500">No visits yet.</li>}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function PatientForm({ p, onClose, onSaved }: { p?: Patient; onClose: () => void; onSaved: (p: Patient) => void }) {
  const can = useSession((s) => s.can);
  const [f, setF] = useState({
    name: p?.name ?? '',
    sex: p?.sex ?? 'F',
    birthDate: p?.birthDate ?? (null as string | null),
    nik: '',
    bpjsNo: '',
    phone: p?.phone ?? '',
    address: p?.address ?? '',
    allergies: '',
    bloodType: p?.bloodType ?? '',
    isActive: p?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => (p ? api.put<Patient>(`/clinic/patients/${p.id}`, f) : api.post<Patient>('/clinic/patients', f)),
    onSuccess: (r) => (toast.success(`${r.rmNumber} saved`), onSaved(r)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={p ? `${p.rmNumber} · ${p.name}` : 'New patient'}
      footer={
        <Button icon="check" disabled={!f.name || !f.birthDate} loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2">
          <Input value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Sex">
          <Select
            value={f.sex}
            onChange={(e) => setF({ ...f, sex: e.target.value })}
            options={[
              { value: 'F', label: 'Female' },
              { value: 'M', label: 'Male' },
            ]}
          />
        </Field>
        <Field label="Born" required error={errors.birthDate}>
          <DatePicker value={f.birthDate} onChange={(v) => setF({ ...f, birthDate: v })} />
        </Field>
        <Field label="NIK" error={errors.nik} help={p?.nik ? `Stored ${p.nik} (empty keeps it)` : '16 digits, stored encrypted'}>
          <Input value={f.nik} maxLength={16} onChange={(e) => setF({ ...f, nik: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="JKN / BPJS card" error={errors.bpjsNo} help={p?.bpjsNo ? `Stored ${p.bpjsNo}` : '13 digits'}>
          <Input value={f.bpjsNo} maxLength={13} onChange={(e) => setF({ ...f, bpjsNo: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} maxLength={30} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Blood type">
          <Input value={f.bloodType} maxLength={3} onChange={(e) => setF({ ...f, bloodType: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input value={f.address} maxLength={300} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
        {can('clinic.records') && (
          <Field label="Allergies" className="sm:col-span-2" help={p?.allergies ? `Stored: ${p.allergies} (empty keeps it)` : 'Medical record: stored encrypted'}>
            <Input value={f.allergies} maxLength={1000} onChange={(e) => setF({ ...f, allergies: e.target.value })} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ============================================================ set-up
export function SetupPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['clinic', 'setup'], queryFn: () => api.get<Setup>('/clinic/setup') });
  const [pe, setPe] = useState<Setup['practitioners'][number] | 'new' | null>(null);
  const [se, setSe] = useState<Setup['services'][number] | 'new' | null>(null);
  const [ctrl, setCtrl] = useState({ productId: null as string | null, class: 'PSIKOTROPIKA' });
  const ro = !can('clinic.setup');
  const refresh = () => qc.invalidateQueries({ queryKey: ['clinic'] });
  const act = useMutation({
    mutationFn: (x: { path: string; body: unknown; put?: boolean }) => (x.put ? api.put(x.path, x.body) : api.post(x.path, x.body)),
    onSuccess: () => (toast.success('Saved'), refresh()),
    onError: (e) => toast.error(e),
  });
  const s = q.data;
  if (!s) return <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Practitioners & Tariffs"
        subtitle="Practitioners with their STR and SIP (a visit needs a valid SIP), fee share and payroll status; service tariffs; the pharmacy warehouse; medicines under SIPNAP reporting"
      />
      <ClinicConfigCard key={s.config.id} c={s.config} ro={ro} onSave={(body) => act.mutate({ path: '/clinic/config', body, put: true })} />
      <Card
        title="Practitioners"
        bodyClass="p-0"
        actions={
          !ro && (
            <Button size="sm" icon="plus" onClick={() => setPe('new')}>
              Practitioner
            </Button>
          )
        }
      >
        {!s.practitioners.length ? (
          <p className="px-4 py-3 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {s.practitioners.map((p) => (
              <li key={p.id}>
                <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50" onClick={() => setPe(p)}>
                  <span className="min-w-0 flex-1">
                    {p.name} · {PROF[p.profession]}
                    <span className="block text-xs text-slate-500">
                      STR {p.strNo ?? '-'} to {fmtDate(p.strExpiry) || '-'} · SIP {p.sipNo ?? '-'} to {fmtDate(p.sipExpiry) || '-'} · fee {p.feePct}% ·{' '}
                      {p.isEmployee ? 'employee (payroll)' : 'not employed (PPh 21 50%)'}
                    </span>
                  </span>
                  {p.licenceDue && <Badge tone="amber">licence due</Badge>}
                  <Badge tone={p.isActive ? 'green' : 'gray'}>{p.isActive ? 'active' : 'off'}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title="Tariffs"
        bodyClass="p-0"
        actions={
          !ro && (
            <Button size="sm" icon="plus" onClick={() => setSe('new')}>
              Tariff
            </Button>
          )
        }
      >
        {!s.services.length ? (
          <p className="px-4 py-3 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {s.services.map((x) => (
              <li key={x.id}>
                <button type="button" className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50" onClick={() => setSe(x)}>
                  <span className="flex-1">
                    {x.code} · {x.name}{' '}
                    <span className="text-xs text-slate-500">
                      · {x.kind.toLowerCase()} {x.feeable ? '· practitioner fee' : ''}
                    </span>
                  </span>
                  <span>{fmtMoney(x.price, 0)}</span>
                  <Badge tone={x.isActive ? 'green' : 'gray'}>{x.isActive ? 'active' : 'off'}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Controlled medicines (narcotics, psychotropics, precursors: SIPNAP)" bodyClass="p-0">
        <ul className="divide-y divide-line text-sm">
          {s.controlled.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-4 py-2">
              <span className="flex-1">
                {c.product?.code} · {c.product?.name}
              </span>
              <Badge tone="red">{c.class.toLowerCase()}</Badge>
              {!ro && (
                <Button size="sm" variant="ghost" icon="x" aria-label="Remove" onClick={() => act.mutate({ path: '/clinic/controlled/remove', body: { productId: c.productId, class: c.class } })} />
              )}
            </li>
          ))}
        </ul>
        {!ro && (
          <div className="flex flex-wrap items-end gap-2 px-4 py-3">
            <div className="min-w-64 flex-1">
              <AsyncSelect resource="products" value={ctrl.productId} onChange={(v) => setCtrl({ ...ctrl, productId: v })} aria-label="Medicine" />
            </div>
            <div className="w-44">
              <Select
                value={ctrl.class}
                onChange={(e) => setCtrl({ ...ctrl, class: e.target.value })}
                options={['NARKOTIKA', 'PSIKOTROPIKA', 'PREKURSOR'].map((x) => ({ value: x, label: x.toLowerCase() }))}
              />
            </div>
            <Button size="sm" icon="plus" disabled={!ctrl.productId} onClick={() => act.mutate({ path: '/clinic/controlled', body: ctrl })}>
              Add
            </Button>
          </div>
        )}
      </Card>
      {pe && <PractitionerForm p={pe === 'new' ? undefined : pe} ro={ro} onClose={() => setPe(null)} onSaved={() => (setPe(null), refresh())} />}
      {se && <ServiceForm s={se === 'new' ? undefined : se} ro={ro} onClose={() => setSe(null)} onSaved={() => (setSe(null), refresh())} />}
    </div>
  );
}

function ClinicConfigCard({ c, ro, onSave }: { c: Setup['config']; ro: boolean; onSave: (b: unknown) => void }) {
  const [f, setF] = useState({ name: c.name, facilityCode: c.facilityCode ?? '', pharmacyWarehouseId: c.pharmacyWarehouseId });
  return (
    <Card
      title="Clinic"
      actions={
        !ro && (
          <Button size="sm" icon="save" onClick={() => onSave(f)}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Name">
          <Input disabled={ro} value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Facility code (BPJS / SATUSEHAT)">
          <Input disabled={ro} value={f.facilityCode} maxLength={30} onChange={(e) => setF({ ...f, facilityCode: e.target.value })} />
        </Field>
        <Field label="Pharmacy warehouse" help="Medicines are dispensed from here">
          <AsyncSelect
            disabled={ro}
            resource="warehouses"
            value={f.pharmacyWarehouseId}
            initialLabel={c.warehouse ? `${c.warehouse.code} - ${c.warehouse.name}` : undefined}
            onChange={(v) => setF({ ...f, pharmacyWarehouseId: v })}
          />
        </Field>
      </div>
    </Card>
  );
}

function PractitionerForm({ p, ro, onClose, onSaved }: { p?: Setup['practitioners'][number]; ro: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: p?.name ?? '',
    profession: p?.profession ?? 'DOCTOR',
    strNo: p?.strNo ?? '',
    strExpiry: p?.strExpiry ?? (null as string | null),
    sipNo: p?.sipNo ?? '',
    sipExpiry: p?.sipExpiry ?? (null as string | null),
    employeeId: p?.employeeId ?? (null as string | null),
    isEmployee: p?.isEmployee ?? false,
    feePct: str(p?.feePct ?? 0),
    isActive: p?.isActive ?? true,
  });
  const save = useMutation({
    mutationFn: () => (p ? api.put(`/clinic/practitioners/${p.id}`, f) : api.post('/clinic/practitioners', f)),
    onSuccess: () => (toast.success('Saved'), onSaved()),
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={p ? p.name : 'New practitioner'}
      footer={
        !ro && (
          <Button icon="check" loading={save.isPending} disabled={!f.name} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input disabled={ro} value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Profession">
          <Select disabled={ro} value={f.profession} onChange={(e) => setF({ ...f, profession: e.target.value })} options={Object.entries(PROF).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="STR number">
          <Input disabled={ro} value={f.strNo} maxLength={40} onChange={(e) => setF({ ...f, strNo: e.target.value })} />
        </Field>
        <Field label="STR valid until">
          <DatePicker disabled={ro} value={f.strExpiry} onChange={(v) => setF({ ...f, strExpiry: v })} />
        </Field>
        <Field label="SIP number">
          <Input disabled={ro} value={f.sipNo} maxLength={60} onChange={(e) => setF({ ...f, sipNo: e.target.value })} />
        </Field>
        <Field label="SIP valid until" required>
          <DatePicker disabled={ro} value={f.sipExpiry} onChange={(v) => setF({ ...f, sipExpiry: v })} />
        </Field>
        <Field label="Fee share of the tariffs %">
          <NumberInput disabled={ro} decimals={2} min={0} max={100} value={f.feePct} onChange={(v) => setF({ ...f, feePct: v })} />
        </Field>
        <Field label="Employee record">
          <AsyncSelect disabled={ro} resource="employees" value={f.employeeId} onChange={(v) => setF({ ...f, employeeId: v })} />
        </Field>
        <div className="space-y-1 text-sm sm:col-span-2">
          <Checkbox disabled={ro} checked={f.isEmployee} onChange={(v) => setF({ ...f, isEmployee: v })} label="Employee (fees paid through the payroll)" />
          <Checkbox disabled={ro} checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        </div>
      </div>
    </Modal>
  );
}

function ServiceForm({ s, ro, onClose, onSaved }: { s?: Setup['services'][number]; ro: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: s?.code ?? '', name: s?.name ?? '', kind: s?.kind ?? 'CONSULT', price: str(s?.price), feeable: s?.feeable ?? true, isActive: s?.isActive ?? true });
  const save = useMutation({
    mutationFn: () => (s ? api.put(`/clinic/services/${s.id}`, f) : api.post('/clinic/services', f)),
    onSuccess: () => (toast.success('Saved'), onSaved()),
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={s ? s.name : 'New tariff'}
      footer={
        !ro && (
          <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Code" required>
          <Input disabled={ro} value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required className="sm:col-span-2">
          <Input disabled={ro} value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Kind">
          <Select
            disabled={ro}
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
            options={['CONSULT', 'PROCEDURE', 'LAB', 'OTHER'].map((x) => ({ value: x, label: x.toLowerCase() }))}
          />
        </Field>
        <Field label="Price" required>
          <NumberInput disabled={ro} decimals={0} min={0} value={f.price} onChange={(v) => setF({ ...f, price: v })} />
        </Field>
        <div className="space-y-1 pt-6 text-sm">
          <Checkbox disabled={ro} checked={f.feeable} onChange={(v) => setF({ ...f, feeable: v })} label="Practitioner fee" />
          <Checkbox disabled={ro} checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        </div>
      </div>
    </Modal>
  );
}

// ============================================================ billing and reports
export function ReportsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [tab, setTab] = useState<'SUMMARY' | 'FEES' | 'CAPITATION' | 'SIPNAP'>('SUMMARY');
  const [from, setFrom] = useState(isoDate().slice(0, 8) + '01');
  const [to, setTo] = useState(isoDate());
  const [period, setPeriod] = useState(isoDate().slice(0, 7));
  const [cap, setCap] = useState({ period: isoDate().slice(0, 7), date: isoDate(), members: '', amount: '', withheld: '', bankAccountId: null as string | null });
  const sum = useQuery({
    queryKey: ['clinic', 'reports', from, to],
    queryFn: () =>
      api.get<{ visits: number; byPayer: Record<string, number>; billed: number; ppn: number; topDiagnoses: { code: string; name: string; count: number }[] }>('/clinic/reports', { from, to }),
    enabled: tab === 'SUMMARY',
  });
  const fees = useQuery({
    queryKey: ['clinic', 'fees', period],
    queryFn: () =>
      api.get<{
        rows: { practitionerId: string; name: string; isEmployee: boolean; visits: number; gross: number; fee: number; base: number; pph21: number; net: number }[];
        runs: { id: string; practitioner: string | null; fee: number; pph21: number; net: number }[];
      }>('/clinic/fees', { period }),
    enabled: tab === 'FEES',
  });
  const caps = useQuery({
    queryKey: ['clinic', 'caps'],
    queryFn: () => api.get<{ id: string; period: string; members: number; amount: number; withheld: number; status: string }[]>('/clinic/capitations'),
    enabled: tab === 'CAPITATION',
  });
  const sip = useQuery({
    queryKey: ['clinic', 'sipnap', period],
    queryFn: () =>
      api.get<{ rows: { productId: string; code: string | null; name: string | null; class: string; opening: number; in: number; out: number; closing: number }[] }>('/clinic/sipnap', { period }),
    enabled: tab === 'SIPNAP',
  });
  const act = useMutation({
    mutationFn: (x: { path: string; body?: unknown }) => api.post(x.path, x.body ?? {}),
    onSuccess: () => (toast.success('Done'), qc.invalidateQueries({ queryKey: ['clinic'] })),
    onError: (e) => toast.error(e),
  });
  const billing = can('clinic.billing');
  return (
    <div className="space-y-5">
      <PageHeader
        title="Billing & Reports"
        subtitle="Visits and diagnoses, practitioner fees with PPh 21 bukan pegawai (Pasal 17 x 50% of the gross, PMK 168/2023), BPJS capitation, controlled medicines for SIPNAP"
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'SUMMARY', label: 'Summary' },
          { value: 'FEES', label: 'Practitioner fees' },
          { value: 'CAPITATION', label: 'BPJS capitation' },
          { value: 'SIPNAP', label: 'SIPNAP' },
        ]}
      />
      {tab === 'SUMMARY' && (
        <>
          <div className="flex gap-2">
            <div className="w-40">
              <DatePicker value={from} clearable={false} onChange={(v) => setFrom(v ?? from)} aria-label="From" />
            </div>
            <div className="w-40">
              <DatePicker value={to} clearable={false} onChange={(v) => setTo(v ?? to)} aria-label="To" />
            </div>
          </div>
          {sum.data && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card title={`${sum.data.visits} visits`} bodyClass="px-4 py-3 text-sm">
                {Object.entries(sum.data.byPayer).map(([k, c]) => (
                  <p key={k} className="flex justify-between">
                    <span>{PAYER[k]}</span>
                    <span>{c}</span>
                  </p>
                ))}
                <p className="mt-2 flex justify-between border-t border-line pt-2 font-medium">
                  <span>Invoiced (PPN {fmtMoney(sum.data.ppn, 0)})</span>
                  <span>{fmtMoney(sum.data.billed, 0)}</span>
                </p>
              </Card>
              <Card title="Top 10 diagnoses (ICD-10)" bodyClass="p-0">
                <ul className="divide-y divide-line text-sm">
                  {sum.data.topDiagnoses.map((d) => (
                    <li key={d.code} className="flex justify-between px-4 py-1.5">
                      <span>
                        {d.code} · {d.name}
                      </span>
                      <span>{d.count}</span>
                    </li>
                  ))}
                  {!sum.data.topDiagnoses.length && <li className="px-4 py-2 text-slate-500">None.</li>}
                </ul>
              </Card>
            </div>
          )}
        </>
      )}
      {(tab === 'FEES' || tab === 'SIPNAP') && (
        <div className="w-44">
          <Input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} aria-label="Month" />
        </div>
      )}
      {tab === 'FEES' && fees.data && (
        <Card
          title="Fees of billed visits"
          bodyClass="p-0"
          actions={
            billing &&
            fees.data.rows.some((r) => !r.isEmployee && r.fee > 0) && (
              <Button
                size="sm"
                icon="check"
                loading={act.isPending}
                onClick={async () =>
                  (await confirm({
                    title: `Book the fees of ${period}?`,
                    message: 'Dr Practitioner Fees / Cr PPh 21 Payable and Practitioner Fees Payable, at the month end.',
                    confirmText: 'Book',
                  })) && act.mutate({ path: `/clinic/fees/${period}` })
                }
              >
                Book fees
              </Button>
            )
          }
        >
          <ul className="divide-y divide-line text-sm">
            {fees.data.rows.map((r) => (
              <li key={r.practitionerId} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1">
                  {r.name} · {r.visits} visits {r.isEmployee ? '· employee: through the payroll' : ''}
                  <span className="block text-xs text-slate-500">
                    services billed {fmtMoney(r.gross, 0)} · PPh 21 base 50% {fmtMoney(r.base, 0)}
                  </span>
                </span>
                <span className="text-right text-xs">
                  fee {fmtMoney(r.fee, 0)} · PPh 21 {fmtMoney(r.pph21, 0)}
                  <span className="block font-medium">net {fmtMoney(r.net, 0)}</span>
                </span>
              </li>
            ))}
            {!fees.data.rows.length && <li className="px-4 py-3 text-slate-500">No billed visits left in the month.</li>}
          </ul>
          {fees.data.runs.length > 0 && (
            <ul className="divide-y divide-line border-t border-line text-sm">
              {fees.data.runs.map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-4 py-2">
                  <span className="flex-1">
                    Booked: {r.practitioner} · fee {fmtMoney(r.fee, 0)} · PPh 21 {fmtMoney(r.pph21, 0)} · net {fmtMoney(r.net, 0)}
                  </span>
                  {billing && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="x"
                      aria-label="Cancel"
                      onClick={async () => (await confirm({ title: 'Cancel this fee booking?', danger: true, confirmText: 'Cancel' })) && act.mutate({ path: `/clinic/fee-runs/${r.id}/cancel` })}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === 'CAPITATION' && (
        <>
          {billing && (
            <Card title="Record a capitation">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Field label="Month">
                  <Input type="month" value={cap.period} onChange={(e) => setCap({ ...cap, period: e.target.value })} />
                </Field>
                <Field label="Received on">
                  <DatePicker value={cap.date} clearable={false} onChange={(v) => setCap({ ...cap, date: v ?? isoDate() })} />
                </Field>
                <Field label="Participants">
                  <NumberInput decimals={0} min={0} value={cap.members} onChange={(v) => setCap({ ...cap, members: v })} />
                </Field>
                <Field label="Capitation">
                  <NumberInput decimals={0} min={0} value={cap.amount} onChange={(v) => setCap({ ...cap, amount: v })} />
                </Field>
                <Field label="Tax withheld (bukti potong)">
                  <NumberInput decimals={0} min={0} value={cap.withheld} onChange={(v) => setCap({ ...cap, withheld: v })} />
                </Field>
                <Field label="Into">
                  <AsyncSelect resource="bank-accounts" value={cap.bankAccountId} onChange={(v) => setCap({ ...cap, bankAccountId: v })} />
                </Field>
              </div>
              <Button
                size="sm"
                icon="check"
                className="mt-3"
                disabled={!num(cap.amount) || !cap.bankAccountId}
                loading={act.isPending}
                onClick={() => act.mutate({ path: '/clinic/capitations', body: { ...cap, withheld: cap.withheld || 0, members: cap.members || 0 } })}
              >
                Record
              </Button>
            </Card>
          )}
          <Card bodyClass="p-0">
            <ul className="divide-y divide-line text-sm">
              {(caps.data ?? []).map((c) => (
                <li key={c.id} className={`flex items-center gap-2 px-4 py-2 ${c.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}>
                  <span className="flex-1">
                    {c.period} · {fmtNumber(c.members, 0)} participants
                  </span>
                  <span className="text-xs text-slate-500">withheld {fmtMoney(c.withheld, 0)}</span>
                  <span className="w-32 text-right">{fmtMoney(c.amount, 0)}</span>
                  {billing && c.status === 'POSTED' && <Button size="sm" variant="ghost" icon="x" aria-label="Cancel" onClick={() => act.mutate({ path: `/clinic/capitations/${c.id}/cancel` })} />}
                </li>
              ))}
              {!caps.data?.length && <li className="px-4 py-3 text-slate-500">No capitation recorded.</li>}
            </ul>
          </Card>
        </>
      )}
      {tab === 'SIPNAP' && sip.data && (
        <Card title={`Controlled medicines ${period}`} bodyClass="p-0">
          {!sip.data.rows.length ? (
            <p className="px-4 py-3 text-sm text-slate-500">No controlled medicines listed (Practitioners & Tariffs).</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Medicine</th>
                  <th className="px-2 py-2 text-right">Opening</th>
                  <th className="px-2 py-2 text-right">In</th>
                  <th className="px-2 py-2 text-right">Out</th>
                  <th className="px-4 py-2 text-right">Closing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sip.data.rows.map((r) => (
                  <tr key={r.productId}>
                    <td className="px-4 py-1.5">
                      {r.code} · {r.name} <span className="text-xs text-slate-500">({r.class.toLowerCase()})</span>
                    </td>
                    <td className="px-2 py-1.5 text-right">{fmtNumber(r.opening, 2)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtNumber(r.in, 2)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtNumber(r.out, 2)}</td>
                    <td className="px-4 py-1.5 text-right font-medium">{fmtNumber(r.closing, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
