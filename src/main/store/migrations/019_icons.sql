-- Phase: instance icons
-- Add icon_kind ('emoji' | 'image') and icon_value (emoji char or data:URL)
-- to sessions and provider_configs. Both nullable -> renders hash-color
-- initial-letter fallback when not set.

ALTER TABLE sessions ADD COLUMN icon_kind  TEXT;
ALTER TABLE sessions ADD COLUMN icon_value TEXT;

ALTER TABLE provider_configs ADD COLUMN icon_kind  TEXT;
ALTER TABLE provider_configs ADD COLUMN icon_value TEXT;
