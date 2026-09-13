-- Collaboration mode for multi-agent sessions.
-- The legacy group_mode column carries a CHECK constraint limited to
-- ('parallel','relay'); rather than rebuilding the sessions table we add an
-- unconstrained column. NULL means 'auto' (mode inferred from @-mentions and
-- trigger phrases). See GroupMode in shared/types/session.ts.
ALTER TABLE sessions ADD COLUMN collab_mode TEXT;
