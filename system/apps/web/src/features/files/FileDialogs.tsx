import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmtBytes, fmtDateTime } from '@/lib/format';
import { download, fileUrl } from '@/lib/download';
import { Badge, Button, Field, Icon, Input, LookupSelect, Modal, Select, Spinner, Textarea, toast } from '@/components/ui';
import { folderOptions, type FileRow, type Folder } from './fileTypes';
import { useLookupLabel } from '@/hooks/useLookups';

type Opt = { value: string; label: string };

export function FolderDialog({ open, onClose, folder, folders, parentId, onSaved }: { open: boolean; onClose: () => void; folder: Folder | null; folders: Folder[]; parentId: string | null; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', parentId: '', color: '#2563eb', description: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setForm({ name: folder?.name ?? '', parentId: folder?.parentId ?? parentId ?? '', color: folder?.color ?? '#2563eb', description: folder?.description ?? '' });
  }, [open, folder, parentId]);
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, parentId: form.parentId || null };
      if (folder) await api.patch(`/files/folders/${folder.id}`, body);
      else await api.post('/files/folders', body);
      toast.success(folder ? 'Folder updated' : 'Folder created');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={folder ? 'Edit folder' : 'New folder'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!form.name.trim()} icon="save">
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Name" required>
          <Input value={form.name} maxLength={150} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Parent folder">
          <Select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} options={folderOptions(folders, folder?.id)} placeholder="(Top level)" />
        </Field>
        <Field label="Color">
          <div className="flex gap-2">
            {['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#64748b'].map((c) => (
              <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} className="h-7 w-7 rounded-full ring-offset-2" style={{ background: c, boxShadow: form.color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined }} aria-label={c} />
            ))}
          </div>
        </Field>
        <Field label="Description">
          <Textarea value={form.description} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export function EditFileDialog({ file, onClose, folders, categories, onSaved }: { file: FileRow | null; onClose: () => void; folders: Folder[]; categories: Opt[]; onSaved: () => void }) {
  const sourceLabel = useLookupLabel('FILE_SOURCE');
  void categories;
  const [form, setForm] = useState({ name: '', folderId: '', categoryCode: '', tags: '', description: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (file) setForm({ name: file.name, folderId: file.folderId ?? '', categoryCode: file.categoryCode ?? '', tags: file.tags.join(', '), description: file.description ?? '' });
  }, [file]);
  const save = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await api.patch(`/files/${file.id}`, {
        name: form.name,
        folderId: form.folderId || null,
        categoryCode: form.categoryCode || null,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        description: form.description || null,
      });
      toast.success('File updated');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!file}
      onClose={onClose}
      title="File details"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} icon="save">
            Save
          </Button>
        </>
      }
    >
      {file && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs">
            <span className="text-slate-500">Size</span>
            <span>{fmtBytes(file.size)}</span>
            <span className="text-slate-500">Type</span>
            <span>{file.mimeType}</span>
            <span className="text-slate-500">Source</span>
            <span>{sourceLabel(file.source)}</span>
            <span className="text-slate-500">Uploaded</span>
            <span>
              {fmtDateTime(file.createdAt)} {file.uploadedBy && `by ${file.uploadedBy}`}
            </span>
          </div>
          <Field label="Name" required>
            <Input value={form.name} maxLength={200} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Folder">
              <Select value={form.folderId} onChange={(e) => setForm({ ...form, folderId: e.target.value })} options={folderOptions(folders)} placeholder="(Unfiled)" />
            </Field>
            <Field label="Category">
              <LookupSelect category="FILE_CATEGORY" value={form.categoryCode} onChange={(v) => setForm({ ...form, categoryCode: v })} placeholder="—" />
            </Field>
          </div>
          <Field label="Tags" help="Comma separated">
            <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="contract, 2026" />
          </Field>
          <Field label="Description">
            <Textarea value={form.description} maxLength={1000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

export function PreviewDialog({ file, onClose }: { file: FileRow | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!file) return;
    let objectUrl: string | null = null;
    setUrl(null);
    setError('');
    const load =
      file.fileType === 'image'
        ? api.blob(`/files/${file.id}/download`, { inline: 1 }).then(({ blob }) => (objectUrl = URL.createObjectURL(blob)))
        : fileUrl(`/files/${file.id}/download`);
    load.then(setUrl).catch((e) => setError(e.message));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  const previewable = !!file && (file.fileType === 'image' || file.fileType === 'pdf' || file.mimeType === 'text/plain');
  return (
    <Modal
      open={!!file}
      onClose={onClose}
      title={file?.name ?? ''}
      size="xl"
      footer={
        file && (
          <Button icon="download" onClick={() => download(`/files/${file.id}/download`).catch(toast.error)}>
            Download
          </Button>
        )
      }
    >
      {file && (
        <div className="flex min-h-[50vh] items-center justify-center">
          {error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : !previewable ? (
            <div className="text-center text-sm text-slate-500">
              <Icon name="eye-off" className="mx-auto mb-2 h-8 w-8" />
              Preview is not available for this file type.
              <div className="mt-2">
                <Badge>{file.mimeType}</Badge>
              </div>
            </div>
          ) : !url ? (
            <Spinner />
          ) : file.fileType === 'image' ? (
            <img src={url} alt={file.name} className="max-h-[70vh] max-w-full rounded object-contain" />
          ) : (
            <iframe key={url} src={url} title={file.name} className="h-[70vh] w-full rounded border border-line bg-white" />
          )}
        </div>
      )}
    </Modal>
  );
}

export function BulkDialog({ mode, onClose, folders, onApply }: { mode: 'move' | 'tag' | null; onClose: () => void; folders: Folder[]; onApply: (payload: { folderId?: string | null; tags?: string[] }) => Promise<void> }) {
  const [folderId, setFolderId] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setBusy(true);
    try {
      await onApply(mode === 'move' ? { folderId: folderId || null } : { tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!mode}
      onClose={onClose}
      size="sm"
      title={mode === 'move' ? 'Move files' : 'Add tags'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply} loading={busy} disabled={mode === 'tag' && !tags.trim()}>
            Apply
          </Button>
        </>
      }
    >
      {mode === 'move' ? (
        <Field label="Destination folder">
          <Select value={folderId} onChange={(e) => setFolderId(e.target.value)} options={folderOptions(folders)} placeholder="(Unfiled)" />
        </Field>
      ) : (
        <Field label="Tags" help="Comma separated, added to existing tags">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} autoFocus />
        </Field>
      )}
    </Modal>
  );
}
