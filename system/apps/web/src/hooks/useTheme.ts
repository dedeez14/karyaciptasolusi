/**
 * The application uses a single light theme (by request). Dark classes in components stay inert
 * because the `dark` class is never applied to <html>.
 */
export function applyLightTheme() {
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = 'light';
  try {
    localStorage.removeItem('kcs.theme');
  } catch {
    /* storage unavailable */
  }
}

applyLightTheme();
