import React, { useState } from 'react';
import { SettingsPage } from './pages/SettingsPage';
import { SpikePage } from './pages/SpikePage';

type Page = 'chat' | 'settings';

export function App() {
  const [page, setPage] = useState<Page>('chat');

  return (
    <div className="h-screen flex flex-col">
      {/* Top nav */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700 bg-gray-900">
        <span className="text-lg font-semibold text-white mr-4">sidepad</span>
        {([['chat', 'Chat'], ['settings', 'Settings']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPage(key)}
            className={`px-3 py-1 rounded text-sm ${
              page === key
                ? 'bg-blue-600 text-white'
                : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-hidden">
        {page === 'chat' && <SpikePage />}
        {page === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
}
