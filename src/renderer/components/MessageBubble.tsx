import React, { useState } from 'react';
import type { Message } from '../../main/store/types';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);

  const isUser = message.role === 'user';
  const isError = message.status === 'error';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const meta: { agentId?: string } = message.metaJson ? JSON.parse(message.metaJson) : {};

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[75%] rounded-lg px-4 py-3 relative group ${
          isUser
            ? 'bg-blue-600 text-white'
            : isError
            ? 'bg-red-900/40 border border-red-700 text-red-200'
            : 'bg-gray-800 text-gray-100 border border-gray-700'
        }`}
      >
        {!isUser && meta.agentId && (
          <div className="text-xs text-gray-400 mb-1 font-mono">{meta.agentId}</div>
        )}
        <div className="whitespace-pre-wrap text-sm">{message.content || (message.status === 'streaming' ? '▊' : '')}</div>
        {isError && message.error && (
          <div className="text-xs text-red-300 mt-2">{message.error}</div>
        )}
        <div className="flex items-center justify-between mt-2">
          <div className="text-xs text-gray-500">
            {message.status === 'streaming' && <span className="text-blue-400">streaming...</span>}
            {message.status === 'error' && <span className="text-red-400">error</span>}
          </div>
          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isUser && message.content && (
              <button
                onClick={handleCopy}
                className="text-xs text-gray-400 hover:text-white"
                title="Copy"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
