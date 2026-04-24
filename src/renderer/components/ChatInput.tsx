import React, { useState, useRef, useEffect } from 'react';

interface ChatInputProps {
  onSend: (text: string, mentions: string[]) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
}

export function ChatInput({ onSend, onStop, streaming, disabled = false }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
    }
  }, [input]);

  const handleSend = () => {
    if (!input.trim() || streaming) return;
    const mentions = extractMentions(input);
    onSend(input.trim(), mentions);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-gray-700 p-3 bg-gray-900">
      {(() => {
        const mentions = extractMentions(input);
        return mentions.length > 0 ? (
          <div className="flex gap-1 mb-2">
            {mentions.map((m) => (
              <span key={m} className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded">
                @{m}
              </span>
            ))}
          </div>
        ) : null;
      })()}
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message... (Cmd+Enter to send)"
          rows={1}
          disabled={disabled || streaming}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500 text-sm"
        />
        {streaming ? (
          <button
            onClick={onStop}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-500 self-end"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={disabled || !input.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-500 disabled:opacity-40 self-end"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}

function extractMentions(text: string): string[] {
  const mentions: string[] = [];
  const regex = /@(\S+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].replace(/[,.\s)]*$/, '');
    if (name) mentions.push(name);
  }
  return [...new Set(mentions)];
}
