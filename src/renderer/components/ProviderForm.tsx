import React, { useState } from 'react';

type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'openai-compat';

interface ProviderFormProps {
  onSubmit: (config: { id: string; type: ProviderType; apiKey: string; baseURL?: string }) => void;
  onCancel: () => void;
  initialType?: ProviderType;
}

const PROVIDER_TYPES: { value: ProviderType; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai-compat', label: 'OpenAI Compatible' },
];

function needsBaseURL(type: ProviderType): boolean {
  return type === 'openai-compat' || type === 'ollama';
}

function needsAPIKey(type: ProviderType): boolean {
  return type !== 'ollama';
}

export function ProviderForm({ onSubmit, onCancel, initialType = 'openai' }: ProviderFormProps) {
  const [type, setType] = useState<ProviderType>(initialType);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');

  const showBaseURL = needsBaseURL(type);
  const showAPIKey = needsAPIKey(type);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = name.trim().toLowerCase().replace(/\s+/g, '-') || type;
    onSubmit({
      id,
      type,
      apiKey: apiKey.trim(),
      baseURL: baseURL.trim() || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-gray-800 rounded border border-gray-700">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Provider Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ProviderType)}
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
        >
          {PROVIDER_TYPES.map((pt) => (
            <option key={pt.value} value={pt.value}>{pt.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-openai"
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500"
          required
        />
      </div>

      {showAPIKey && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500"
            required={showAPIKey}
          />
        </div>
      )}

      {showBaseURL && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Base URL</label>
          <input
            type="text"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder={type === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500"
          />
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm rounded bg-gray-700 text-gray-300 hover:bg-gray-600">
          Cancel
        </button>
        <button type="submit" className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-500">
          Save
        </button>
      </div>
    </form>
  );
}
