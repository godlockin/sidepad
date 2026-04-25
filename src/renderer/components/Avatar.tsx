import React from 'react';

export interface AvatarProps {
  kind: 'emoji' | 'image' | null | undefined;
  value: string | null | undefined;
  name: string;
  size?: number;
  rounded?: 'full' | 'md';
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}

/**
 * Hash a string to a deterministic HSL color so each instance has a stable
 * "auto" color when no emoji/image is set.
 */
function hashColor(name: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  const sat = 60 + (h % 20); // 60-79
  const light = 52; // mid lightness so white text reads
  return { bg: `hsl(${hue} ${sat}% ${light}%)`, fg: '#ffffff' };
}

function initial(name: string): string {
  if (!name) return '?';
  // First grapheme — strip leading non-letter/digit
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const first = Array.from(trimmed)[0]!;
  return first.toUpperCase();
}

export function Avatar({
  kind,
  value,
  name,
  size = 24,
  rounded = 'md',
  className = '',
  onClick,
  title,
}: AvatarProps) {
  const radius = rounded === 'full' ? '9999px' : `${Math.max(4, size * 0.22)}px`;
  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
  };
  const interactive = onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : '';

  if (kind === 'image' && value) {
    return (
      <img
        src={value}
        alt={name}
        onClick={onClick}
        title={title}
        style={{ ...baseStyle, objectFit: 'cover' }}
        className={`${interactive} ${className}`}
        draggable={false}
      />
    );
  }

  if (kind === 'emoji' && value) {
    return (
      <span
        onClick={onClick}
        title={title}
        style={{
          ...baseStyle,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.62,
          lineHeight: 1,
          background: 'transparent',
        }}
        className={`select-none ${interactive} ${className}`}
      >
        {value}
      </span>
    );
  }

  // Hash-color initial fallback
  const { bg, fg } = hashColor(name || '?');
  return (
    <span
      onClick={onClick}
      title={title}
      style={{
        ...baseStyle,
        background: bg,
        color: fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.45,
        fontWeight: 600,
        letterSpacing: '-0.01em',
      }}
      className={`select-none font-sans ${interactive} ${className}`}
    >
      {initial(name)}
    </span>
  );
}
