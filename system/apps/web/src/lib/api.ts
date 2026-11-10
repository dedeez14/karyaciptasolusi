/**
 * HTTP client.
 * - Access token lives in memory only (never localStorage) -> not readable by injected scripts after reload
 * - Refresh token is an httpOnly SameSite=Strict cookie handled by the browser
 * - Automatic, de-duplicated token refresh on 401
 * - Company / branch context headers on every request
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: Record<string, string>,
    public requestId?: string,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let companyId: string | null = null;
let branchId: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onAuthLost: (() => void) | null = null;

export const session = {
  setToken: (t: string | null) => (accessToken = t),
  hasToken: () => !!accessToken,
  setContext: (c: string | null, b: string | null) => {
    companyId = c;
    branchId = b;
  },
  onAuthLost: (fn: () => void) => (onAuthLost = fn),
};

const BASE = '/api/v1';

function headers(extra?: HeadersInit, json = true): Headers {
  const h = new Headers(extra);
  h.set('X-Requested-With', 'kcs-web');
  if (json && !h.has('Content-Type')) h.set('Content-Type', 'application/json');
  if (accessToken) h.set('Authorization', `Bearer ${accessToken}`);
  if (companyId) h.set('X-Company-Id', companyId);
  if (branchId) h.set('X-Branch-Id', branchId);
  return h;
}

export async function refreshToken(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin', headers: headers(undefined, false) })
      .then(async (r) => {
        if (!r.ok) return false;
        accessToken = (await r.json()).accessToken;
        return true;
      })
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshing = null), 0));
  }
  return refreshing;
}

async function raw(path: string, init: RequestInit & { json?: boolean } = {}, retry = true): Promise<Response> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(BASE + path, { ...init, credentials: 'same-origin', headers: headers(init.headers, !isForm && init.json !== false) });
  if (res.status === 401 && retry && !path.startsWith('/auth/login')) {
    if (await refreshToken()) return raw(path, init, false);
    accessToken = null;
    onAuthLost?.();
  }
  return res;
}

async function parse<T>(res: Response): Promise<T> {
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, body?.message ?? res.statusText ?? 'Request failed', body?.errors, body?.requestId);
  return body as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>) => raw(path + qs(params)).then((r) => parse<T>(r)),
  post: <T>(path: string, body?: unknown) => raw(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }).then((r) => parse<T>(r)),
  patch: <T>(path: string, body?: unknown) => raw(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }).then((r) => parse<T>(r)),
  put: <T>(path: string, body?: unknown) => raw(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }).then((r) => parse<T>(r)),
  delete: <T>(path: string) => raw(path, { method: 'DELETE' }).then((r) => parse<T>(r)),
  /** Fetches a binary file and returns it as a Blob (PDF, XLSX, ...) */
  blob: async (path: string, params?: Record<string, unknown>) => {
    const r = await raw(path + qs(params), { json: false });
    if (!r.ok) await parse(r);
    const cd = r.headers.get('content-disposition') ?? '';
    const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'download';
    return { blob: await r.blob(), name };
  },
};

export function qs(params?: Record<string, unknown>): string {
  if (!params) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
