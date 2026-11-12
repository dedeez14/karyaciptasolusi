/**
 * HTTP client.
 * - Access token lives in memory only (never localStorage) -> not readable by injected scripts after reload
 * - Refresh token is an httpOnly SameSite=Strict cookie handled by the browser
 * - Automatic, de-duplicated token refresh on 401
 * - Company / branch context headers on every request
 * - Encrypted & signed request/response bodies (see ./transport)
 */
import { transport } from './transport';
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
    const url = `${BASE}/auth/refresh`;
    refreshing = transport
      .seal('POST', url)
      .then((sealed) => fetch(url, { method: 'POST', credentials: 'same-origin', headers: headers(sealed.headers, false) }).then(async (r) => ({ r, nonce: sealed.nonce })))
      .then(async ({ r, nonce }) => {
        if (!r.ok) return false;
        accessToken = (await transport.open<{ accessToken: string }>(await r.json(), nonce)).accessToken;
        return true;
      })
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshing = null), 0));
  }
  return refreshing;
}

type SealedResponse = Response & { nonce?: string };

async function raw(path: string, init: RequestInit & { json?: boolean } = {}, retry = true, resealed = false): Promise<SealedResponse> {
  const isForm = init.body instanceof FormData;
  const url = BASE + path;
  const method = (init.method ?? 'GET').toUpperCase();
  // a fresh nonce / signature for every attempt (retries are never replays)
  const sealed = await transport.seal(method, url, isForm || init.body === undefined ? undefined : String(init.body));
  const h = headers(init.headers, !isForm && init.json !== false);
  for (const [k, v] of Object.entries(sealed.headers)) h.set(k, v);
  const res = (await fetch(url, { ...init, body: isForm ? init.body : sealed.body ?? init.body, credentials: 'same-origin', headers: h })) as SealedResponse;
  res.nonce = sealed.nonce;
  if (res.status === 401 && retry && !path.startsWith('/auth/login')) {
    if (await refreshToken()) return raw(path, init, false, resealed);
    accessToken = null;
    onAuthLost?.();
  }
  if (res.status === 400 && !resealed && res.headers.get('content-type')?.includes('json')) {
    // the server key may have changed (restart / rotation): renegotiate once
    const probe = await res.clone().json().catch(() => null);
    if (probe && !probe.__enc && /signature|client key|transport/i.test(String(probe.message ?? ''))) {
      transport.reset();
      return raw(path, init, retry, true);
    }
  }
  return res;
}

async function parse<T>(res: SealedResponse): Promise<T> {
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await transport.open<any>(await res.json(), res.nonce) : null;
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
  /** POSTs JSON and returns the binary answer (e.g. a PDF preview of unsaved data) */
  blobPost: async (path: string, body: unknown) => {
    const r = await raw(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
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

export interface StreamEvent<T = unknown> {
  event: string;
  data: T;
}

/**
 * Subscribes to a Server-Sent Events endpoint using fetch (so the in-memory access token and
 * company/branch headers are sent - EventSource cannot send headers).
 * - refreshes the access token on 401
 * - reconnects with exponential backoff when the stream ends or fails
 * - calls onFallback after repeated failures so the caller can switch to polling
 * Returns an unsubscribe function (abort).
 */
export function subscribe<T = unknown>(path: string, handlers: { onEvent: (e: StreamEvent<T>) => void; onOpen?: () => void; onFallback?: () => void }): () => void {
  const controller = new AbortController();
  let attempt = 0;
  let failures = 0;
  let stopped = false;

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const connect = async (): Promise<void> => {
    while (!stopped) {
      try {
        const h = headers(undefined, false);
        h.set('Accept', 'text/event-stream');
        const sealed = await transport.seal('GET', BASE + path);
        for (const [k, v] of Object.entries(sealed.headers)) h.set(k, v);
        const res = await fetch(BASE + path, { headers: h, credentials: 'same-origin', signal: controller.signal, cache: 'no-store' });
        if (res.status === 401) {
          if (!(await refreshToken())) {
            onAuthLost?.();
            return;
          }
          continue;
        }
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        attempt = 0;
        failures = 0;
        handlers.onOpen?.();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '');
            let event = 'message';
            const data: string[] = [];
            for (const line of chunk.split(/\r?\n/)) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
            }
            if (!data.length) continue;
            try {
              handlers.onEvent({ event, data: await transport.open<T>(JSON.parse(data.join('\n')), sealed.nonce) });
            } catch {
              /* ignore malformed event */
            }
          }
        }
        // server closed the stream (normal every few minutes) -> reconnect quickly with a fresh token
        await refreshToken();
        await wait(500);
      } catch (e) {
        if (stopped || (e as Error).name === 'AbortError') return;
        failures++;
        if (failures === 3) handlers.onFallback?.();
        attempt = Math.min(attempt + 1, 6);
        await wait(Math.min(30_000, 1000 * 2 ** attempt));
      }
    }
  };
  void connect();
  return () => {
    stopped = true;
    controller.abort();
  };
}
