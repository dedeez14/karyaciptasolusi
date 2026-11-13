import { lazy, Suspense, useEffect, useState } from 'react';
import { create } from 'zustand';
import { api } from '@/lib/api';
import { isTouchDevice, openInNewTab } from '@/lib/download';
import { Modal } from './overlay';
import { Button, Spinner } from './primitives';
import { toast } from './toast';
import { Icon } from './Icon';

const PdfViewer = lazy(() => import('./PdfViewer'));

interface PreviewReq {
  path: string;
  title: string;
  params?: Record<string, unknown>;
  /** POST this JSON instead of a GET (previews of unsaved data) */
  body?: unknown;
}
const usePreview = create<{ req: PreviewReq | null }>(() => ({ req: null }));

/**
 * Shows a PDF / image from the API inside the app on every device (also the installed app on Android, where the
 * browser would only download a PDF), with print, share and download.
 */
export function previewFile(req: PreviewReq): Promise<void> {
  usePreview.setState({ req });
  return Promise.resolve();
}

interface Loaded {
  blob: Blob;
  name: string;
  url: string;
  pdf: ArrayBuffer | null;
}

/** Prints a PDF with the browser's print dialog (desktop): a hidden frame with the file, then print() */
function printPdf(url: string) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank', 'noopener');
    }
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

export function PreviewHost() {
  const req = usePreview((s) => s.req);
  const [file, setFile] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const close = () => usePreview.setState({ req: null });
  const touch = isTouchDevice();

  useEffect(() => {
    setFile(null);
    setError('');
    if (!req) return;
    let gone = false;
    let url = '';
    (req.body !== undefined ? api.blobPost(req.path, req.body) : api.blob(req.path, req.params))
      .then(async ({ blob, name }) => {
        if (gone) return;
        url = URL.createObjectURL(blob);
        const pdf = blob.type.includes('pdf') || /\.pdf$/i.test(name) ? await blob.arrayBuffer() : null;
        if (!gone) setFile({ blob, name, url, pdf });
      })
      .catch((e) => !gone && setError((e as Error).message));
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [req]);

  const save = () => {
    if (!file) return;
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const shareable = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([file.blob], file.name, { type: file.blob.type })] });
  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [new File([file.blob], file.name, { type: file.blob.type })], title: req?.title });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error(e);
    }
  };

  return (
    <Modal
      open={!!req}
      onClose={close}
      title={req?.title ?? ''}
      size="xl"
      footer={
        req && (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            {!touch && req.body === undefined && (
              <Button variant="ghost" icon="external-link" className="mr-auto" onClick={() => openInNewTab(req.path, req.params).catch(toast.error)}>
                New tab
              </Button>
            )}
            {shareable && touch && (
              <Button variant="outline" icon="share-2" onClick={share}>
                Share
              </Button>
            )}
            <Button variant={file?.pdf && !touch ? 'outline' : 'primary'} icon="download" disabled={!file} onClick={save}>
              Download
            </Button>
            {file?.pdf && !touch && (
              <Button icon="printer" onClick={() => printPdf(file.url)}>
                Print
              </Button>
            )}
          </div>
        )
      }
    >
      <div className="flex h-[72vh] items-center justify-center overflow-hidden rounded-lg bg-slate-100">
        {error ? (
          <p className="flex items-center gap-2 px-4 text-sm text-red-600">
            <Icon name="circle-alert" /> {error}
          </p>
        ) : !file ? (
          <Spinner className="h-6 w-6 text-brand-700" />
        ) : file.pdf ? (
          <Suspense fallback={<Spinner className="h-6 w-6 text-brand-700" />}>
            <PdfViewer data={file.pdf} title={req?.title ?? ''} />
          </Suspense>
        ) : file.blob.type.startsWith('image/') ? (
          <img src={file.url} alt={req?.title ?? ''} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="text-center text-sm text-slate-600">
            <Icon name="file" className="mx-auto mb-2 h-8 w-8 text-slate-400" />
            This file cannot be shown here. Use Download.
          </div>
        )}
      </div>
    </Modal>
  );
}
