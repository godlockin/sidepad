import React, { useRef, useEffect, useState } from 'react';

interface MentionPickerProps {
  providers: Array<{ id: string; configId: string }>;
  onSelect: (providerId: string) => void;
  onClose: () => void;
}

export function MentionPicker({ providers, onSelect, onClose }: MentionPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, providers.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (providers[selectedIndex]) {
          onSelect(providers[selectedIndex].id);
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, providers, onSelect, onClose]);

  if (providers.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 mb-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg overflow-hidden z-50 min-w-[200px]"
    >
      <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700">
        Select provider
      </div>
      {providers.map((p, i) => (
        <button
          key={p.id}
          onClick={() => onSelect(p.id)}
          className={`w-full text-left px-3 py-2 text-sm ${
            i === selectedIndex
              ? 'bg-blue-600 text-white'
              : 'text-gray-300 hover:bg-gray-700'
          }`}
        >
          <span className="font-medium">{p.id}</span>
          <span className="text-gray-500 ml-2 text-xs">({p.configId})</span>
        </button>
      ))}
    </div>
  );
}
