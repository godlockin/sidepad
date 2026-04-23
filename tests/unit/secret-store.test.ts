// tests/unit/secret-store.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SecretStore } from '@main/secret/secret-store';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('enc:' + s),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  },
}));

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE provider_configs(id TEXT PRIMARY KEY);
    CREATE TABLE provider_secrets (
      provider_config_id TEXT PRIMARY KEY REFERENCES provider_configs(id) ON DELETE CASCADE,
      ciphertext BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO provider_configs(id) VALUES ('p1');
  `);
});

describe('SecretStore', () => {
  it('stores and retrieves a secret round-trip', () => {
    const s = new SecretStore(db);
    s.set('p1', 'sk-abc123');
    expect(s.get('p1')).toBe('sk-abc123');
  });

  it('returns null for missing config', () => {
    const s = new SecretStore(db);
    expect(s.get('nope')).toBeNull();
  });

  it('overwrites on repeated set, updates updated_at', () => {
    const s = new SecretStore(db);
    s.set('p1', 'first');
    s.set('p1', 'second');
    expect(s.get('p1')).toBe('second');
    const row = db.prepare('SELECT * FROM provider_secrets WHERE provider_config_id=?').get('p1') as any;
    expect(row.updated_at).toBeGreaterThanOrEqual(row.created_at);
  });

  it('deletes secret', () => {
    const s = new SecretStore(db);
    s.set('p1', 'x');
    s.delete('p1');
    expect(s.get('p1')).toBeNull();
  });

  it('reports encryption-available status', () => {
    const s = new SecretStore(db);
    expect(s.isEncryptionAvailable()).toBe(true);
  });
});
