import React, { useState } from 'react';
import { Field, Input, Select, Button } from './ui';

type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'openai-compat';

interface ProviderFormProps {
  onSubmit: (config: { id: string; type: ProviderType; apiKey: string; baseURL?: string }) => void;
  onCancel: () => void;
  initialType?: ProviderType;
}

const PROVIDER_TYPES: { value: ProviderType; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama (local)' },
  { value: 'openai-compat', label: 'OpenAI-compatible' },
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
    <form onSubmit={handleSubmit} className="space-y-4 anim-fade-up">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Kind">
          <Select value={type} onChange={(e) => setType(e.target.value as ProviderType)}>
            {PROVIDER_TYPES.map((pt) => (
              <option key={pt.value} value={pt.value}>
                {pt.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Name" hint="Shown in @ mentions and sidebar">
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-openai"
            required
          />
        </Field>

        {showAPIKey && (
          <Field label="API key" className="md:col-span-2">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              required={showAPIKey}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        )}

        {showBaseURL && (
          <Field label="Base URL" className="md:col-span-2">
            <Input
              type="text"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder={type === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'}
              spellCheck={false}
            />
          </Field>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" variant="primary" size="sm">
          save voice
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          cancel
        </Button>
      </div>
    </form>
  );
}
