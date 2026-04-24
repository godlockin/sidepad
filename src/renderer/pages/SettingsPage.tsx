import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../stores/settings-store';
import { applyTheme } from '../lib/theme';
import { ProviderForm } from '../components/ProviderForm';

type SettingsTab = 'providers' | 'appearance' | 'about';

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

  const handleAddProvider = async (config: { id: string; type: string; apiKey: string; baseURL?: string }) => {
    await addProvider(config as any);
    setShowForm(false);
  };

  return (
    <div className="flex h-full">
      {/* Tab sidebar */}
      <div className="w-48 bg-gray-800 border-r border-gray-700 p-4">
        <h2 className="text-lg font-semibold mb-4">Settings</h2>
        <nav className="space-y-1">
          {([['providers', 'Providers'], ['appearance', 'Appearance'], ['about', 'About']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${
                tab === key ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 overflow-auto">
        {tab === 'providers' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">Provider Configuration</h3>
              {!showForm && (
                <button
                  onClick={() => setShowForm(true)}
                  className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-500"
                >
                  + Add Provider
                </button>
              )}
            </div>

            {showForm && <ProviderForm onSubmit={handleAddProvider} onCancel={() => setShowForm(false)} />}

            {!showForm && providers.length === 0 && (
              <p className="text-gray-400 mt-4">No providers configured. Add one to get started.</p>
            )}

            {providers.length > 0 && (
              <div className="mt-4 space-y-2">
                {providers.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-gray-800 rounded px-4 py-3 border border-gray-700">
                    <div>
                      <span className="font-medium">{p.id}</span>
                      <span className="text-gray-400 text-sm ml-2">({p.configId})</span>
                    </div>
                    <span className="text-xs bg-green-900 text-green-300 px-2 py-1 rounded">active</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'appearance' && (
          <div>
            <h3 className="text-xl font-semibold mb-4">Appearance</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Theme</label>
                <div className="flex gap-2">
                  {(['system', 'light', 'dark'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={`px-4 py-2 rounded text-sm capitalize ${
                        theme === t ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'about' && (
          <div>
            <h3 className="text-xl font-semibold mb-4">About</h3>
            <div className="space-y-2 text-gray-300">
              <p><span className="font-medium">sidepad</span> v0.0.1</p>
              <p>Multi-LLM group chat desktop app.</p>
              <p>Local data. Zero telemetry.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
