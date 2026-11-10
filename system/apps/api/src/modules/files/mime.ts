/**
 * Magic-byte content sniffing. Returns a trusted MIME type, `null` when unknown,
 * or 'blocked' for executables / scripts disguised under another extension.
 */
export function sniffMime(buf: Buffer, ext: string): string | null | 'blocked' {
  const hex = buf.subarray(0, 8).toString('hex');
  const head = buf.subarray(0, 512).toString('latin1').trimStart().toLowerCase();

  if (hex.startsWith('4d5a')) return 'blocked'; // Windows PE (exe/dll)
  if (hex.startsWith('7f454c46')) return 'blocked'; // ELF
  if (hex.startsWith('cafebabe') || hex.startsWith('feedface') || hex.startsWith('cffaedfe')) return 'blocked'; // Mach-O / class
  if (head.startsWith('#!')) return 'blocked'; // shell scripts
  if (['html', 'htm', 'svg', 'js', 'mjs', 'xml'].includes(ext) || /^<(!doctype html|html|script|svg)/.test(head)) return 'blocked'; // stored XSS vectors

  if (hex.startsWith('25504446')) return 'application/pdf';
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('52494646') && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (hex.startsWith('504b0304')) {
    const map: Record<string, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      odt: 'application/vnd.oasis.opendocument.text',
      ods: 'application/vnd.oasis.opendocument.spreadsheet',
    };
    return map[ext] ?? 'application/zip';
  }
  if (hex.startsWith('d0cf11e0')) {
    return ({ doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint' } as Record<string, string>)[ext] ?? 'application/octet-stream';
  }
  if (hex.startsWith('377abcaf')) return 'application/x-7z-compressed';
  if (hex.startsWith('52617221')) return 'application/x-rar-compressed';
  if (hex.startsWith('1f8b')) return 'application/gzip';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'txt' || ext === 'md') return 'text/plain';
  if (ext === 'rtf') return 'application/rtf';
  return null;
}
