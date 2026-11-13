import { clsx } from 'clsx';
import { forwardRef, useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';

export const cn = clsx;

// ---------------------------------------------------------------- Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-[0_1px_2px_rgb(16_24_40/0.1)] hover:bg-brand-700',
  secondary: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
  outline: 'border border-line bg-white text-slate-700 shadow-[0_1px_2px_rgb(16_24_40/0.05)] hover:bg-slate-50 hover:text-slate-900',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-red-600 text-white shadow-xs hover:bg-red-700',
  success: 'bg-emerald-600 text-white shadow-xs hover:bg-emerald-700',
};
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'icon';
  icon?: string;
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ variant = 'primary', size = 'md', icon, loading, className, children, disabled, type = 'button', ...rest }, ref) => (
  <button
    ref={ref}
    type={type}
    disabled={disabled || loading}
    className={cn(
      'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
      size === 'sm' && 'h-8 px-3 text-[13px]',
      size === 'md' && 'h-10 px-4 text-sm',
      size === 'icon' && 'h-9 w-9 text-sm',
      variants[variant],
      className,
    )}
    {...rest}
  >
    {loading ? <Spinner className="h-4 w-4" /> : icon ? <Icon name={icon} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : null}
    {children}
  </button>
));

// ---------------------------------------------------------------- Inputs
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(({ className, invalid, ...rest }, ref) => (
  <input ref={ref} className={cn('input', invalid && 'input-error', className)} {...rest} />
));
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(({ className, invalid, rows = 3, ...rest }, ref) => (
  <textarea ref={ref} rows={rows} className={cn('input', invalid && 'input-error', className)} {...rest} />
));
export function Checkbox({ label, checked, onChange, disabled }: { label?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm select-none', disabled && 'cursor-not-allowed opacity-60')}>
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-brand-600" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2.5 text-sm select-none', disabled && 'opacity-60')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-slate-200')}
      >
        <span className={cn('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform', checked && 'translate-x-5')} />
      </button>
      {label}
    </label>
  );
}

export function Field({ label, error, required, help, children, className }: { label?: ReactNode; error?: string; required?: boolean; help?: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const control = () => ref.current?.querySelector<HTMLElement>('input:not([type=hidden]),textarea,select,button');
  // name the control after its label (screen readers) - custom selects keep their current value in the name
  useLayoutEffect(() => {
    if (!label) return;
    const c = control();
    if (!c || c.getAttribute('aria-labelledby')) return;
    if (c.tagName === 'BUTTON') {
      if (!c.id) c.id = `${labelId}-control`;
      c.setAttribute('aria-labelledby', `${labelId} ${c.id}`);
    } else c.setAttribute('aria-labelledby', labelId);
  });
  return (
    <div className={className} ref={ref}>
      {label && (
        <label id={labelId} className="label" onClick={() => control()?.focus()}>
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-red-600">
          <Icon name="circle-alert" className="h-3.5 w-3.5" />
          {error}
        </p>
      ) : help ? (
        <p className="mt-1.5 text-xs text-slate-500">{help}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Display
export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', className ?? 'h-5 w-5')} aria-label="Loading" />;
}

export function Card({ title, subtitle, actions, children, className, bodyClass }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cn('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={cn('p-5', bodyClass)}>{children}</div>
    </section>
  );
}

const tones = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-brand-50 text-brand-700 ring-brand-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};
const dots = { gray: 'bg-slate-400', blue: 'bg-brand-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', violet: 'bg-violet-500' };
export type Tone = keyof typeof tones;
export function Badge({ tone = 'gray', children, color, dot }: { tone?: Tone; children: ReactNode; color?: string | null; dot?: boolean }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', !color && tones[tone])}
      style={color ? { backgroundColor: `${color}14`, color, boxShadow: `inset 0 0 0 1px ${color}33` } : undefined}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', !color && dots[tone])} style={color ? { backgroundColor: color } : undefined} />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'gray',
  CONFIRMED: 'blue',
  PARTIAL: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'red',
  POSTED: 'green',
  VOID: 'red',
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
};
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'gray'} dot>
      {label ?? status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

export function EmptyState({ icon = 'inbox', title, description, action }: { icon?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <div className="relative mb-4">
        <div className="absolute inset-0 scale-150 rounded-full bg-brand-100/50 blur-xl" />
        <div className="relative rounded-2xl border border-line bg-white p-3.5 text-brand-600 shadow-card">
          <Icon name={icon} className="h-6 w-6" />
        </div>
      </div>
      <p className="font-semibold text-slate-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: () => void }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {back && <Button variant="outline" size="icon" icon="arrow-left" onClick={back} aria-label="Back" className="mt-0.5" />}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold break-words sm:truncate sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const statTone: Record<Tone, string> = {
  blue: 'bg-brand-600',
  green: 'bg-emerald-500',
  amber: 'bg-amber-400',
  red: 'bg-rose-500',
  violet: 'bg-violet-500',
  gray: 'bg-slate-500',
};
export function StatCard({ label, value, hint, icon, tone = 'blue' }: { label: string; value: ReactNode; hint?: ReactNode; icon?: string; tone?: Tone }) {
  return (
    <div className="card group relative overflow-hidden p-5 transition-shadow hover:shadow-pop">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-slate-500">{label}</p>
          <p className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        </div>
        {icon && (
          <div className={cn('rounded-xl p-2.5 text-white shadow-sm', statTone[tone])}>
            <Icon name={icon} className="h-5 w-5" />
          </div>
        )}
      </div>
      {hint && <p className="mt-3 truncate text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div className="scrollbar-thin inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1 shadow-card">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn('rounded-lg px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors', value === t.value ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
