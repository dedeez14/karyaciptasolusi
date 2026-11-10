import { api } from './api';

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

/** Opens a PDF / image from the API in a new tab (blob URL, so the token never appears in a URL) */
export async function openInNewTab(path: string, params?: Record<string, unknown>) {
  const w = window.open('', '_blank');
  const { blob } = await api.blob(path, { ...params, inline: 1 });
  const url = URL.createObjectURL(blob);
  if (w) w.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
