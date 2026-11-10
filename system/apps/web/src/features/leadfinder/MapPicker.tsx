import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button, cn, Icon, Input, Spinner } from '@/components/ui';

export interface Centre {
  lat: number;
  lng: number;
}

interface Place {
  display_name: string;
  lat: string;
  lon: string;
}

const RADIUS_PRESETS = [2, 5, 10, 25, 50];

/** Map zoom used by the scraper for a search radius (wider area -> zoomed out) */
export function zoomForRadius(km: number) {
  if (km <= 1) return 16;
  if (km <= 3) return 15;
  if (km <= 7) return 14;
  if (km <= 15) return 13;
  if (km <= 30) return 12;
  return 11;
}

/** "-6.9175, 107.6191", "-6.9175 107.6191" or a Google Maps link ".../@-6.9175,107.6191,15z" */
export function parseCoordinates(text: string): Centre | null {
  const m = /@?(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)/.exec(text.trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

const pin = L.divIcon({
  className: '',
  html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#2563eb;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.35)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

/**
 * Pick the centre of a Google Maps search on a map and set its radius.
 * Click or drag the pin, search a place, use the current location or paste coordinates.
 */
export function MapPicker({ centre, radiusKm, onCentre, onRadius }: { centre: Centre; radiusKm: number; onCentre: (c: Centre, placeName?: string) => void; onRadius: (km: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const onCentreRef = useRef(onCentre);
  onCentreRef.current = onCentre;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [locating, setLocating] = useState(false);
  const [coords, setCoords] = useState('');
  /** the query text was set from a picked place: do not search it again */
  const picked = useRef('');

  // create the map once
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([centre.lat, centre.lng], zoomForRadius(radiusKm) - 1);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
    marker.current = L.marker([centre.lat, centre.lng], { draggable: true, icon: pin, keyboard: true, title: 'Search centre - drag to move' }).addTo(m);
    circle.current = L.circle([centre.lat, centre.lng], { radius: radiusKm * 1000, color: '#2563eb', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.12 }).addTo(m);
    // a pin moved by hand is no longer the searched place: clear the place text
    marker.current.on('dragend', () => {
      const p = marker.current!.getLatLng();
      setQuery('');
      onCentreRef.current({ lat: p.lat, lng: p.lng });
    });
    m.on('click', (e: L.LeafletMouseEvent) => {
      setQuery('');
      onCentreRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    map.current = m;
    // the map lives in a drawer that animates open: measure again once it is in place
    const t = setTimeout(() => {
      m.invalidateSize();
      m.fitBounds(circle.current!.getBounds(), { padding: [16, 16] });
    }, 320);
    return () => {
      clearTimeout(t);
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep pin + circle in sync and show the whole area
  useEffect(() => {
    if (!map.current || !marker.current || !circle.current) return;
    marker.current.setLatLng([centre.lat, centre.lng]);
    circle.current.setLatLng([centre.lat, centre.lng]);
    circle.current.setRadius(radiusKm * 1000);
    map.current.fitBounds(circle.current.getBounds(), { padding: [16, 16], animate: true });
  }, [centre.lat, centre.lng, radiusKm]);

  // place search (OpenStreetMap Nominatim), debounced, Indonesia first
  useEffect(() => {
    const q = query.trim();
    setSearchError('');
    if (q.length < 3 || parseCoordinates(q) || q === picked.current) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=id&accept-language=id&q=${encodeURIComponent(q)}`;
        const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error();
        const rows = (await r.json()) as Place[];
        setResults(rows);
        if (!rows.length) setSearchError('No place found. Try a city or district name.');
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setSearchError('Place search is not available right now. Click on the map instead.');
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const choose = (p: Place) => {
    onCentre({ lat: Number(p.lat), lng: Number(p.lon) }, p.display_name.split(',')[0]);
    setResults([]);
    const label = p.display_name.split(',').slice(0, 2).join(',').trim();
    picked.current = label;
    setQuery(label);
  };

  const locate = () => {
    if (!navigator.geolocation) return setSearchError('This browser cannot share its location.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onCentre({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        setSearchError('Location was not shared. Search a place or click on the map.');
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  };

  const applyCoords = () => {
    const c = parseCoordinates(coords);
    if (!c) return setSearchError('Paste coordinates like -6.9175, 107.6191 or a Google Maps link.');
    onCentre(c);
    setCoords('');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Icon name="search" className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search a city, district or address, e.g. Cimahi"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (results[0]) choose(results[0]);
              }
            }}
            aria-label="Search a place on the map"
          />
          {searching && <Spinner className="absolute top-2.5 right-3 h-4 w-4 text-slate-400" />}
        </div>
        <Button variant="outline" icon="locate-fixed" loading={locating} onClick={locate}>
          My location
        </Button>
      </div>
      {results.length > 0 && (
        <ul className="overflow-hidden rounded-xl border border-line bg-white shadow-sm" role="listbox" aria-label="Places">
          {results.map((p, i) => (
            <li key={i}>
              <button type="button" onClick={() => choose(p)} className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50">
                <Icon name="map-pin" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <span className="line-clamp-2">{p.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searchError && <p className="text-xs text-amber-700">{searchError}</p>}

      <div ref={el} className="h-72 w-full overflow-hidden rounded-xl border border-line sm:h-80" role="application" aria-label="Map: click to set the search centre, drag the pin to move it" />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Radius</span>
        {RADIUS_PRESETS.map((km) => (
          <button
            key={km}
            type="button"
            onClick={() => onRadius(km)}
            className={cn('rounded-full border px-3 py-1 text-xs font-medium transition', radiusKm === km ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-slate-600 hover:border-brand-300')}
          >
            {km} km
          </button>
        ))}
        <input
          type="range"
          min={0.5}
          max={50}
          step={0.5}
          value={radiusKm}
          onChange={(e) => onRadius(Number(e.target.value))}
          className="ml-1 min-w-32 flex-1 accent-brand-600"
          aria-label="Radius in kilometres"
        />
        <span className="w-16 text-right text-sm font-semibold text-slate-800 tabular-nums">{radiusKm} km</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          Centre <span className="font-mono text-slate-700">{centre.lat.toFixed(5)}, {centre.lng.toFixed(5)}</span> · click the map or drag the pin to move it
        </span>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            applyCoords();
          }}
        >
          <Input className="h-8 w-56 text-xs" placeholder="Paste coordinates or a Maps link" value={coords} onChange={(e) => setCoords(e.target.value)} aria-label="Paste coordinates" />
          <Button size="sm" variant="ghost" type="submit" disabled={!coords.trim()}>
            Go
          </Button>
        </form>
      </div>
    </div>
  );
}
