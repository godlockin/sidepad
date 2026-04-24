import React from 'react';

type Variant = 'primary' | 'ghost' | 'link' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  'inline-flex items-center justify-center gap-1.5 font-sans font-medium ' +
  'transition-colors duration-[var(--dur-fast)] ease-editorial ' +
  'disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ' +
  'focus-visible:outline-none';

const variants: Record<Variant, string> = {
  primary:
    'bg-ink text-paper hover:bg-ink/90 ' +
    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
  ghost:
    'bg-transparent text-ink hover:bg-ink/5 ' +
    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
  link:
    'bg-transparent text-ink-muted hover:text-accent underline-offset-[3px] decoration-rule-strong ' +
    'hover:decoration-accent decoration-[0.5px] px-0 py-0',
  danger:
    'bg-transparent text-danger hover:bg-danger/8 ' +
    'focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
};

const sizes: Record<Size, string> = {
  sm: 'text-xxs uppercase tracking-[0.12em] px-2.5 py-1 rounded-[var(--radius-sm)]',
  md: 'text-[13px] px-3.5 py-2 rounded-[var(--radius-sm)]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${base} ${variants[variant]} ${variant === 'link' ? '' : sizes[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
