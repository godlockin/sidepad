import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  createUsageStore,
  resolveModelPricing,
  estimateCostUsd,
  DEFAULT_MODEL_PRICING,
} from '@main/store/usage-store';

function openMem(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      role TEXT NOT NULL,
      model_id TEXT,
      content TEXT NOT NULL,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      status TEXT NOT NULL DEFAULT 'done',
      meta_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe('resolveModelPricing / estimateCostUsd', () => {
  it('matches longest built-in substring', () => {
    const p = resolveModelPricing('openai/gpt-4o-mini-2024', {});
    expect(p).toEqual(
      DEFAULT_MODEL_PRICING.find((r) => r.match === 'gpt-4o-mini')!.pricing,
    );
  });
  it('prefers custom exact key', () => {
    const p = resolveModelPricing('gpt-4o', {
      'gpt-4o': { inputPer1M: 1, outputPer1M: 2 },
    });
    expect(p).toEqual({ inputPer1M: 1, outputPer1M: 2 });
  });
  it('returns null for unknown local models', () => {
    expect(resolveModelPricing('llama3.2:latest', {})).toBeNull();
  });
  it('estimates USD from token counts', () => {
    expect(estimateCostUsd(1_000_000, 500_000, { inputPer1M: 2, outputPer1M: 10 })).toBe(7);
    expect(estimateCostUsd(100, 100, null)).toBeNull();
  });
});

describe('createUsageStore.summarize', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openMem();
    const now = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO sessions(id, title, created_at, updated_at) VALUES (?,?,?,?)').run(
      's1',
      'Alpha',
      now,
      now,
    );
    db.prepare('INSERT INTO sessions(id, title, created_at, updated_at) VALUES (?,?,?,?)').run(
      's2',
      'Beta',
      now,
      now,
    );
    const insert = db.prepare(
      `INSERT INTO messages(id, session_id, turn_id, role, model_id, content, prompt_tokens, completion_tokens, meta_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    insert.run(
      'm1',
      's1',
      't1',
      'assistant',
      'gpt-4o',
      'hi',
      1000,
      500,
      JSON.stringify({ providerId: 'openai', modelId: 'gpt-4o' }),
      now,
    );
    insert.run(
      'm2',
      's1',
      't2',
      'assistant',
      'gpt-4o',
      'hi',
      2000,
      1000,
      JSON.stringify({ providerId: 'openai', modelId: 'gpt-4o' }),
      now,
    );
    insert.run(
      'm3',
      's2',
      't3',
      'assistant',
      'llama3',
      'hi',
      500,
      100,
      JSON.stringify({ providerId: 'ollama', modelId: 'llama3' }),
      now,
    );
    insert.run('m4', 's2', 't4', 'user', null, 'q', null, null, null, now);
  });

  it('aggregates by model and session', () => {
    const store = createUsageStore(db);
    const summary = store.summarize();
    expect(summary.totalCalls).toBe(3);
    expect(summary.totalPromptTokens).toBe(3500);
    expect(summary.totalCompletionTokens).toBe(1600);

    const gpt = summary.byModel.find((r) => r.modelId === 'gpt-4o');
    expect(gpt?.calls).toBe(2);
    expect(gpt?.promptTokens).toBe(3000);
    expect(gpt?.estimatedCostUsd).toBeGreaterThan(0);

    const local = summary.byModel.find((r) => r.modelId === 'llama3');
    expect(local?.estimatedCostUsd).toBeNull();

    expect(summary.bySession[0]?.sessionId).toBe('s1');
    expect(summary.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('respects since filter', () => {
    const store = createUsageStore(db);
    const future = Math.floor(Date.now() / 1000) + 10_000;
    const summary = store.summarize({ since: future });
    expect(summary.totalCalls).toBe(0);
    expect(summary.estimatedCostUsd).toBe(0);
  });

  it('persists custom pricing overrides', () => {
    const store = createUsageStore(db);
    store.setPricing({ llama3: { inputPer1M: 0, outputPer1M: 0 } });
    expect(store.getPricing()).toEqual({ llama3: { inputPer1M: 0, outputPer1M: 0 } });
    const summary = store.summarize();
    const local = summary.byModel.find((r) => r.modelId === 'llama3');
    expect(local?.estimatedCostUsd).toBe(0);
  });
});

describe('checkBudget', () => {
  it('allows when disabled', async () => {
    const { checkBudget } = await import('@main/store/usage-store');
    const db = openMem();
    expect(checkBudget(db).ok).toBe(true);
  });

  it('blocks when spend exceeds cap', async () => {
    const { checkBudget, createUsageStore } = await import('@main/store/usage-store');
    const { createAppSettingsStore } = await import('@main/store/app-settings-store');
    const db = openMem();
    const now = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO sessions(id, title, created_at, updated_at) VALUES (?,?,?,?)').run(
      's1',
      'A',
      now,
      now,
    );
    db.prepare(
      `INSERT INTO messages(id, session_id, turn_id, role, model_id, content, prompt_tokens, completion_tokens, meta_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      'm1',
      's1',
      't1',
      'assistant',
      'gpt-4o',
      'hi',
      1_000_000,
      1_000_000,
      JSON.stringify({ providerId: 'openai' }),
      now,
    );
    createAppSettingsStore(db).setSetting(
      'usage_budget',
      JSON.stringify({ enabled: true, maxUsd: 0.01, periodDays: 30 }),
    );
    // Ensure pricing resolves so estimatedCostUsd is non-null
    createUsageStore(db);
    const result = checkBudget(db);
    expect(result.ok).toBe(false);
    expect(result.scope).toBe('period');
    expect(result.spentUsd).toBeGreaterThan(0.01);
  });

  it('blocks when session spend exceeds session cap', async () => {
    const { checkBudget, createUsageStore } = await import('@main/store/usage-store');
    const { createAppSettingsStore } = await import('@main/store/app-settings-store');
    const db = openMem();
    const now = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO sessions(id, title, created_at, updated_at) VALUES (?,?,?,?)').run(
      's1',
      'A',
      now,
      now,
    );
    db.prepare(
      `INSERT INTO messages(id, session_id, turn_id, role, model_id, content, prompt_tokens, completion_tokens, meta_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      'm1',
      's1',
      't1',
      'assistant',
      'gpt-4o',
      'hi',
      1_000_000,
      1_000_000,
      JSON.stringify({ providerId: 'openai' }),
      now,
    );
    createAppSettingsStore(db).setSetting(
      'usage_budget',
      JSON.stringify({ enabled: true, maxUsd: null, periodDays: 30, sessionMaxUsd: 0.01 }),
    );
    createUsageStore(db);
    const result = checkBudget(db, 's1');
    expect(result.ok).toBe(false);
    expect(result.scope).toBe('session');
    expect(result.spentUsd).toBeGreaterThan(0.01);
  });
});
