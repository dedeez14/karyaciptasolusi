import { api, qs } from './api';

/** Downloads a file from the API (auth headers included) and saves it in the browser */
export async function download(path: string, params?: Record<string, unknown>) {
  const { blob, name } = await api.blob(path, params);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Returns a same-origin URL that renders the file natively (browser PDF viewer, images).
 * Uses a single-use, 60 second ticket bound to this path - the access token never appears in a URL.
 */
export async function fileUrl(path: string, params?: Record<string, unknown>) {
  const { ticket } = await api.post<{ ticket: string }>('/auth/ticket', { path });
  return `/api/v1${path}${qs({ ...params, inline: 1, ticket })}`;
}

/** Opens a PDF / image in a new browser tab */
export async function openInNewTab(path: string, params?: Record<string, unknown>) {
  // open synchronously (inside the click) so pop-up blockers allow it, then point it at the file
  const w = window.open('about:blank', '_blank');
  try {
    const url = await fileUrl(path, params);
    if (w) w.location.href = url;
    else window.location.assign(url);
  } catch (e) {
    w?.close();
    throw e;
  }
}

export const isTouchDevice = () => window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
