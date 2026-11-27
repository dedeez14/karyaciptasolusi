import { useEffect, useRef, useState } from 'react';
import { Button, Icon, Input, Modal } from '@/components/ui';

interface Detector {
  detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => Detector;
  }
}

/**
 * Barcode entry for stock work: a handheld (keyboard) scanner types the code and presses Enter,
 * or the phone camera reads it (Chrome / Edge / Android; needs https or localhost). Typing the code also works.
 */
export function ScanInput({ onScan, placeholder = 'Scan or type a barcode / product code', autoFocus = true, busy }: { onScan: (code: string) => void; placeholder?: string; autoFocus?: boolean; busy?: boolean }) {
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const supported = typeof window !== 'undefined' && !!window.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia;
  const submit = (code: string) => {
    const c = code.trim();
    if (!c) return;
    onScan(c);
    setValue('');
    ref.current?.focus();
  };
  return (
    <div className="flex gap-2">
      <div className="relative min-w-0 flex-1">
        <Icon name="barcode" className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          ref={ref}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit(value);
            }
          }}
          placeholder={placeholder}
          className="pl-9"
          inputMode="text"
          autoComplete="off"
          aria-label="Barcode"
          disabled={busy}
        />
      </div>
      <Button variant="outline" icon="search" onClick={() => submit(value)} disabled={!value.trim() || busy} aria-label="Find" />
      {supported && (
        <Button variant="outline" icon="camera" onClick={() => setCamera(true)} aria-label="Scan with the camera">
          <span className="hidden sm:inline">Camera</span>
        </Button>
      )}
      {camera && (
        <CameraScanner
          onClose={() => setCamera(false)}
          onCode={(c) => {
            setCamera(false);
            submit(c);
          }}
        />
      )}
    </div>
  );
}

function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new window.BarcodeDetector!({ formats: ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_39', 'qr_code'] });
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            if (found[0]?.rawValue) {
              if (navigator.vibrate) navigator.vibrate(60);
              onCode(found[0].rawValue);
              return;
            }
          } catch {
            /* frame not ready */
          }
          timer = window.setTimeout(tick, 250);
        };
        void tick();
      } catch {
        setError('The camera could not be opened. Allow camera access, or use a handheld scanner / type the code.');
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  return (
    <Modal open onClose={onClose} title="Scan barcode" size="sm">
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={video} className="aspect-[4/3] w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">Hold the barcode in the frame; it is read automatically.</p>
    </Modal>
  );
}
