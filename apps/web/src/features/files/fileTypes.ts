export interface FileRow {
  id: string;
  name: string;
  mimeType: string;
  extension: string;
  size: number;
  tags: string[];
  categoryCode: string | null;
  source: 'UPLOAD' | 'GENERATED' | 'EXPORT';
  fileType: string;
  uploadedBy: string | null;
  createdAt: string;
  folderId: string | null;
  description: string | null;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
  description: string | null;
  files: number;
  size: number;
}

export interface FolderResponse {
  root: { files: number; size: number };
  folders: Folder[];
}

export interface Group {
  key: string;
  files: number;
  size: number;
}

export const TYPE_META: Record<string, { label: string; icon: string; color: string }> = {
  image: { label: 'Images', icon: 'image', color: '#8b5cf6' },
  pdf: { label: 'PDF', icon: 'file-text', color: '#ef4444' },
  document: { label: 'Documents', icon: 'file-type', color: '#2563eb' },
  spreadsheet: { label: 'Spreadsheets', icon: 'file-spreadsheet', color: '#10b981' },
  presentation: { label: 'Presentations', icon: 'presentation', color: '#f59e0b' },
  archive: { label: 'Archives', icon: 'file-archive', color: '#64748b' },
  other: { label: 'Other', icon: 'file', color: '#06b6d4' },
};

export const SOURCE_LABEL: Record<string, string> = { UPLOAD: 'Uploaded', GENERATED: 'Generated', EXPORT: 'Export' };

/** Flattens the folder tree into indented select options */
export function folderOptions(folders: Folder[], exclude?: string): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of folders.filter((x) => x.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name))) {
      if (f.id === exclude) continue;
      out.push({ value: f.id, label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${f.name}` });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
