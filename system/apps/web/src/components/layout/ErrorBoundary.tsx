import { Component, type ReactNode } from 'react';
import { EmptyState } from '@/components/ui/primitives';
import { isStaleChunkError, reloadForNewVersion } from './stale-chunk';

/** Keeps the shell usable when one page crashes; resets on navigation (key). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (this.state.error) {
      // stale chunk after an update -> reload once to fetch the new version
      if (isStaleChunkError(this.state.error)) reloadForNewVersion();
      return (
        <EmptyState
          icon="triangle-alert"
          title="Something went wrong on this page"
          description="Please reload the page. If the problem persists, contact your administrator."
          action={
            <button type="button" className="text-sm font-medium text-brand-700 hover:underline" onClick={() => window.location.reload()}>
              Reload page
            </button>
          }
        />
      );
    }
    return this.props.children;
  }
}
