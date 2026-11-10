import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { memo } from 'react';

/** Icon by name (names are data driven, e.g. from Menu Management). Icons load lazily and are cached by the PWA. */
export const Icon = memo(function Icon({ name, className = 'h-4 w-4' }: { name?: string | null; className?: string }) {
  if (!name) return null;
  return <DynamicIcon name={name as IconName} className={className} aria-hidden fallback={() => <span className={className} />} />;
});
