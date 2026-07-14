-- ============================================================
-- Row Level Security — every table is owner-scoped via user_id.
-- Run AFTER schema.sql.
-- ============================================================

alter table public.profiles            enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.uploads             enable row level security;
alter table public.analysis            enable row level security;
alter table public.clips               enable row level security;
alter table public.viral_scores        enable row level security;
alter table public.narrations          enable row level security;
alter table public.competitor_reports  enable row level security;
alter table public.usage_tracking      enable row level security;

-- Helper: drop-then-create so this file is re-runnable.
-- profiles: a user can read/update only their own row.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- subscriptions: read-only for the owner. Writes happen via service role (webhook).
drop policy if exists "subs_select_own" on public.subscriptions;
create policy "subs_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- usage_tracking: read-only for owner. Writes via increment_usage()/service role.
drop policy if exists "usage_select_own" on public.usage_tracking;
create policy "usage_select_own" on public.usage_tracking
  for select using (auth.uid() = user_id);

-- Generic owner CRUD for the content tables.
do $$
declare t text;
begin
  foreach t in array array[
    'uploads', 'analysis', 'clips', 'viral_scores', 'narrations', 'competitor_reports'
  ] loop
    execute format('drop policy if exists "%1$s_select_own" on public.%1$s;', t);
    execute format('create policy "%1$s_select_own" on public.%1$s for select using (auth.uid() = user_id);', t);

    execute format('drop policy if exists "%1$s_insert_own" on public.%1$s;', t);
    execute format('create policy "%1$s_insert_own" on public.%1$s for insert with check (auth.uid() = user_id);', t);

    execute format('drop policy if exists "%1$s_update_own" on public.%1$s;', t);
    execute format('create policy "%1$s_update_own" on public.%1$s for update using (auth.uid() = user_id);', t);

    execute format('drop policy if exists "%1$s_delete_own" on public.%1$s;', t);
    execute format('create policy "%1$s_delete_own" on public.%1$s for delete using (auth.uid() = user_id);', t);
  end loop;
end $$;

-- ============================================================
-- Storage policies (bucket: `uploads`).
-- Files are namespaced by user id: `<user_id>/<upload_id>/<file>`.
-- Run after creating the bucket in the Storage UI (set to PRIVATE).
-- ============================================================
do $$ begin
  insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false)
  on conflict (id) do nothing;
exception when others then null; end $$;

drop policy if exists "uploads_read_own" on storage.objects;
create policy "uploads_read_own" on storage.objects
  for select using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "uploads_write_own" on storage.objects;
create policy "uploads_write_own" on storage.objects
  for insert with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "uploads_delete_own" on storage.objects;
create policy "uploads_delete_own" on storage.objects
  for delete using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
