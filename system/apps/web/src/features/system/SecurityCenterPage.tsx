import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDateTime, getLocale } from '@/lib/format';
import { Badge, Button, Card, Field, Icon, Input, PageHeader, Select, Spinner, Tabs, Textarea, toast } from '@/components/ui';

interface Overview {
  password: { algorithm: string; salt: string; pepper: string; totalUsers: number; legacyUsers: number };
  transport: { enabled: boolean; keyAgreement: string; cipher: string; kdf: string; replayProtection: string; fingerprint: string };
  signing: { algorithm: string; fingerprint: string; publicKeyPem: string };
  atRest: { cipher: string; fields: string[] };
  audit: { algorithm: string; entries: number };
  steganography: { method: string };
}
interface ChainResult {
  valid: boolean;
  checked: number;
  legacy: number;
  brokenAt: string | null;
  reason: string | null;
  lastHash?: string | null;
}
interface WatermarkResult {
  found: boolean;
  valid?: boolean;
  payload?: { u?: string; n?: string; f?: string; t?: string };
  userName?: string | null;
}

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={mono ? 'text-right font-mono text-xs break-all text-slate-800' : 'text-right font-medium text-slate-800'}>{value}</span>
    </div>
  );
}

export default function SecurityCenterPage() {
  const q = useQuery({ queryKey: ['security', 'overview'], queryFn: () => api.get<Overview>('/security/overview') });
  const [tab, setTab] = useState<'overview' | 'integrity' | 'tools'>('overview');
  const [chain, setChain] = useState<ChainResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [wm, setWm] = useState<WatermarkResult | null>(null);
  const [wmBusy, setWmBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // tools
  const [hashInput, setHashInput] = useState('');
  const [algo, setAlgo] = useState('SHA-256');
  const [hashOut, setHashOut] = useState('');
  const [codecInput, setCodecInput] = useState('');
  const [codecOut, setCodecOut] = useState('');
  const [verifyLink, setVerifyLink] = useState('');

  const o = q.data;

  const verifyChain = async () => {
    setChecking(true);
    try {
      setChain(await api.get<ChainResult>('/system/audit-logs/verify'));
    } catch (e) {
      toast.error(e);
    } finally {
      setChecking(false);
    }
  };

  const detect = async (file: File) => {
    setWmBusy(true);
    setWm(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      setWm(await api.post<WatermarkResult>('/security/watermark/detect', fd));
    } catch (e) {
      toast.error(e);
    } finally {
      setWmBusy(false);
    }
  };

  const runHash = async () => setHashOut(hex(await crypto.subtle.digest(algo, enc.encode(hashInput))));
  const codec = (mode: string) => {
    try {
      if (mode === 'b64e') setCodecOut(btoa(String.fromCharCode(...enc.encode(codecInput))));
      if (mode === 'b64d') setCodecOut(new TextDecoder().decode(Uint8Array.from(atob(codecInput.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
      if (mode === 'urle') setCodecOut(encodeURIComponent(codecInput));
      if (mode === 'urld') setCodecOut(decodeURIComponent(codecInput));
      if (mode === 'hexe') setCodecOut([...enc.encode(codecInput)].map((x) => x.toString(16).padStart(2, '0')).join(''));
      if (mode === 'hexd') setCodecOut(new TextDecoder().decode(Uint8Array.from((codecInput.match(/.{1,2}/g) ?? []).map((h) => parseInt(h, 16)))));
    } catch {
      setCodecOut('Input is not valid for this conversion');
    }
  };
  const openVerify = () => {
    // QR codes carry a short code (?c=...); older documents carry the full signed token (?t=...)
    const link = verifyLink.trim();
    const c = /[?&]c=([0-9a-f]{20})/i.exec(link)?.[1] ?? (/^[0-9a-f]{20}$/i.test(link) ? link : null);
    const t = /[?&]t=([^&\s]+)/.exec(link)?.[1] ?? link;
    if (c) window.open(`/verify?c=${c.toLowerCase()}`, '_blank', 'noopener');
    else if (t) window.open(`/verify?t=${encodeURIComponent(t)}`, '_blank', 'noopener');
  };
  const downloadKey = () => {
    if (!o) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([o.signing.publicKeyPem], { type: 'application/x-pem-file' }));
    a.download = 'kcs-document-signing-public-key.pem';
    a.click();
  };

  return (
    <div>
      <PageHeader title="Security Center" subtitle="Cryptography, integrity checks and leak tracing" />
      <div className="mb-5">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'overview', label: 'Overview' },
            { value: 'integrity', label: 'Integrity & tracing' },
            { value: 'tools', label: 'Tools' },
          ]}
        />
      </div>

      {q.isLoading || !o ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : tab === 'overview' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card title="Passwords — salting & hashing" actions={<Badge tone="green" dot>Active</Badge>}>
            <Row label="Algorithm" value={o.password.algorithm} />
            <Row label="Salt" value={o.password.salt} />
            <Row label="Pepper" value={o.password.pepper} />
            <Row label="Users on the latest scheme" value={`${o.password.totalUsers - o.password.legacyUsers} / ${o.password.totalUsers}`} />
            {o.password.legacyUsers > 0 && <p className="mt-2 text-xs text-slate-500">Older hashes are upgraded automatically at the user's next sign-in.</p>}
          </Card>
          <Card title="API request / response encryption" actions={<Badge tone={o.transport.enabled ? 'green' : 'amber'} dot>{o.transport.enabled ? 'Active' : 'Disabled'}</Badge>}>
            <Row label="Key agreement" value={o.transport.keyAgreement} />
            <Row label="Cipher" value={o.transport.cipher} />
            <Row label="Key derivation" value={o.transport.kdf} />
            <Row label="Replay protection" value={o.transport.replayProtection} />
            <Row label="Server key" value={o.transport.fingerprint} mono />
          </Card>
          <Card
            title="Digital signatures on documents"
            actions={
              <Button size="sm" variant="outline" icon="download" onClick={downloadKey}>
                Public key
              </Button>
            }
          >
            <Row label="Algorithm" value={o.signing.algorithm} />
            <Row label="Key fingerprint" value={o.signing.fingerprint} mono />
            <p className="mt-2 text-xs text-slate-500">Every generated PDF carries a QR code. Scanning it shows who issued the document and its key facts; the verify page also checks the PDF file itself and reports an edited copy.</p>
          </Card>
          <Card title="Encryption at rest">
            <Row label="Cipher" value={o.atRest.cipher} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {o.atRest.fields.map((f) => (
                <Badge key={f} tone="blue">
                  <Icon name="lock" className="h-3 w-3" /> {f}
                </Badge>
              ))}
            </div>
          </Card>
          <Card title="Audit trail integrity">
            <Row label="Method" value={o.audit.algorithm} />
            <Row label="Entries" value={o.audit.entries.toLocaleString(getLocale())} />
          </Card>
          <Card title="Steganography">
            <Row label="Method" value={o.steganography.method} />
            <p className="mt-2 text-xs text-slate-500">Used for leak tracing only. Re-saving an image as JPEG removes the mark.</p>
          </Card>
        </div>
      ) : tab === 'integrity' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card title="Verify the audit trail" subtitle="Detects any edit, deletion or insertion made directly in the database">
            <Button icon="shield-check" loading={checking} onClick={verifyChain}>
              Verify integrity now
            </Button>
            {chain && (
              <div className={`mt-4 rounded-xl p-4 text-sm ${chain.valid ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                <p className="flex items-center gap-2 font-semibold">
                  <Icon name={chain.valid ? 'circle-check' : 'circle-x'} className="h-5 w-5" />
                  {chain.valid ? 'The audit trail is intact' : 'Tampering detected'}
                </p>
                <p className="mt-1">
                  {chain.checked.toLocaleString(getLocale())} entries verified
                  {chain.legacy ? `, ${chain.legacy} legacy entries without a chain` : ''}.
                </p>
                {!chain.valid && (
                  <p className="mt-1">
                    First broken entry: #{chain.brokenAt} — {chain.reason}
                  </p>
                )}
                {chain.lastHash && <p className="mt-2 font-mono text-[11px] break-all opacity-70">Head: {chain.lastHash}</p>}
              </div>
            )}
          </Card>
          <Card title="Trace a leaked image" subtitle="Reads the invisible watermark of a PNG downloaded from the File Manager">
            <input ref={fileRef} type="file" accept="image/png" className="hidden" onChange={(e) => e.target.files?.[0] && detect(e.target.files[0])} />
            <Button variant="outline" icon="scan-search" loading={wmBusy} onClick={() => fileRef.current?.click()}>
              Choose PNG image
            </Button>
            {wm && (
              <div className={`mt-4 rounded-xl p-4 text-sm ${wm.found && wm.valid ? 'bg-brand-50 text-brand-900' : 'bg-slate-50 text-slate-700'}`}>
                {!wm.found ? (
                  <p>No watermark found in this image.</p>
                ) : !wm.valid ? (
                  <p>A watermark was found but its signature is invalid (forged or damaged).</p>
                ) : (
                  <>
                    <p className="font-semibold">Watermark verified</p>
                    <p className="mt-1">
                      Downloaded by <b>{wm.userName ?? wm.payload?.n}</b> (@{wm.payload?.n}) on {fmtDateTime(wm.payload?.t)}
                    </p>
                    <p className="mt-1 font-mono text-[11px] opacity-70">File {wm.payload?.f}</p>
                  </>
                )}
              </div>
            )}
          </Card>
          <Card title="Verify a document" subtitle="Paste the link from a document's QR code">
            <div className="flex gap-2">
              <Input value={verifyLink} onChange={(e) => setVerifyLink(e.target.value)} placeholder="https://.../verify?c=..." />
              <Button icon="external-link" onClick={openVerify} disabled={!verifyLink.trim()}>
                Verify
              </Button>
            </div>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card title="Hash generator" subtitle="Computed locally in your browser (Web Crypto)">
            <div className="space-y-3">
              <Field label="Text">
                <Textarea value={hashInput} onChange={(e) => setHashInput(e.target.value)} rows={3} />
              </Field>
              <div className="flex gap-2">
                <Select value={algo} onChange={(e) => setAlgo(e.target.value)} options={['SHA-256', 'SHA-384', 'SHA-512'].map((v) => ({ value: v, label: v }))} />
                <Button icon="hash" onClick={runHash}>
                  Hash
                </Button>
              </div>
              {hashOut && <p className="rounded-lg bg-slate-50 p-3 font-mono text-xs break-all text-slate-700">{hashOut}</p>}
            </div>
          </Card>
          <Card title="Encode / decode" subtitle="Base64, URL and hex conversions (encoding is not encryption)">
            <div className="space-y-3">
              <Field label="Input">
                <Textarea value={codecInput} onChange={(e) => setCodecInput(e.target.value)} rows={3} />
              </Field>
              <div className="flex flex-wrap gap-2">
                {[
                  ['b64e', 'Base64 encode'],
                  ['b64d', 'Base64 decode'],
                  ['urle', 'URL encode'],
                  ['urld', 'URL decode'],
                  ['hexe', 'Hex encode'],
                  ['hexd', 'Hex decode'],
                ].map(([k, l]) => (
                  <Button key={k} size="sm" variant="outline" onClick={() => codec(k)}>
                    {l}
                  </Button>
                ))}
              </div>
              {codecOut && <p className="rounded-lg bg-slate-50 p-3 font-mono text-xs break-all text-slate-700">{codecOut}</p>}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
