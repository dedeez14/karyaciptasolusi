import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import App from './App';
import { reloadForNewVersion } from '@/components/layout/stale-chunk';
import './index.css';

// A page bundle of an older build could not be loaded (the app was updated while this tab was open):
// reload once into the new version. Icons are skipped - a missing icon must never interrupt the user's work.
window.addEventListener('vite:preloadError', (e) => {
  const msg = String((e as Event & { payload?: Error }).payload?.message ?? '');
  if (msg.includes('/assets/icons/')) return;
  if (reloadForNewVersion()) e.preventDefault();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
