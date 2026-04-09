-- 臨打團（主辦公開資訊）：每位 host 一筆，供前台／分享頁使用。

create table if not exists public.pickup_group_settings (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null unique references public.app_user_profiles(id) on delete cascade,
  logo_url text,
  group_name text not null default '',
  owner_display_name text not null default '',
  intro text,
  location text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pickup_group_settings_host_user_id_idx
  on public.pickup_group_settings (host_user_id);

alter table public.pickup_group_settings enable row level security;

create policy pickup_group_settings_select_own
  on public.pickup_group_settings
  for select
  to authenticated
  using (host_user_id = auth.uid() or public.is_platform_admin());

create policy pickup_group_settings_insert_own
  on public.pickup_group_settings
  for insert
  to authenticated
  with check (host_user_id = auth.uid());

create policy pickup_group_settings_update_own
  on public.pickup_group_settings
  for update
  to authenticated
  using (host_user_id = auth.uid() or public.is_platform_admin())
  with check (host_user_id = auth.uid() or public.is_platform_admin());
