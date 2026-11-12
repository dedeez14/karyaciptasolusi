import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Icon } from './Icon';
import { Spinner } from './primitives';

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Draws a PDF inside the app (PDF.js), page by page, fitted to the width of the box. Works the same on desktop,
 * phones and the installed app - Android browsers have no built-in PDF viewer and would download the file instead.
 */
export default function PdfViewer({ data, title }: { data: ArrayBuffer; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ loading: boolean; error: string; pages: number }>({ loading: true, error: '', pages: 0 });
  /** 1 = page fitted to the width of the viewer */
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const el = box.current;
    if (!el) return;
    el.replaceChildren();
    setState({ loading: true, error: '', pages: 0 });
    const task = getDocument({ data: new Uint8Array(data.slice(0)), standardFontDataUrl: '/pdfjs/standard_fonts/' });
    (async () => {
      const doc = await task.promise;
      if (cancelled) return;
      setState({ loading: false, error: '', pages: doc.numPages });
      const width = Math.max(280, el.clientWidth - 24);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      for (let i = 1; i <= doc.numPages && !cancelled; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(1.75, width / base.width) * zoom;
        const vp = page.getViewport({ scale: scale * dpr });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
        canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
        canvas.className = 'mx-auto mb-3 block rounded-sm bg-white shadow-card';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `${title} - page ${i} of ${doc.numPages}`);
        el.appendChild(canvas);
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
      }
    })().catch((e) => !cancelled && setState({ loading: false, error: (e as Error).message || 'Could not show the PDF', pages: 0 }));
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [data, title, zoom]);

  return (
    <div className="relative h-full w-full overflow-auto p-3">
      {state.pages > 0 && (
        <div className="sticky top-0 z-10 mb-2 flex justify-end">
          <div className="flex items-center gap-1 rounded-lg bg-white/95 p-1 text-xs font-medium text-slate-700 shadow-card ring-1 ring-line">
            <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - 0.5))} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-40">
              <Icon name="zoom-out" className="h-4 w-4" />
            </button>
            <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, z + 0.5))} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-40">
              <Icon name="zoom-in" className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {state.loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner className="h-6 w-6 text-brand-700" />
        </div>
      )}
      {state.error && (
        <p className="flex h-full items-center justify-center gap-2 text-sm text-red-600">
          <Icon name="circle-alert" /> {state.error}
        </p>
      )}
      <div ref={box} />
    </div>
  );
}
