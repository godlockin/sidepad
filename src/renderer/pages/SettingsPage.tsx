import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../stores/settings-store';
import { applyTheme, type Theme } from '../lib/theme';
import { ProviderForm } from '../components/ProviderForm';
import { Heading, Button } from '../components/ui';
import { Avatar } from '../components/Avatar';
import { IconEditor } from '../components/IconEditor';
import { PersonasTab } from './settings/PersonasTab';
import { CapabilitiesTab } from './settings/CapabilitiesTab';

type SettingsTab = 'providers' | 'personas' | 'capabilities' | 'appearance' | 'about';

export function SettingsPage() {
  const { t } = useTranslation();
  const TABS: { key: SettingsTab; label: string }[] = [
    { key: 'providers', label: t('settings.tabs.voices') },
    { key: 'personas', label: t('settings.tabs.personas') },
    { key: 'capabilities', label: t('settings.tabs.capabilities') },
    { key: 'appearance', label: t('settings.tabs.appearance') },
    { key: 'about', label: t('settings.tabs.about') },
  ];
  const [tab, setTab] = useState<SettingsTab>('providers');
  const [showForm, setShowForm] = useState(false);
  const [iconEdit, setIconEdit] = useState<{
    configId: string;
    name: string;
    kind: 'emoji' | 'image' | null;
    value: string | null;
    anchor: { top: number; left: number };
  } | null>(null);
  const { providers, theme, init, setTheme, addProvider, setProviderIcon } = useSettingsStore();

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
    defaultModel?: string;
  }) => {
    await addProvider(config as any);
    setShowForm(false);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[200px] shrink-0 border-r border-rule bg-surface-2 py-4 px-2">
        <nav>
          <ol className="space-y-0.5">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <li key={t.key}>
                  <button
                    onClick={() => setTab(t.key)}
                    className={`w-full text-left px-3 py-1.5 rounded-[6px] text-[13px] font-medium cursor-pointer transition-colors duration-[var(--dur-fast)] ${
                      active
                        ? 'bg-accent-muted text-accent'
                        : 'text-ink-muted hover:text-ink hover:bg-surface'
                    }`}
                  >
                    {t.label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </aside>

      {/* Main */}
      <article className="flex-1 overflow-y-auto bg-paper">
        <div className="max-w-[680px] mx-auto px-8 py-8">
          {tab === 'providers' && (
            <section>
              <Heading level={1} className="mb-2">
                {t('settings.voices.title')}
              </Heading>
              <p className="text-[14px] leading-[1.6] text-ink-muted">
                {t('settings.voices.bodyStart')}{' '}
                <span className="font-mono text-accent text-[13px]">@name</span>
                {t('settings.voices.bodyEnd')}
              </p>

              <div className="mt-6 mb-3 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  {t('settings.voices.configured')} · {providers.length.toString().padStart(2, '0')}
                </span>
                {!showForm && (
                  <Button variant="ghost" size="sm" onClick={() => setShowForm(true)}>
                    {t('settings.voices.add')}
                  </Button>
                )}
              </div>

              <div className="border border-rule rounded-[10px] bg-surface overflow-hidden">
                {!showForm && providers.length === 0 && (
                  <p className="text-[13px] text-ink-faint py-10 text-center">
                    {t('settings.voices.empty')}
                  </p>
                )}

                {providers.length > 0 && (
                  <ol className="divide-y divide-rule">
                    {providers.map((p) => (
                      <li key={p.id} className="px-4 py-3 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setIconEdit({
                              configId: p.configId,
                              name: p.id,
                              kind: p.iconKind,
                              value: p.iconValue,
                              anchor: { top: rect.bottom + 6, left: rect.left },
                            });
                          }}
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                          title={t('settings.voices.changeIcon')}
                        >
                          <Avatar
                            kind={p.iconKind}
                            value={p.iconValue}
                            name={p.id}
                            size={28}
                            rounded="full"
                          />
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[13px] text-ink bg-surface-2 border border-rule rounded-[4px] px-1.5 py-[1px]">
                              @{p.id}
                            </span>
                            <span className="text-[12px] text-ink-muted">{p.configId}</span>
                          </div>
                        </div>
                        <span className="text-[11px] uppercase tracking-[0.06em] text-success">
                          {t('settings.voices.active')}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}

                {showForm && (
                  <div className="p-5">
                    <ProviderForm
                      onSubmit={handleAddProvider}
                      onCancel={() => setShowForm(false)}
                    />
                  </div>
                )}
              </div>
            </section>
          )}

          {tab === 'personas' && <PersonasTab />}

          {tab === 'capabilities' && <CapabilitiesTab />}

          {tab === 'appearance' && (
            <section>
              <Heading level={1} className="mb-2">
                {t('settings.appearance.title')}
              </Heading>
              <p className="text-[14px] leading-[1.6] text-ink-muted">
                {t('settings.appearance.body')}
              </p>

              <div className="mt-6">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  {t('settings.appearance.theme')}
                </span>
                <div className="mt-3 grid grid-cols-3 gap-3">
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
              <Heading level={1} className="mb-3">
                {t('settings.about.title')}
              </Heading>
              <div className="text-[14px] leading-[1.7] text-ink space-y-3 max-w-[60ch]">
                <p>
                  <span className="font-semibold">{t('settings.about.name')}</span>{' '}
                  {t('settings.about.tagline')}{' '}
                  <span className="font-mono text-[12px] text-ink-muted">0.0.1</span>.
                </p>
                <p className="text-ink-muted">
                  {t('settings.about.subtitle')}
                </p>
              </div>
            </section>
          )}
        </div>
      </article>
      {iconEdit && (
        <IconEditor
          name={iconEdit.name}
          kind={iconEdit.kind}
          value={iconEdit.value}
          anchor={iconEdit.anchor}
          onSave={async (k, v) => {
            await setProviderIcon(iconEdit.configId, k, v);
          }}
          onClose={() => setIconEdit(null)}
        />
      )}
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
  const { t } = useTranslation();
  const labelMap: Record<Theme, string> = {
    system: t('settings.appearance.system'),
    light: t('settings.appearance.light'),
    dark: t('settings.appearance.dark'),
  };
  const preview =
    value === 'light'
      ? { bg: '#FBFBFC', ink: '#0B0D12', accent: '#5B5BD6' }
      : value === 'dark'
      ? { bg: '#0A0B0E', ink: '#ECEEF3', accent: '#7C7CFF' }
      : null;

  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      className={`group text-left cursor-pointer transition-transform duration-[var(--dur)] ${
        active ? '' : 'hover:-translate-y-[2px]'
      }`}
    >
      <div
        className={`h-[80px] w-full border rounded-[8px] overflow-hidden relative ${
          active ? 'border-accent ring-2 ring-accent-muted' : 'border-rule group-hover:border-rule-strong'
        }`}
        style={preview ? { background: preview.bg } : {}}
      >
        {preview ? (
          <>
            <span
              className="absolute top-2 left-2 text-[12px] font-semibold"
              style={{ color: preview.ink }}
            >
              sidepad
            </span>
            <span
              className="absolute bottom-2 left-2 h-1.5 w-10 rounded-full"
              style={{ background: preview.accent }}
            />
          </>
        ) : (
          <div className="absolute inset-0 flex">
            <div className="flex-1" style={{ background: '#FBFBFC' }} />
            <div className="flex-1" style={{ background: '#0A0B0E' }} />
          </div>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span
          className={`text-[12px] font-medium capitalize ${
            active ? 'text-accent' : 'text-ink-muted'
          }`}
        >
          {labelMap[value]}
        </span>
        {active && <span className="text-[10px] text-accent">{t('settings.appearance.current')}</span>}
      </div>
    </button>
  );
}
