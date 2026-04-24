import React from 'react';

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, hint, error, children, className = '' }: FieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
          {label}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-[12px] text-ink-faint">{hint}</p>}
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

const inputBase =
  'w-full bg-surface border border-rule rounded-[6px] px-3 py-2 ' +
  'text-ink text-[13px] ' +
  'placeholder:text-ink-faint ' +
  'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent ' +
  'transition-colors duration-[var(--dur-fast)] ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input className={`${inputBase} ${className}`} {...rest} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return <textarea className={`${inputBase} resize-none ${className}`} {...rest} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props;
  return (
    <select
      className={`${inputBase} appearance-none pr-8 cursor-pointer bg-no-repeat bg-[length:14px] bg-[right_10px_center] ${className}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' stroke='currentColor' fill='none' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
      }}
      {...rest}
    >
      {children}
    </select>
  );
}
