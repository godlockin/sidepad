import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsPage } from './pages/SettingsPage';
import { ChatPage } from './pages/ChatPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { useSettingsStore } from './stores/settings-store';
import { applyTheme } from './lib/theme';
import { SUPPORTED_LANGS, type Lang } from './i18n/config';

type Page = 'chat' | 'settings' | 'onboarding';

export function App() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme, providers, loaded, init } = useSettingsStore();
  const [page, setPage] = useState<Page>('chat');
  const [transitioned, setTransitioned] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Initial page gating: when settings finish loading, send to onboarding if no providers.
  useEffect(() => {
    if (!loaded || transitioned) return;
    if (providers.length === 0) {
      setPage('onboarding');
    }
    setTransitioned(true);
  }, [loaded, providers.length, transitioned]);

  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');

  const handleOnboardingDone = () => setPage('chat');

  return (
    <div className="h-screen flex flex-col bg-paper text-ink">
      {/* Slim top nav */}
      <header className="h-12 flex items-center justify-between px-4 border-b border-rule bg-surface">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-[6px] bg-accent flex items-center justify-center text-white text-[12px] font-semibold">
            s
          </div>
          <span className="font-sans text-[14px] font-semibold tracking-tight text-ink">
            sidepad
          </span>
        </div>

        {page !== 'onboarding' && (
          <nav className="flex items-center gap-1">
            {([['chat', t('nav.chat')], ['settings', t('nav.settings')]] as const).map(([key, label]) => {
              const active = page === key;
              return (
                <button
                  key={key}
                  onClick={() => setPage(key)}
                  className={`px-3 py-1.5 rounded-[6px] text-[13px] font-medium cursor-pointer transition-colors duration-[var(--dur-fast)] ${
                    active
                      ? 'bg-accent-muted text-accent'
                      : 'text-ink-muted hover:text-ink hover:bg-ink/[0.04]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>
        )}

        <div className="flex items-center gap-1">
          <LangSwitcher
            current={(i18n.resolvedLanguage as Lang) || 'en'}
            onChange={(l) => i18n.changeLanguage(l)}
          />
          <button
            onClick={toggleTheme}
            aria-label={t('nav.toggleTheme')}
            title={t('nav.toggleTheme')}
            className="w-8 h-8 rounded-[6px] flex items-center justify-center text-ink-muted hover:text-ink hover:bg-ink/[0.04] cursor-pointer transition-colors"
          >
            {isDark ? (
              // sun
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              // moon
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        {page === 'onboarding' && <OnboardingPage onDone={handleOnboardingDone} onSkip={() => setPage('settings')} />}
        {page === 'chat' && <ChatPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

function LangSwitcher({ current, onChange }: { current: Lang; onChange: (l: Lang) => void }) {
  const { t } = useTranslation();
  const labels: Record<Lang, string> = { en: 'EN', zh: '中' };
  return (
    <select
      aria-label={t('nav.language')}
      title={t('nav.language')}
      value={current}
      onChange={(e) => onChange(e.target.value as Lang)}
      className="h-8 px-2 rounded-[6px] bg-transparent text-[12px] font-medium text-ink-muted hover:text-ink hover:bg-ink/[0.04] cursor-pointer focus:outline-none border-0"
    >
      {SUPPORTED_LANGS.map((l) => (
        <option key={l} value={l}>
          {labels[l]}
        </option>
      ))}
    </select>
  );
}
