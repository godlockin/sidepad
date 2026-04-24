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
  'focus-visible:outline-none rounded-[6px]';

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover ' +
    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
  ghost:
    'bg-transparent text-ink hover:bg-ink/[0.06] border border-rule ' +
    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
  link:
    'bg-transparent text-ink-muted hover:text-accent underline-offset-2 ' +
    'hover:underline px-0 py-0',
  danger:
    'bg-transparent text-danger hover:bg-danger/10 border border-rule ' +
    'focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
};

const sizes: Record<Size, string> = {
  sm: 'text-[12px] px-2.5 py-1',
  md: 'text-[13px] px-3 py-1.5',
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
