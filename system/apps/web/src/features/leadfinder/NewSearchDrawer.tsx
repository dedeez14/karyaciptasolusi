import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Drawer, Field, Icon, Input, LookupSelect, NumberInput, Switch, Textarea, toast } from '@/components/ui';
import type { LeadFinderStatus, ScrapeJob } from './common';
import { MapPicker, zoomForRadius, type Centre } from './MapPicker';

const AREA_KEY = 'kcs.leadfinder.area';
const DEFAULT_AREA = { lat: -6.2088, lng: 106.8456, radiusKm: 10 }; // Jakarta

/** last map area used on this device (a convenience only) */
function lastArea(): { lat: number; lng: number; radiusKm: number } {
  try {
    const a = JSON.parse(localStorage.getItem(AREA_KEY) ?? 'null');
    if (a && Number.isFinite(a.lat) && Number.isFinite(a.lng) && Number.isFinite(a.radiusKm)) return a;
  } catch {
    /* ignore */
  }
  return DEFAULT_AREA;
}
function rememberArea(a: { lat: number; lng: number; radiusKm: number }) {
  try {
    localStorage.setItem(AREA_KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
}

interface Form {
  name: string;
  keywords: string;
  location: string;
  /** the "Where" text the map filled in (so moving the pin can update it) */
  autoLocation: string;
  useArea: boolean;
  centre: Centre;
  radiusKm: number;
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
    autoLocation: '',
    useArea: true,
    centre: { lat: lastArea().lat, lng: lastArea().lng },
    radiusKm: lastArea().radiusKm,
    depth: String(status?.defaults.depth ?? 3),
    languageCode: status?.defaults.languageCode ?? 'id',
    extractEmails: true,
    fastMode: true,
  });
  const [advanced, setAdvanced] = useState(false);
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
  const hasCentre = f.useArea;

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const job = await api.post<ScrapeJob>('/leadfinder/jobs', {
        name: f.name || queries[0] || '',
        queries: queries.join('\n'),
        latitude: hasCentre ? f.centre.lat.toFixed(7) : '',
        longitude: hasCentre ? f.centre.lng.toFixed(7) : '',
        radiusKm: hasCentre ? String(f.radiusKm) : '',
        zoom: hasCentre ? String(zoomForRadius(f.radiusKm)) : '',
        depth: f.depth,
        languageCode: f.languageCode,
        extractEmails: f.extractEmails,
        fastMode: hasCentre && f.fastMode,
      });
      if (hasCentre) rememberArea({ ...f.centre, radiusKm: f.radiusKm });
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

        <div className="space-y-3 rounded-xl border border-line p-3">
          <Switch
            checked={f.useArea}
            onChange={(v) => setF((s) => ({ ...s, useArea: v, fastMode: v ? s.fastMode : false }))}
            label="Search around a point on the map (recommended)"
          />
          {f.useArea ? (
            <MapPicker
              centre={f.centre}
              radiusKm={f.radiusKm}
              onCentre={(c, placeName) =>
                setF((s) => {
                  // "Where" follows the map while it is empty or was filled from the map; typed text is kept
                  const follows = !s.location.trim() || s.location === s.autoLocation;
                  const next = placeName ?? '';
                  return follows ? { ...s, centre: c, location: next, autoLocation: next } : { ...s, centre: c };
                })
              }
              onRadius={(km) => set('radiusKm', km)}
            />
          ) : (
            <p className="text-xs text-slate-500">Google decides the area from the search text (for example "konveksi di Bandung"). Turn the map on to search a precise area.</p>
          )}
          {errors.latitude || errors.longitude || errors.radiusKm ? <p className="text-xs text-red-600">{errors.latitude || errors.longitude || errors.radiusKm}</p> : null}
        </div>

        <div className="space-y-3 rounded-xl border border-line p-3">
          <Switch checked={f.extractEmails} onChange={(v) => set('extractEmails', v)} label="Look for e-mail addresses on the business websites (slower, needed for e-mail campaigns)" />
          <Switch
            checked={f.fastMode}
            disabled={!f.useArea}
            onChange={(v) => set('fastMode', v)}
            label={f.useArea ? 'Fast mode: quicker and blocked less often, up to 21 places per keyword, nearest first' : 'Fast mode needs a point on the map'}
          />
          {errors.fastMode && <p className="text-xs text-red-600">{errors.fastMode}</p>}
        </div>

        <div>
          <button type="button" onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-brand-700" aria-expanded={advanced}>
            <Icon name={advanced ? 'chevron-down' : 'chevron-right'} className="h-4 w-4" />
            Advanced settings
          </button>
          {advanced && (
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Depth" help="How far the result list is scrolled: 1 = first results only (fast), 10 = as many as Google shows (slow)" error={errors.depth}>
                <NumberInput value={f.depth} onChange={(v) => set('depth', v)} decimals={0} />
              </Field>
              <Field label="Results language" error={errors.languageCode}>
                <LookupSelect category="LANGUAGE" value={f.languageCode} onChange={(v) => set('languageCode', v)} clearable={false} />
              </Field>
              {f.useArea && <p className="text-xs text-slate-500 sm:col-span-2">Map zoom is set automatically from the radius (now {zoomForRadius(f.radiusKm)}).</p>}
            </div>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Searches run one after another on the server (time limit {status?.defaults.timeoutMinutes ?? 30} minutes each). Collect only business contact details and use them in line with Google's terms and the personal data protection law (UU PDP).
        </p>
      </div>
    </Drawer>
  );
}
