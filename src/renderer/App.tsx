import React, { useState } from 'react';
import { Heartbeat } from './components/Heartbeat';
import { SpikePage } from './pages/SpikePage';

export function App() {
  const [page, setPage] = useState<'heartbeat' | 'spike'>('heartbeat');

  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold mb-2">sidepad</h1>
      <p className="mb-4">Phase 1 skeleton.</p>
      <div className="flex gap-2 mb-4">
        <button
          className={`px-3 py-1 rounded text-sm ${page === 'heartbeat' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          onClick={() => setPage('heartbeat')}
        >
          Heartbeat
        </button>
        <button
          className={`px-3 py-1 rounded text-sm ${page === 'spike' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          onClick={() => setPage('spike')}
        >
          Spike
        </button>
      </div>
      {page === 'heartbeat' && <Heartbeat />}
      {page === 'spike' && <SpikePage />}
    </div>
  );
}
