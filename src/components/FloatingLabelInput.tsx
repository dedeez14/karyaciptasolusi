import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FloatingLabelInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  icon?: React.ReactNode;
}

export default function FloatingLabelInput({
  label,
  error,
  icon,
  className,
  type,
  id,
  ...props
}: FloatingLabelInputProps) {
  const [focused, setFocused] = useState(false);
  const [filled, setFilled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const inputId = id || label.toLowerCase().replace(/\s+/g, '-');
  const isPassword = type === 'password';
  const resolvedType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="relative">
      <div
        className={cn(
          'relative rounded-xl border transition-all duration-200 bg-white/60 backdrop-blur-sm',
          error
            ? 'border-red-400 shadow-[0_0_0_3px_rgba(248,113,113,0.12)]'
            : focused
              ? 'border-[#2563EB] shadow-[0_0_0_3px_rgba(37,99,235,0.12)]'
              : 'border-[#E2E8F0] hover:border-[#CBD5E1]',
        )}
      >
        {icon && (
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#94A3B8] pointer-events-none">
            {icon}
          </span>
        )}

        <input
          id={inputId}
          type={resolvedType}
          className={cn(
            'peer w-full h-14 px-4 pt-5 pb-1.5 bg-transparent text-[#0F172A] text-sm outline-none rounded-xl',
            icon && 'pl-11',
            isPassword && 'pr-11',
            className,
          )}
          placeholder=" "
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            setFilled(!!e.target.value);
            props.onBlur?.(e);
          }}
          onChange={(e) => {
            setFilled(!!e.target.value);
            props.onChange?.(e);
          }}
          {...props}
        />

        <label
          htmlFor={inputId}
          className={cn(
            'absolute left-4 transition-all duration-200 pointer-events-none select-none',
            icon && 'left-11',
            focused || filled
              ? 'top-1.5 text-[10px] font-semibold text-[#2563EB]'
              : 'top-1/2 -translate-y-1/2 text-sm text-[#94A3B8]',
            error && (focused || filled ? 'text-red-500' : ''),
          )}
        >
          {label}
        </label>

        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[#94A3B8] hover:text-[#475569] hover:bg-[#F1F5F9] transition-colors"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-1.5 text-xs text-red-500 font-medium pl-1">{error}</p>
      )}
    </div>
  );
}
