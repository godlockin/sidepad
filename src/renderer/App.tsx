import React, { useState } from 'react';
import { SettingsPage } from './pages/SettingsPage';
import { ChatPage } from './pages/ChatPage';
import { Eyebrow } from './components/ui';

type Page = 'chat' | 'settings';

export function App() {
  const [page, setPage] = useState<Page>('chat');

  return (
    <div className="h-screen flex flex-col bg-paper text-ink paper-grain">
      {/* Masthead — editorial, not a nav bar */}
      <header className="flex items-baseline justify-between px-6 py-3 border-b border-rule">
        <div className="flex items-baseline gap-3">
          <span
            className="font-display text-[22px] leading-none tracking-tightest text-ink"
            style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 50, 'WONK' 1", fontStyle: 'italic' }}
          >
            sidepad
          </span>
          <Eyebrow className="translate-y-[-1px]">
            vol. 01 · a multi-voice atelier
          </Eyebrow>
        </div>

        <nav className="flex items-center gap-5">
          {([['chat', 'Chat'], ['settings', 'Settings']] as const).map(([key, label]) => {
            const active = page === key;
            return (
              <button
                key={key}
                onClick={() => setPage(key)}
                className={`relative font-sans text-[13px] tracking-wide cursor-pointer transition-colors duration-[var(--dur-fast)] ${
                  active ? 'text-ink' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {label}
                <span
                  aria-hidden
                  className={`absolute -bottom-[3px] left-0 h-px bg-accent origin-left transition-transform duration-[var(--dur)] ease-editorial ${
                    active ? 'scale-x-100 w-full' : 'scale-x-0 w-full'
                  }`}
                />
              </button>
            );
          })}
        </nav>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        {page === 'chat' && <ChatPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
