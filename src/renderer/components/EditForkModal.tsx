import React, { useState } from 'react';
import type { Message } from '../../main/store/types';

interface EditForkModalProps {
  message: Message;
  onEditInPlace: (newContent: string) => void;
  onFork: (newContent: string, title?: string) => void;
  onClose: () => void;
}

export function EditForkModal({ message, onEditInPlace, onFork, onClose }: EditForkModalProps) {
  const [content, setContent] = useState(message.content);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'edit' | 'fork' | null>(null);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg border border-gray-700 w-[600px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-700 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-white">
            {mode === 'edit' ? 'Edit in place' : mode === 'fork' ? 'Fork session' : 'Edit message'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white resize-none focus:outline-none focus:border-blue-500 text-sm"
            rows={10}
          />
          {mode === 'fork' && (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Session title (optional)"
              className="w-full mt-3 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 text-sm"
            />
          )}
        </div>

        {!mode && (
          <div className="px-4 py-3 border-t border-gray-700 flex gap-2">
            <button
              onClick={() => setMode('edit')}
              className="flex-1 px-4 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-500"
            >
              Edit in place
            </button>
            <button
              onClick={() => setMode('fork')}
              className="flex-1 px-4 py-2 rounded bg-green-600 text-white text-sm hover:bg-green-500"
            >
              Fork into new session
            </button>
          </div>
        )}

        {mode && (
          <div className="px-4 py-3 border-t border-gray-700 flex gap-2">
            <button
              onClick={() => setMode(null)}
              className="px-4 py-2 rounded bg-gray-700 text-gray-300 text-sm hover:bg-gray-600"
            >
              Back
            </button>
            <button
              onClick={() => {
                if (mode === 'edit') onEditInPlace(content);
                else onFork(content, title || undefined);
              }}
              className={`flex-1 px-4 py-2 rounded text-white text-sm ${
                mode === 'edit'
                  ? 'bg-blue-600 hover:bg-blue-500'
                  : 'bg-green-600 hover:bg-green-500'
              }`}
            >
              {mode === 'edit' ? 'Apply edit' : 'Fork'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
