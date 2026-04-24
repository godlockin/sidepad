import type { LLMProvider } from './types';

type ChangeListener = (action: 'registered' | 'unregistered', providerId: string) => void;

export class ProviderRegistry {
  private providers: Map<string, LLMProvider> = new Map();
  private listeners: Set<ChangeListener> = new Set();

  register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
    this.emitProviderChanged('registered', provider.id);
  }

  unregister(id: string): void {
    this.providers.delete(id);
    this.emitProviderChanged('unregistered', id);
  }

  get(id: string): LLMProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider "${id}" not found`);
    }
    return provider;
  }

  list(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  onProviderChanged(listener: ChangeListener): void {
    this.listeners.add(listener);
  }

  private emitProviderChanged(action: 'registered' | 'unregistered', providerId: string): void {
    for (const listener of this.listeners) {
      listener(action, providerId);
    }
  }
}

export const registry = new ProviderRegistry();

export type { LLMProvider, Model, ChatRequest, ChatChunk } from './types';
export { ProviderError, normalizeError, type ErrorCode } from './errors';
