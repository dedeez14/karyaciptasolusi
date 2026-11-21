import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { memo } from 'react';

/**
 * Font Awesome Pro sprite made at build time from the licensed kit (scripts/fa-icons.mjs). The manifest is git-ignored,
 * so a checkout without the kit has none and every icon falls back to the built-in (lucide) set.
 */
const manifest = (Object.values(import.meta.glob('./fa.generated.json', { eager: true, import: 'default' }))[0] ?? { sprite: null, names: [] }) as {
  sprite: string | null;
  names: string[];
};
const FA = new Set(manifest.sprite ? manifest.names : []);

/**
 * Icon by name (names are data driven, e.g. from Menu Management). Font Awesome Pro (regular; `solid` for selected
 * states) when available, otherwise the lucide icon of the same name.
 */
export const Icon = memo(function Icon({ name, className = 'h-4 w-4', solid }: { name?: string | null; className?: string; solid?: boolean }) {
  if (!name) return null;
  if (FA.has(name)) {
    return (
      <svg className={`fa-icon ${className}`} fill="currentColor" aria-hidden focusable="false">
        <use href={`${manifest.sprite}#${solid ? 's' : 'r'}-${name}`} />
      </svg>
    );
  }
  return <DynamicIcon name={name as IconName} className={className} aria-hidden fallback={() => <span className={className} />} />;
});
