import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Drawer, Field, Input, LookupSelect, NumberInput, Switch, Textarea, toast } from '@/components/ui';
import type { LeadFinderStatus, ScrapeJob } from './common';

interface Form {
  name: string;
  keywords: string;
  location: string;
  latitude: string;
  longitude: string;
  radiusKm: string;
  zoom: string;
  depth: string;
  languageCode: string;
  extractEmails: boolean;
  fastMode: boolean;
}

/** "konveksi" + "Bandung" -> "konveksi di Bandung" (one search per keyword) */
function combine(keywords: string, location: string, lang: string) {
  const loc = location.trim();
  const join = lang === 'id' ? 'di' : 'in';
  return keywords
    .split(/\r?\n|,/)
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => (loc && !k.toLowerCase().includes(loc.toLowerCase()) ? `${k} ${join} ${loc}` : k));
}

export function NewSearchDrawer({ open, onClose, status }: { open: boolean; onClose: () => void; status?: LeadFinderStatus }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const blank = (): Form => ({
    name: '',
    keywords: '',
    location: '',
    latitude: '',
    longitude: '',
    radiusKm: '10',
    zoom: '15',
    depth: String(status?.defaults.depth ?? 3),
    languageCode: status?.defaults.languageCode ?? 'id',
    extractEmails: true,
    fastMode: false,
  });
  const [f, setF] = useState<Form>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setF(blank());
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const queries = useMemo(() => combine(f.keywords, f.location, f.languageCode), [f.keywords, f.location, f.languageCode]);
  const hasCentre = f.latitude.trim() !== '' || f.longitude.trim() !== '';

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const job = await api.post<ScrapeJob>('/leadfinder/jobs', {
        name: f.name || queries[0] || '',
        queries: queries.join('\n'),
        latitude: f.latitude,
        longitude: f.longitude,
        radiusKm: hasCentre ? f.radiusKm : '',
        zoom: hasCentre ? f.zoom : '',
        depth: f.depth,
        languageCode: f.languageCode,
        extractEmails: f.extractEmails,
        fastMode: f.fastMode,
      });
      toast.success(`Search ${job.code} started`);
      qc.invalidateQueries({ queryKey: ['leadfinder'] });
      onClose();
      navigate(`/crm/lead-finder/${job.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      wide
      title="New Google Maps search"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="search" onClick={submit} loading={busy} disabled={!queries.length || !status?.ready}>
            Start search ({queries.length})
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {status && !status.ready && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{status.problem}</p>}
        <Field label="Name" help="To recognise this search later, e.g. 'Konveksi Bandung November'" error={errors.name}>
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={200} placeholder={queries[0] ?? ''} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What to look for" required help="One business type per line (or separated by commas), e.g. konveksi, sablon kaos, percetakan" error={errors.queries}>
            <Textarea rows={6} value={f.keywords} onChange={(e) => set('keywords', e.target.value)} />
          </Field>
          <Field label="Where" help="City or area added to every search, e.g. 'Bandung'. Leave empty when the keywords already contain a place.">
            <Input value={f.location} onChange={(e) => set('location', e.target.value)} maxLength={80} />
          </Field>
        </div>
        {queries.length > 0 && (
          <div className="rounded-xl border border-line bg-slate-50/60 p-3">
            <p className="mb-1.5 text-xs font-medium text-slate-500">Searches that will run ({queries.length}{queries.length > 50 ? ' - at most 50 allowed' : ''})</p>
            <ul className="max-h-36 space-y-0.5 overflow-y-auto text-sm text-slate-700">
              {queries.map((q, i) => (
                <li key={i} className="truncate">
                  {i + 1}. {q}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold text-slate-800">Map area (optional)</p>
          <p className="mb-3 text-xs text-slate-500">Centre the search on a point, e.g. from Google Maps: right-click a place and copy its coordinates. Without it, Google decides the area from the search text.</p>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Latitude" error={errors.latitude}>
              <Input value={f.latitude} onChange={(e) => set('latitude', e.target.value)} placeholder="-6.9175" inputMode="decimal" />
            </Field>
            <Field label="Longitude" error={errors.longitude}>
              <Input value={f.longitude} onChange={(e) => set('longitude', e.target.value)} placeholder="107.6191" inputMode="decimal" />
            </Field>
            <Field label="Radius (km)" error={errors.radiusKm}>
              <NumberInput value={f.radiusKm} onChange={(v) => set('radiusKm', v)} decimals={2} disabled={!hasCentre} />
            </Field>
            <Field label="Zoom" help="15 = city district" error={errors.zoom}>
              <NumberInput value={f.zoom} onChange={(v) => set('zoom', v)} decimals={0} disabled={!hasCentre} />
            </Field>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Depth" help="How far the result list is scrolled: 1 = first results only (fast), 10 = as many as Google shows (slow)" error={errors.depth}>
            <NumberInput value={f.depth} onChange={(v) => set('depth', v)} decimals={0} />
          </Field>
          <Field label="Results language" error={errors.languageCode}>
            <LookupSelect category="LANGUAGE" value={f.languageCode} onChange={(v) => set('languageCode', v)} clearable={false} />
          </Field>
        </div>
        <div className="space-y-3 rounded-xl border border-line p-3">
          <Switch checked={f.extractEmails} onChange={(v) => set('extractEmails', v)} label="Look for e-mail addresses on the business websites (slower, finds e-mails for marketing)" />
          <Switch checked={f.fastMode} onChange={(v) => set('fastMode', v)} label="Fast mode: up to 21 places per search, nearest first, fewer details (needs a map centre)" />
          {errors.fastMode && <p className="text-xs text-red-600">{errors.fastMode}</p>}
        </div>
        <p className="text-xs text-slate-500">
          Searches run one after another on the server (time limit {status?.defaults.timeoutMinutes ?? 30} minutes each). Collect only business contact details and use them in line with Google's terms and the personal data protection law (UU PDP).
        </p>
      </div>
    </Drawer>
  );
}
