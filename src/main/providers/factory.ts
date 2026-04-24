import type Database from 'better-sqlite3';
import type { SecretStore } from '../secret/secret-store';
import type { ProviderRegistry } from './index';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';
import { OpenAICompatProvider } from './openai-compat';

export function loadProviders(
  db: Database.Database,
  secrets: SecretStore,
  reg: ProviderRegistry,
): void {
  const rows = db
    .prepare('SELECT * FROM provider_configs WHERE enabled = 1')
    .all() as any[];

  for (const row of rows) {
    // Skip internal config records
    if (row.id === '_classifier') continue;

    const apiKey = secrets.get(row.id);
    // Ollama doesn't require an API key; all others do
    if (!apiKey && row.type !== 'ollama') continue;

    let provider: any;
    switch (row.type) {
      case 'openai':
        provider = new OpenAIProvider(row.id, row.id, apiKey!, row.base_url || undefined);
        break;
      case 'anthropic':
        provider = new AnthropicProvider(row.id, row.id, apiKey!);
        break;
      case 'ollama':
        provider = new OllamaProvider(row.id, row.id, row.base_url);
        break;
      case 'openai-compat':
        if (!row.base_url) continue;
        provider = new OpenAICompatProvider(row.id, row.id, apiKey!, row.base_url);
        break;
    }
    if (provider) reg.register(provider);
  }
}
