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
        <label className="font-mono text-xxs uppercase tracking-[0.12em] text-ink-muted">
          {label}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-ink-faint">{hint}</p>}
      {error && <p className="text-xs text-danger font-mono">{error}</p>}
    </div>
  );
}

const inputBase =
  'w-full bg-transparent border-0 border-b border-rule px-0 py-2 ' +
  'text-ink font-serif-body text-[15px] ' +
  'placeholder:text-ink-faint placeholder:italic ' +
  'focus:outline-none focus:border-ink ' +
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
      className={`${inputBase} appearance-none pr-6 cursor-pointer bg-[length:12px] bg-no-repeat bg-[right_center] ${className}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' stroke='currentColor' fill='none' stroke-width='1.25' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
      }}
      {...rest}
    >
      {children}
    </select>
  );
}
