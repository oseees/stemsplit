-- Incremental migration for databases created before transcription support.
-- Safe to run multiple times.
alter table public.uploads
  add column if not exists transcript jsonb not null default '[]'::jsonb;
