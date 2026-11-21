import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
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

/** largest number of whole digits accepted (the server allows up to 9.999.999.999.999) */
const MAX_INT_DIGITS = 13;

interface Parsed {
  /** shown text, grouped while typing ("12.500.000,5") */
  display: string;
  /** plain number string for the form ("12500000.5"), "" when empty */
  value: string;
}

/**
 * Formats text while typing: keeps digits and one decimal separator (the local one), groups the whole part
 * and limits the fraction to `decimals`. Group separators the user types are ignored (they are added back).
 */
export function live(text: string, decimals: number, allowNegative: boolean, grouping: boolean): Parsed {
  const { dec, group } = separators();
  let t = text.replace(/\s/g, '');
  const neg = allowNegative && t.startsWith('-');
  t = t.replace(/-/g, '');
  const decAt = decimals > 0 ? t.indexOf(dec) : -1;
  let whole = (decAt >= 0 ? t.slice(0, decAt) : t).replace(/\D/g, '');
  let frac = decAt >= 0 ? t.slice(decAt + 1).replace(/\D/g, '') : '';
  const hasDec = decAt >= 0;
  frac = frac.slice(0, decimals);
  whole = whole.replace(/^0+(?=\d)/, '').slice(0, MAX_INT_DIGITS);
  if (!whole && !frac && !hasDec) return { display: neg ? '-' : '', value: '' };
  const wholeShown = grouping && group ? (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, group) : whole || '0';
  return {
    display: `${neg ? '-' : ''}${whole || hasDec ? wholeShown : ''}${hasDec ? dec + frac : ''}`,
    value: `${neg ? '-' : ''}${whole || '0'}${frac ? `.${frac}` : ''}`,
  };
}

export function formatNumberValue(raw: string, decimals: number, fixed: number | undefined, grouping: boolean): string {
  if (raw === '' || !Number.isFinite(Number(raw))) return raw;
  const { dec, group } = separators();
  const n = Number(raw);
  let s = fixed !== undefined ? fmtNumber(n, fixed) : fmtNumber(n, decimals);
  if (fixed !== undefined && fixed > 0) {
    const [int, f = ''] = s.split(dec);
    s = `${int}${dec}${f.padEnd(fixed, '0')}`;
  }
  return grouping || !group ? s : s.split(group).join('');
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  /** maximum fraction digits (0 = whole numbers only) */
  decimals?: number;
  /** always show this many fraction digits when not editing (money) */
  fixed?: number;
  invalid?: boolean;
  allowNegative?: boolean;
  /** thousand separators (off for years, codes and sort orders) */
  grouping?: boolean;
  /** shown as invalid (red) outside this range; the server enforces the same rule */
  min?: number;
  max?: number;
};

/**
 * Number field with thousand separators while typing ("12.500.000") in the company's number format.
 * Accepts local and plain input (pasting "1500000.75" works), keeps the caret in place, selects its content on
 * focus for quick overwrite and marks values outside min / max.
 */
export const NumberInput = forwardRef<HTMLInputElement, Props>(
  ({ value, onChange, decimals = 4, fixed, invalid, allowNegative, grouping = true, min, max, className, onFocus, onBlur, title, ...rest }, ref) => {
    const el = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => el.current as HTMLInputElement);
    const maxDp = fixed !== undefined ? Math.max(fixed, decimals === 4 ? fixed : decimals) : decimals;
    const [text, setText] = useState<string | null>(null);
    const caret = useRef<number | null>(null);
    const raw = value === null || value === undefined ? '' : String(value);
    const shown = text ?? formatNumberValue(raw, maxDp, fixed, grouping);
    const n = raw === '' ? null : Number(raw);
    const outOfRange = n !== null && Number.isFinite(n) && ((min !== undefined && n < min) || (max !== undefined && n > max));
    const bad = invalid || outOfRange;

    // put the caret back after the same digit once the grouped text is rendered
    useLayoutEffect(() => {
      if (caret.current === null || !el.current) return;
      const want = caret.current;
      caret.current = null;
      const s = el.current.value;
      let seen = 0;
      let pos = s.length;
      if (want === 0) pos = s.startsWith('-') ? 1 : 0;
      else
        for (let i = 0; i < s.length; i++) {
          if (/[\d]/.test(s[i]) || s[i] === separators().dec) seen++;
          if (seen === want) {
            pos = i + 1;
            break;
          }
        }
      el.current.setSelectionRange(pos, pos);
    });

    return (
      <input
        ref={el}
        type="text"
        inputMode={maxDp > 0 ? 'decimal' : 'numeric'}
        autoComplete="off"
        className={cn('input text-right tabular-nums', bad && 'input-error', className)}
        aria-invalid={bad || undefined}
        title={outOfRange ? (min !== undefined && max !== undefined ? `Between ${formatNumberValue(String(min), maxDp, undefined, grouping)} and ${formatNumberValue(String(max), maxDp, undefined, grouping)}` : min !== undefined ? `At least ${formatNumberValue(String(min), maxDp, undefined, grouping)}` : `At most ${formatNumberValue(String(max), maxDp, undefined, grouping)}`) : title}
        value={shown}
        onFocus={(e) => {
          setText(formatNumberValue(raw, maxDp, undefined, grouping));
          requestAnimationFrame(() => e.target.select());
          onFocus?.(e);
        }}
        onPaste={(e) => {
          // pasting a whole number ("1500000.75", "1.500.000", "Rp 2,5") replaces the field: read it like typed text
          const input = e.currentTarget;
          const all = input.selectionStart === 0 && input.selectionEnd === input.value.length;
          if (!all && input.value !== '') return;
          const plain = parseNumberText(e.clipboardData.getData('text').replace(/[^\d.,-]/g, ''));
          if (plain === '') return;
          e.preventDefault();
          const p = live(plain.replace('.', separators().dec), maxDp, !!allowNegative, grouping);
          caret.current = null;
          setText(p.display);
          onChange(p.value);
        }}
        onChange={(e) => {
          const t = e.target.value;
          const { dec } = separators();
          // digits (and the decimal separator) before the caret decide where it goes after regrouping
          const before = t.slice(0, e.target.selectionStart ?? t.length);
          caret.current = [...before].filter((c) => /\d/.test(c) || c === dec).length;
          const p = live(t, maxDp, !!allowNegative, grouping);
          setText(p.display);
          onChange(p.value);
        }}
        onBlur={(e) => {
          setText(null);
          onBlur?.(e);
        }}
        {...rest}
      />
    );
  },
);
NumberInput.displayName = 'NumberInput';
