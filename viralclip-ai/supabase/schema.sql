-- ============================================================
-- ViralClip AI — Database schema
-- Run in Supabase SQL editor (or `supabase db push`).
-- Order matters: enums -> tables -> indexes -> triggers -> RLS.
-- ============================================================

create extension if not exists "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────
do $$ begin
  create type plan_tier as enum ('free', 'pro', 'agency');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum (
    'active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type upload_status as enum (
    'uploading', 'uploaded', 'processing', 'analyzed', 'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type clip_length as enum ('s15', 's30', 's60');
exception when duplicate_object then null; end $$;

do $$ begin
  create type platform as enum ('tiktok', 'shorts', 'reels');
exception when duplicate_object then null; end $$;

do $$ begin
  create type narration_mode as enum (
    'storytelling', 'documentary', 'educational', 'motivational', 'news'
  );
exception when duplicate_object then null; end $$;

-- ── profiles ────────────────────────────────────────────────
-- 1:1 with auth.users. Created automatically on signup (trigger below).
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  niche       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── subscriptions ───────────────────────────────────────────
create table if not exists public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.profiles (id) on delete cascade,
  tier                    plan_tier not null default 'free',
  status                  subscription_status not null default 'active',
  stripe_customer_id      text,
  stripe_subscription_id  text,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (user_id)
);

-- ── uploads ─────────────────────────────────────────────────
create table if not exists public.uploads (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  filename      text not null,
  storage_path  text not null,
  mime_type     text,
  size_bytes    bigint,
  duration_sec  numeric,
  width         int,
  height        int,
  fps           numeric,
  status        upload_status not null default 'uploading',
  -- Timestamped speech-to-text segments: [{ start, end, text }]
  transcript    jsonb not null default '[]'::jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── analysis ────────────────────────────────────────────────
-- One row per upload. Holds the moment-level AI analysis payload.
create table if not exists public.analysis (
  id            uuid primary key default gen_random_uuid(),
  upload_id     uuid not null references public.uploads (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  -- arrays of { start, end, type, intensity, reason }
  moments       jsonb not null default '[]'::jsonb,
  -- predicted drop-off points + weak/strong sections + recommendations
  retention     jsonb not null default '{}'::jsonb,
  summary       text,
  model         text,
  created_at    timestamptz not null default now(),
  unique (upload_id)
);

-- ── clips ───────────────────────────────────────────────────
create table if not exists public.clips (
  id            uuid primary key default gen_random_uuid(),
  upload_id     uuid not null references public.uploads (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  length        clip_length not null,
  start_sec     numeric not null,
  end_sec       numeric not null,
  title         text,
  storage_path  text,            -- rendered clip, null until exported
  thumbnail_path text,
  exported      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ── viral_scores ────────────────────────────────────────────
-- Predicted scores per clip (0–100). These are PREDICTIONS, never guarantees.
create table if not exists public.viral_scores (
  id              uuid primary key default gen_random_uuid(),
  clip_id         uuid not null references public.clips (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  virality        int not null check (virality between 0 and 100),
  retention       int not null check (retention between 0 and 100),
  engagement      int not null check (engagement between 0 and 100),
  reasons         jsonb not null default '[]'::jsonb,
  improvements    jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  unique (clip_id)
);

-- ── narrations ──────────────────────────────────────────────
create table if not exists public.narrations (
  id            uuid primary key default gen_random_uuid(),
  clip_id       uuid references public.clips (id) on delete cascade,
  upload_id     uuid references public.uploads (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  mode          narration_mode not null,
  script        text not null,
  audio_path    text,            -- null until TTS rendered
  created_at    timestamptz not null default now()
);

-- ── competitor_reports ──────────────────────────────────────
create table if not exists public.competitor_reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  source_url    text not null,
  platform      platform,
  hook_strength int check (hook_strength between 0 and 100),
  editing_pace  text,
  structure     text,
  engagement_drivers jsonb not null default '[]'::jsonb,
  recommendations    jsonb not null default '[]'::jsonb,
  raw           jsonb,
  created_at    timestamptz not null default now()
);

-- ── usage_tracking ──────────────────────────────────────────
-- One row per user per month. Incremented atomically via increment_usage().
create table if not exists public.usage_tracking (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  period        text not null,                 -- 'YYYY-MM'
  uploads       int not null default 0,
  clips         int not null default 0,
  ai_calls      int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, period)
);

-- ── Indexes ─────────────────────────────────────────────────
create index if not exists idx_uploads_user      on public.uploads (user_id, created_at desc);
create index if not exists idx_clips_upload       on public.clips (upload_id);
create index if not exists idx_clips_user         on public.clips (user_id, created_at desc);
create index if not exists idx_narrations_user    on public.narrations (user_id, created_at desc);
create index if not exists idx_competitor_user    on public.competitor_reports (user_id, created_at desc);
create index if not exists idx_usage_user_period  on public.usage_tracking (user_id, period);

-- ── updated_at trigger ──────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$ begin
  create trigger trg_profiles_touch       before update on public.profiles      for each row execute function public.touch_updated_at();
  create trigger trg_subscriptions_touch  before update on public.subscriptions for each row execute function public.touch_updated_at();
  create trigger trg_uploads_touch        before update on public.uploads       for each row execute function public.touch_updated_at();
  create trigger trg_usage_touch          before update on public.usage_tracking for each row execute function public.touch_updated_at();
exception when others then null; end $$;

-- ── New-user bootstrap ──────────────────────────────────────
-- Creates a profile + free subscription row whenever an auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.subscriptions (user_id, tier, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;

  return new;
end $$;

do $$ begin
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
exception when others then null; end $$;

-- ── Atomic usage increment ──────────────────────────────────
create or replace function public.increment_usage(
  p_user_id uuid,
  p_uploads int default 0,
  p_clips int default 0,
  p_ai_calls int default 0
) returns void language plpgsql security definer set search_path = public as $$
declare
  p text := to_char(now(), 'YYYY-MM');
begin
  insert into public.usage_tracking (user_id, period, uploads, clips, ai_calls)
  values (p_user_id, p, p_uploads, p_clips, p_ai_calls)
  on conflict (user_id, period) do update
    set uploads  = usage_tracking.uploads  + excluded.uploads,
        clips    = usage_tracking.clips    + excluded.clips,
        ai_calls = usage_tracking.ai_calls + excluded.ai_calls,
        updated_at = now();
end $$;
