/**
 * Application-layer encryption & request signing (mirror of the API's TransportService).
 *
 * Handshake : browser generates an ephemeral ECDH P-256 key pair per page load (private key is
 *             non-extractable), combines it with the server public key -> shared secret.
 * Key       : HKDF-SHA256(shared, salt "kcs-transport-v1", info "aes-256-gcm") -> AES-256-GCM key.
 * Requests  : JSON bodies are encrypted; every request carries a timestamp + single-use nonce and is
 *             authenticated (GCM tag over METHOD | URL | timestamp | nonce [| body]).
 * Responses : JSON is returned encrypted and only this page can decrypt it.
 * Nothing sensitive is readable in DevTools > Network, proxies or server access logs.
 */
interface Ready {
  enabled: boolean;
  key?: CryptoKey;
  clientKey?: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
let ready: Promise<Ready> | null = null;

const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function init(): Promise<Ready> {
  if (!globalThis.crypto?.subtle) return { enabled: false }; // insecure context (plain http on a LAN IP)
  const res = await fetch('/api/v1/public/transport-key', { headers: { 'X-Requested-With': 'kcs-web' }, cache: 'no-store' });
  if (!res.ok) return { enabled: false };
  const info = (await res.json()) as { enabled: boolean; publicKey: string };
  if (!info.enabled) return { enabled: false };
  const serverKey = await crypto.subtle.importKey('raw', fromB64u(info.publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, pair.privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('kcs-transport-v1'), info: enc.encode('aes-256-gcm') }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { enabled: true, key, clientKey: b64u(await crypto.subtle.exportKey('raw', pair.publicKey)) };
}

function state() {
  if (!ready) ready = init().catch(() => ({ enabled: false }));
  return ready;
}

export const transport = {
  /** forget the session key (e.g. after the server rotated its key) */
  reset() {
    ready = null;
  },

  /** Encrypts / signs one request. `url` must be exactly the string passed to fetch (path + query). */
  async seal(method: string, url: string, body?: string): Promise<{ headers: Record<string, string>; body?: string; nonce?: string }> {
    const s = await state();
    if (!s.enabled || !s.key) return { headers: {}, body };
    const ts = String(Date.now());
    const nonce = b64u(crypto.getRandomValues(new Uint8Array(16)));
    const aad = enc.encode(`${method.toUpperCase()}\n${url}\n${ts}\n${nonce}`);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const headers: Record<string, string> = { 'X-Client-Key': s.clientKey!, 'X-Ts': ts, 'X-Nonce': nonce };
    if (body !== undefined) {
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, s.key, enc.encode(body));
      return { headers, body: JSON.stringify({ __enc: 1, iv: b64u(iv), ct: b64u(ct) }), nonce };
    }
    const tag = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, s.key, new Uint8Array(0));
    headers['X-Sig'] = `${b64u(iv)}.${b64u(tag)}`;
    return { headers, nonce };
  },

  /** Decrypts an encrypted response body (returns non-envelopes unchanged) */
  async open<T = unknown>(payload: unknown, nonce?: string): Promise<T> {
    const p = payload as { __enc?: number; iv?: string; ct?: string } | null;
    if (!p || p.__enc !== 1 || !p.iv || !p.ct || !nonce) return payload as T;
    const s = await state();
    if (!s.key) throw new Error('Encrypted response received without a session key');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(p.iv), additionalData: enc.encode(`RES\n${nonce}`) }, s.key, fromB64u(p.ct));
    return JSON.parse(dec.decode(plain)) as T;
  },
};
