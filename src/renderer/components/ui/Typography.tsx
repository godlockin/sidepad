import React from 'react';

/** Hairline horizontal rule — editorial divider. */
export function Rule({ className = '' }: { className?: string }) {
  return <hr className={`border-0 border-t border-rule ${className}`} />;
}

/** Vertical hairline. */
export function VRule({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`w-px bg-rule ${className}`} />;
}

/** Running-head / section label in monospace small caps. */
export function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`font-mono text-xxs uppercase tracking-[0.18em] text-ink-faint ${className}`}
    >
      {children}
    </span>
  );
}

/** Display heading with Fraunces wonk. */
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
      ? 'text-[44px] leading-[1.05]'
      : level === 2
      ? 'text-[28px] leading-[1.1]'
      : 'text-[20px] leading-[1.2]';
  return (
    <Tag
      className={`font-display font-normal tracking-tighter text-ink ${size} ${className}`}
      style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 50, 'WONK' 1" }}
    >
      {children}
    </Tag>
  );
}
