import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Badge, Button, Card, confirm, Icon, Switch, toast } from '@/components/ui';

interface Sig {
  signature: string | null;
  enabled: boolean;
  updatedAt: string | null;
}

/**
 * Turns a photo / scan of a signature into a clean transparent PNG: paper and shadows become transparent, the ink
 * becomes solid dark blue-black, and the empty margins are cut off.
 */
async function cleanSignature(src: CanvasImageSource & { width: number; height: number }): Promise<Blob> {
  const scale = Math.min(1, 1200 / src.width, 600 / src.height);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < d.length; i += 4) {
    const alpha = d[i + 3] / 255;
    const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * alpha + 255 * (1 - alpha);
    // light pixels (paper) disappear, dark pixels (ink) stay; soft edges keep their smoothness
    const a = Math.max(0, Math.min(255, Math.round(((200 - lum) / 110) * 255)));
    d[i] = 17;
    d[i + 1] = 24;
    d[i + 2] = 39;
    d[i + 3] = a;
    if (a > 40) {
      const p = i / 4;
      const x = p % w;
      const y = (p - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('No signature found in the image');
  ctx.putImageData(img, 0, 0);
  const pad = 8;
  const cx = Math.max(0, minX - pad), cy = Math.max(0, minY - pad);
  const cw = Math.min(w, maxX + pad) - cx, ch = Math.min(h, maxY + pad) - cy;
  const out = document.createElement('canvas');
  out.width = Math.max(40, cw);
  out.height = Math.max(20, ch);
  out.getContext('2d')!.drawImage(c, cx, cy, cw, ch, (out.width - cw) / 2, (out.height - ch) / 2, cw, ch);
  return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('Could not prepare the image'))), 'image/png'));
}

/** Pad to draw the signature with mouse, pen or finger */
function DrawPad({ onDone, onCancel }: { onDone: (canvas: HTMLCanvasElement) => void; onCancel: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    c.width = r.width * 2;
    c.height = r.height * 2;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#111827';
  }, []);
  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left) * 2, (e.clientY - r.top) * 2] as const;
  };
  return (
    <div className="space-y-2">
      <canvas
        ref={ref}
        className="h-44 w-full touch-none rounded-xl border-2 border-dashed border-line bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext('2d')!;
          ctx.beginPath();
          ctx.moveTo(...at(e));
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          ctx.lineTo(...at(e));
          ctx.stroke();
          setEmpty(false);
        }}
        onPointerUp={() => (drawing.current = false)}
        aria-label="Draw your signature here"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button icon="check" disabled={empty} onClick={() => onDone(ref.current!)}>
          Use this signature
        </Button>
      </div>
    </div>
  );
}

/** My Profile: the signature placed on documents I sign (letters, approved invoices, purchase orders...) */
export function SignatureCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me', 'signature'], queryFn: () => api.get<Sig>('/auth/me/signature') });
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const set = (s: Sig) => qc.setQueryData(['me', 'signature'], s);

  const upload = async (blob: Blob) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', blob, 'signature.png');
      fd.append('enabled', 'true');
      set(await api.post<Sig>('/auth/me/signature', fd));
      toast.success('Signature saved');
      setDrawing(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const fromFile = async (f: File) => {
    try {
      const bmp = await createImageBitmap(f);
      await upload(await cleanSignature(bmp));
    } catch (e) {
      toast.error(e);
    }
  };

  const s = q.data;
  return (
    <Card
      title="My signature"
      subtitle="Placed on documents you sign: company letters and approved invoices, quotations and purchase orders"
      actions={s?.signature ? <Badge tone={s.enabled ? 'green' : 'gray'}>{s.enabled ? 'Used on documents' : 'Not used'}</Badge> : undefined}
    >
      <div className="space-y-4">
        {drawing ? (
          <DrawPad onCancel={() => setDrawing(false)} onDone={(c) => cleanSignature(c).then(upload).catch(toast.error)} />
        ) : s?.signature ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-28 flex-1 items-center justify-center rounded-xl border border-line bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-3">
              <img src={s.signature} alt="Your signature" className="max-h-full max-w-full object-contain" />
            </div>
            <div className="space-y-2 text-sm sm:w-56">
              <Switch
                checked={s.enabled}
                disabled={busy}
                onChange={async (v) => {
                  try {
                    set(await api.patch<Sig>('/auth/me/signature', { enabled: v }));
                  } catch (e) {
                    toast.error(e);
                  }
                }}
                label="Use on documents"
              />
              {s.updatedAt && <p className="text-xs text-slate-500">Saved {fmtDateTime(s.updatedAt)}</p>}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <Icon name="pen-line" className="h-5 w-5 shrink-0 text-slate-400" />
            No signature yet. Upload a photo of your signature on white paper, or draw it.
          </div>
        )}
        {!drawing && (
          <div className="flex flex-wrap gap-2">
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && fromFile(e.target.files[0])} />
            <Button variant="outline" icon="upload" loading={busy} onClick={() => file.current?.click()}>
              {s?.signature ? 'Replace with photo' : 'Upload photo'}
            </Button>
            <Button variant="outline" icon="pen-line" onClick={() => setDrawing(true)}>
              Draw signature
            </Button>
            {s?.signature && (
              <Button
                variant="ghost"
                icon="trash-2"
                className="text-red-600"
                onClick={async () => {
                  if (!(await confirm({ title: 'Remove your signature?', message: 'Documents will no longer carry it.', danger: true }))) return;
                  try {
                    set(await api.delete<Sig>('/auth/me/signature'));
                  } catch (e) {
                    toast.error(e);
                  }
                }}
              >
                Remove
              </Button>
            )}
          </div>
        )}
        <p className="text-xs text-slate-500">
          Stored encrypted and only used while "Use on documents" is on. Which user signs documents is set in Settings &gt; Documents.
        </p>
      </div>
    </Card>
  );
}
