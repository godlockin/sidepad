import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../stores/settings-store';
import { applyTheme, type Theme } from '../lib/theme';
import { ProviderForm } from '../components/ProviderForm';
import { Eyebrow, Heading, Rule, Button } from '../components/ui';

type SettingsTab = 'providers' | 'appearance' | 'about';

const TABS: { key: SettingsTab; label: string; no: string }[] = [
  { key: 'providers', label: 'Voices', no: 'i' },
  { key: 'appearance', label: 'Appearance', no: 'ii' },
  { key: 'about', label: 'Colophon', no: 'iii' },
];

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('providers');
  const [showForm, setShowForm] = useState(false);
  const { providers, theme, init, setTheme, addProvider } = useSettingsStore();

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const handleAddProvider = async (config: {
    id: string;
    type: string;
    apiKey: string;
    baseURL?: string;
  }) => {
    await addProvider(config as any);
    setShowForm(false);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Table of Contents */}
      <aside className="w-[220px] shrink-0 border-r border-rule bg-paper py-8 px-6">
        <Eyebrow className="!tracking-[0.22em]">Contents</Eyebrow>
        <nav className="mt-5">
          <ol className="space-y-3">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <li key={t.key}>
                  <button
                    onClick={() => setTab(t.key)}
                    className={`group flex items-baseline gap-3 text-left cursor-pointer transition-colors duration-[var(--dur-fast)] ${
                      active ? 'text-ink' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <span
                      className={`font-mono text-xxs tabular-nums lowercase ${
                        active ? 'text-accent' : 'text-ink-faint'
                      }`}
                    >
                      {t.no}.
                    </span>
                    <span
                      className="font-display text-[17px] leading-[1.2]"
                      style={{
                        fontVariationSettings: "'opsz' 40, 'SOFT' 50, 'WONK' 0",
                        fontStyle: active ? 'italic' : 'normal',
                      }}
                    >
                      {t.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </aside>

      {/* Article */}
      <article className="flex-1 overflow-y-auto">
        <div className="max-w-[720px] mx-auto px-10 py-10">
          {tab === 'providers' && (
            <section>
              <Eyebrow>Chapter i · voices</Eyebrow>
              <Heading level={1} className="mt-2 mb-3">
                The voices at the table.
              </Heading>
              <p className="font-serif-body text-[15px] leading-[1.7] text-ink-muted max-w-[56ch]">
                Each voice is an LLM endpoint you address with{' '}
                <span
                  className="font-display italic text-accent"
                  style={{ fontVariationSettings: "'opsz' 18, 'SOFT' 50, 'WONK' 0" }}
                >
                  @name
                </span>
                . Keys stay encrypted on this machine. There is no sync, no
                telemetry — these words leave only when you send them.
              </p>

              <div className="mt-8 mb-4 flex items-baseline justify-between">
                <Eyebrow>Configured · {providers.length.toString().padStart(2, '0')}</Eyebrow>
                {!showForm && (
                  <button
                    onClick={() => setShowForm(true)}
                    className="font-mono text-xxs uppercase tracking-[0.16em] text-ink-faint hover:text-accent cursor-pointer transition-colors"
                  >
                    + introduce a voice
                  </button>
                )}
              </div>
              <Rule />

              {!showForm && providers.length === 0 && (
                <p className="font-serif-body italic text-[14px] text-ink-faint py-10 text-center">
                  No voices yet. Introduce one to begin.
                </p>
              )}

              {providers.length > 0 && (
                <ol className="divide-y divide-rule">
                  {providers.map((p, i) => (
                    <li key={p.id} className="py-4 flex items-baseline gap-4">
                      <span className="font-mono text-xxs tabular-nums text-ink-faint pt-[3px]">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-3">
                          <span
                            className="font-display italic text-[18px] text-ink"
                            style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 50, 'WONK' 0" }}
                          >
                            @{p.id}
                          </span>
                          <span className="font-mono text-xxs uppercase tracking-[0.14em] text-ink-faint">
                            {p.configId}
                          </span>
                        </div>
                      </div>
                      <span className="font-mono text-xxs uppercase tracking-[0.16em] text-success">
                        · active
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {showForm && (
                <ProviderForm
                  onSubmit={handleAddProvider}
                  onCancel={() => setShowForm(false)}
                />
              )}
            </section>
          )}

          {tab === 'appearance' && (
            <section>
              <Eyebrow>Chapter ii · appearance</Eyebrow>
              <Heading level={1} className="mt-2 mb-3">
                A room for the words.
              </Heading>
              <p className="font-serif-body text-[15px] leading-[1.7] text-ink-muted max-w-[56ch]">
                Paper or dusk. The interface follows your system by default.
              </p>

              <div className="mt-10">
                <Eyebrow>Theme</Eyebrow>
                <Rule className="mt-2" />
                <div className="mt-5 grid grid-cols-3 gap-4">
                  {(['system', 'light', 'dark'] as const).map((t) => (
                    <ThemeSwatch
                      key={t}
                      value={t}
                      active={theme === t}
                      onSelect={() => setTheme(t)}
                    />
                  ))}
                </div>
              </div>
            </section>
          )}

          {tab === 'about' && (
            <section>
              <Eyebrow>Chapter iii · colophon</Eyebrow>
              <Heading level={1} className="mt-2 mb-6">
                On this edition.
              </Heading>

              <div className="font-serif-body text-[15.5px] leading-[1.8] text-ink max-w-[56ch] space-y-4">
                <p>
                  <span
                    className="font-display italic"
                    style={{ fontVariationSettings: "'opsz' 40, 'SOFT' 50, 'WONK' 1" }}
                  >
                    sidepad
                  </span>{' '}
                  — a small atelier for multi-voice conversation with large
                  language models. Version{' '}
                  <span className="font-mono text-[13px]">0.0.1</span>, printed
                  locally.
                </p>
                <p>
                  Set in{' '}
                  <span
                    className="font-display italic"
                    style={{ fontVariationSettings: "'opsz' 40, 'SOFT' 50, 'WONK' 0" }}
                  >
                    Fraunces
                  </span>{' '}
                  for body,{' '}
                  <span className="font-sans">Instrument Sans</span> for
                  navigation, <span className="font-mono">JetBrains Mono</span>{' '}
                  for marginalia.
                </p>
                <p className="text-ink-muted italic">
                  Local storage · zero telemetry · open source.
                </p>
              </div>
            </section>
          )}
        </div>
      </article>
    </div>
  );
}

function ThemeSwatch({
  value,
  active,
  onSelect,
}: {
  value: Theme;
  active: boolean;
  onSelect: () => void;
}) {
  const preview =
    value === 'light'
      ? { bg: '#FAF8F3', ink: '#1B1915', accent: '#B2542A' }
      : value === 'dark'
      ? { bg: '#151412', ink: '#ECE7DB', accent: '#D97B4E' }
      : null;

  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      className={`group relative text-left cursor-pointer transition-transform duration-[var(--dur)] ${
        active ? '' : 'hover:-translate-y-[2px]'
      }`}
    >
      <div
        className={`h-[96px] w-full border overflow-hidden relative ${
          active ? 'border-accent' : 'border-rule group-hover:border-rule-strong'
        }`}
        style={preview ? { background: preview.bg } : {}}
      >
        {preview ? (
          <>
            {/* mini masthead */}
            <span
              className="absolute top-3 left-3 text-[14px] italic"
              style={{
                color: preview.ink,
                fontFamily: 'Fraunces, serif',
                fontVariationSettings: "'opsz' 144, 'SOFT' 50, 'WONK' 1",
              }}
            >
              sidepad
            </span>
            <span
              className="absolute bottom-3 left-3 right-3 h-px"
              style={{ background: preview.accent, opacity: 0.8 }}
            />
            <span
              className="absolute bottom-6 left-3 h-[2px] w-8"
              style={{ background: preview.accent }}
            />
          </>
        ) : (
          <div className="absolute inset-0 flex">
            <div className="flex-1" style={{ background: '#FAF8F3' }} />
            <div className="flex-1" style={{ background: '#151412' }} />
            <span
              aria-hidden
              className="absolute inset-y-0 left-1/2 w-px bg-rule-strong"
            />
          </div>
        )}
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <span
          className={`font-mono text-xxs uppercase tracking-[0.16em] ${
            active ? 'text-accent' : 'text-ink-muted'
          }`}
        >
          {value}
        </span>
        {active && (
          <span className="font-mono text-xxs text-accent">· current</span>
        )}
      </div>
    </button>
  );
}
