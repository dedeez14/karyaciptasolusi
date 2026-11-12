const KEY = 'kcs.theme';
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Applies the company's brand colours to the whole app: every brand-* / accent-* shade is mixed from these two
 * (see index.css). Remembered in this browser so the login screen opens in the same colours.
 */
export function applyTheme(brand?: string | null, accent?: string | null) {
  const root = document.documentElement;
  const b = brand && HEX.test(brand) ? brand : null;
  const a = accent && HEX.test(accent) ? accent : null;
  if (b) root.style.setProperty('--brand', b);
  else root.style.removeProperty('--brand');
  if (a) root.style.setProperty('--accent', a);
  else root.style.removeProperty('--accent');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', b ?? '#1d4f7a');
  try {
    localStorage.setItem(KEY, JSON.stringify({ b, a }));
  } catch {
    /* private mode */
  }
}

/** Colours of the last company used in this browser (before anyone is signed in) */
export function restoreTheme() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { b?: string; a?: string } | null;
    if (t) applyTheme(t.b, t.a);
  } catch {
    /* ignore */
  }
}
