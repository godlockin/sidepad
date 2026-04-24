-- Phase 3.5: Persona library — independent prompts that can be assigned to
-- any participant in a session. Multiple LLM instances (e.g. azure-pm,
-- azure-eng) can share a backing model but load distinct personas.

CREATE TABLE IF NOT EXISTS personas (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Seed a default persona used when participants don't pin one explicitly.
INSERT OR IGNORE INTO personas (id, name, prompt, created_at, updated_at)
VALUES (
  '_default',
  'default',
  'You are a helpful, concise assistant.',
  strftime('%s','now') * 1000,
  strftime('%s','now') * 1000
);
