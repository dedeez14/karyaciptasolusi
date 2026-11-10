import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useLookupOptions } from '@/hooks/useLookups';
import { Badge } from '@/components/ui';

export interface ScrapeJob {
  id: string;
  code: string;
  name: string;
  queries: string;
  queryCount?: number;
  latitude: string | null;
  longitude: string | null;
  radiusKm: string | null;
  zoom: number | null;
  depth: number;
  languageCode: string;
  extractEmails: boolean;
  fastMode: boolean;
  statusCode: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  startedAt: string | null;
  finishedAt: string | null;
  resultCount: number;
  newCount: number;
  error: string | null;
  logTail?: string | null;
  createdAt: string;
  live: { elapsedSeconds: number; rows: number; log: string } | null;
  places?: { new: number; imported: number; ignored: number };
  queuePosition?: number | null;
}

export interface Place {
  id: string;
  jobId: string | null;
  title: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  emails: string[];
  rating: number | null;
  reviewCount: number | null;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string | null;
  query: string | null;
  statusCode: 'NEW' | 'IMPORTED' | 'IGNORED';
  leadId: string | null;
  leadCode: string | null;
  createdAt: string;
}

export interface LeadFinderStatus {
  ready: boolean;
  problem: string | null;
  program: string | null;
  queued: number;
  running: number;
  defaults: { depth: number; languageCode: string; timeoutMinutes: number };
}

export const useFinderStatus = () => useQuery({ queryKey: ['leadfinder', 'status'], queryFn: () => api.get<LeadFinderStatus>('/leadfinder/status'), staleTime: 30_000 });

export const isActive = (s: ScrapeJob['statusCode']) => s === 'QUEUED' || s === 'RUNNING';

export function JobStatus({ code }: { code: string }) {
  const opts = useLookupOptions('SCRAPE_STATUS');
  const o = opts.find((x) => x.value === code);
  return (
    <Badge color={o?.color} dot>
      {o?.label ?? code}
    </Badge>
  );
}

export function PlaceStatus({ code }: { code: string }) {
  const opts = useLookupOptions('MAP_PLACE_STATUS');
  const o = opts.find((x) => x.value === code);
  return <Badge color={o?.color}>{o?.label ?? code}</Badge>;
}

export const duration = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
};

/** Phone number as a WhatsApp/tel friendly local number: +6281234 -> 0812 34.. */
export const localPhone = (p: string | null) => (p && p.startsWith('+62') ? `0${p.slice(3)}` : p ?? '');
