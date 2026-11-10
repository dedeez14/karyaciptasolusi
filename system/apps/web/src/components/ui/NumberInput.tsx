import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { fmtNumber } from '@/lib/format';
import { cn } from './primitives';

/** Group and decimal separators of the active number locale (derived from the app formatter). */
function separators() {
  const s = fmtNumber(1234.5, 2); // e.g. "1.234,5" (id-ID) or "1,234.5" (en-US)
  const dec = s.charAt(s.length - 2);
  const group = /[^\d]/.test(s.charAt(1)) ? s.charAt(1) : '';
  return { dec, group };
}

/** Parses what the user typed ("1.500.000", "2,5", "1500000.75") into a plain number string ("1500000.75"). */
export function parseNumberText(text: string): string {
  const t = text.trim().replace(/\s/g, '');
  if (!t) return '';
  const { dec, group } = separators();
  let norm: string;
  if (t.includes(dec)) norm = t.split(group).join('').replace(dec, '.');
  else if (group === '.' && /^-?\d+\.\d{1,2}$|^-?\d+\.\d{4,}$/.test(t))
    norm = t; // "1.5" typed as a decimal point
  else norm = group ? t.split(group).join('') : t;
  norm = norm.replace(/[^\d.-]/g, '');
  const n = Number(norm);
  return Number.isFinite(n) ? String(n) : '';
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  /** maximum fraction digits shown when not editing */
  decimals?: number;
  /** always show this many fraction digits (money) */
  fixed?: number;
  invalid?: boolean;
  allowNegative?: boolean;
};

/**
 * Number field that shows thousand separators while not editing ("1.500.000,00") and accepts
 * both local and plain input. Right aligned, selects its content on focus for quick overwrite.
 */
export const NumberInput = forwardRef<HTMLInputElement, Props>(({ value, onChange, decimals = 4, fixed, invalid, allowNegative, className, onFocus, onBlur, ...rest }, ref) => {
  const [text, setText] = useState<string | null>(null);
  const raw = value === null || value === undefined ? '' : String(value);
  const shown = text ?? (raw === '' || !Number.isFinite(Number(raw)) ? raw : fixed !== undefined ? fmtFixed(raw, fixed) : fmtNumber(raw, decimals));
  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={cn('input text-right tabular-nums', invalid && 'input-error', className)}
      aria-invalid={invalid || undefined}
      value={shown}
      onFocus={(e) => {
        const { dec } = separators();
        setText(raw === '' ? '' : raw.replace('.', dec));
        requestAnimationFrame(() => e.target.select());
        onFocus?.(e);
      }}
      onChange={(e) => {
        let t = e.target.value;
        if (!allowNegative) t = t.replace(/-/g, '');
        setText(t);
        onChange(parseNumberText(t));
      }}
      onBlur={(e) => {
        setText(null);
        onBlur?.(e);
      }}
      {...rest}
    />
  );
});
NumberInput.displayName = 'NumberInput';

function fmtFixed(raw: string, dp: number) {
  const s = fmtNumber(Number(raw), dp);
  const { dec } = separators();
  const [int, frac = ''] = s.split(dec);
  return dp > 0 ? `${int}${dec}${frac.padEnd(dp, '0')}` : int;
}
