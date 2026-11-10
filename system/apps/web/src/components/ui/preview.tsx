import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { download, fileUrl, isTouchDevice, openInNewTab } from '@/lib/download';
import { Modal } from './overlay';
import { Button, Spinner } from './primitives';
import { toast } from './toast';
import { Icon } from './Icon';

interface PreviewReq {
  path: string;
  title: string;
  params?: Record<string, unknown>;
}
const usePreview = create<{ req: PreviewReq | null }>(() => ({ req: null }));

/**
 * Shows a PDF / image from the API. Desktop: in-app viewer with download / new-tab actions.
 * Phones & tablets (no reliable in-page PDF rendering): opens the browser's own viewer.
 */
export function previewFile(req: PreviewReq): Promise<void> {
  if (isTouchDevice()) return openInNewTab(req.path, req.params);
  usePreview.setState({ req });
  return Promise.resolve();
}

export function PreviewHost() {
  const req = usePreview((s) => s.req);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const close = () => usePreview.setState({ req: null });

  useEffect(() => {
    setUrl(null);
    setError('');
    if (!req) return;
    fileUrl(req.path, req.params)
      .then(setUrl)
      .catch((e) => setError(e.message));
  }, [req]);

  return (
    <Modal
      open={!!req}
      onClose={close}
      title={req?.title ?? ''}
      size="xl"
      footer={
        req && (
          <>
            <Button variant="outline" icon="external-link" onClick={() => openInNewTab(req.path, req.params).catch(toast.error)}>
              Open in new tab
            </Button>
            <Button icon="download" onClick={() => download(req.path, req.params).catch(toast.error)}>
              Download
            </Button>
          </>
        )
      }
    >
      <div className="flex h-[72vh] items-center justify-center overflow-hidden rounded-lg bg-slate-100">
        {error ? (
          <p className="flex items-center gap-2 text-sm text-red-600">
            <Icon name="circle-alert" /> {error}
          </p>
        ) : !url ? (
          <Spinner className="h-6 w-6 text-brand-700" />
        ) : (
          <iframe key={url} src={url} title={req?.title} className="h-full w-full border-0 bg-white" />
        )}
      </div>
    </Modal>
  );
}
