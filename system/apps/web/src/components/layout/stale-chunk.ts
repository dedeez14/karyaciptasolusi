const KEY = 'kcs.staleReloadAt';

/** True when the error means a lazily loaded bundle of an older build is gone. */
export const isStaleChunkError = (e: unknown) => /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(String((e as Error)?.message ?? e));

/**
 * Reloads the page once to pick up the new version. Guarded by a timestamp so a genuinely
 * broken bundle cannot cause a reload loop (at most one automatic reload per minute).
 */
export function reloadForNewVersion(): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0);
  } catch {
    /* storage blocked */
  }
  if (Date.now() - last < 60_000) return false;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage blocked */
  }
  window.location.reload();
  return true;
}
