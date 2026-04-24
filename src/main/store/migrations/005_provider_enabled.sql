-- Phase 3: Add `enabled` column to provider_configs so factory.loadProviders
-- can filter to only active provider configurations.
ALTER TABLE provider_configs ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
