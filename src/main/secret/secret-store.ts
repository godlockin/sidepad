import type Database from 'better-sqlite3';
import { safeStorage } from 'electron';

export class SecretStore {
  constructor(private readonly db: Database.Database) {}

  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  set(providerConfigId: string, plaintext: string): void {
    const cipher = safeStorage.encryptString(plaintext);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO provider_secrets(provider_config_id, ciphertext, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(provider_config_id) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      )
      .run(providerConfigId, cipher, now, now);
  }

  get(providerConfigId: string): string | null {
    const row = this.db
      .prepare('SELECT ciphertext FROM provider_secrets WHERE provider_config_id = ?')
      .get(providerConfigId) as { ciphertext: Buffer } | undefined;
    if (!row) return null;
    try {
      return safeStorage.decryptString(row.ciphertext);
    } catch {
      return null;
    }
  }

  delete(providerConfigId: string): void {
    this.db.prepare('DELETE FROM provider_secrets WHERE provider_config_id = ?').run(providerConfigId);
  }
}
