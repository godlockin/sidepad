import React from 'react';

/** Hairline horizontal rule. */
export function Rule({ className = '' }: { className?: string }) {
  return <hr className={`border-0 border-t border-rule ${className}`} />;
}

/** Vertical hairline. */
export function VRule({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`w-px bg-rule ${className}`} />;
}

/** Section eyebrow label — small medium uppercase. */
export function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint ${className}`}
    >
      {children}
    </span>
  );
}

/** Display heading — Inter, no decorative variation. */
export function Heading({
  level = 2,
  children,
  className = '',
}: {
  level?: 1 | 2 | 3;
  children: React.ReactNode;
  className?: string;
}) {
  const Tag = (`h${level}` as unknown) as 'h1' | 'h2' | 'h3';
  const size =
    level === 1
      ? 'text-[28px] leading-[1.15] font-semibold'
      : level === 2
      ? 'text-[20px] leading-[1.2] font-semibold'
      : 'text-[16px] leading-[1.25] font-medium';
  return (
    <Tag className={`font-sans tracking-tight text-ink ${size} ${className}`}>
      {children}
    </Tag>
  );
}
