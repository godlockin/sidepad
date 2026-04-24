import React, { useState, useRef } from 'react';
import type { Unsubscribable } from '@trpc/server/observable';
import { trpc } from '../lib/trpc-client';

export function SpikePage() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const subRef = useRef<Unsubscribable | null>(null);

  function handleSend() {
    setOutput('');
    setError(null);
    setStatus('streaming');

    // Cancel any existing subscription
    if (subRef.current) {
      subRef.current.unsubscribe();
    }

    const sub = trpc.spike.stream.subscribe(
      { messages: [{ role: 'user', content: input }] },
      {
        onData(delta: string) {
          setOutput((prev) => prev + delta);
        },
        onError(err) {
          setError(err.message);
          setStatus('error');
        },
        onComplete() {
          setStatus('done');
        },
      }
    );

    subRef.current = sub;
  }

  function handleStop() {
    if (subRef.current) {
      subRef.current.unsubscribe();
      subRef.current = null;
    }
    setStatus('idle');
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <h1 className="text-lg font-semibold">Spike: OpenAI Streaming</h1>

      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2 bg-gray-800 text-white placeholder-gray-400"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          disabled={status === 'streaming'}
        />
        <button
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white"
          onClick={handleSend}
          disabled={status === 'streaming' || !input.trim()}
        >
          Send
        </button>
        <button
          className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white"
          onClick={handleStop}
          disabled={status !== 'streaming'}
        >
          Stop
        </button>
      </div>

      {error && (
        <div className="text-red-400 text-sm border border-red-700 rounded p-2 bg-red-900/20">{error}</div>
      )}

      <div className="flex-1 overflow-auto border rounded p-3 bg-gray-900 text-sm text-gray-100 whitespace-pre-wrap font-mono">
        {output || <span className="text-gray-500">Response will appear here...</span>}
      </div>

      <div className="text-xs text-gray-500">
        Status: {status}
      </div>
    </div>
  );
}
