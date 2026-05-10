-- 075_commission_phase2_items_and_rates.sql
-- Phase 2: commission item definitions + per-referrer rate overrides (no ledger, no payouts).
-- Run in Supabase SQL Editor after review. Idempotent where possible.
-- Note: PK default uses gen_random_uuid() (consistent with Phase 1 / Supabase).

begin;

-- ---------------------------------------------------------------------------
-- 1) commission_items
-- ---------------------------------------------------------------------------
create table if not exists public.commission_items (
  id uuid primary key default gen_random_uuid(),
  item_key text not null,
  display_name text not null,
  description text,
  default_rate numeric(6, 4) not null default 0.1000,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ux_commission_items_item_key unique (item_key),
  constraint chk_commission_items_default_rate check (default_rate >= 0 and default_rate <= 1),
  constraint chk_commission_items_item_key_snake check (item_key ~ '^[a-z][a-z0-9_]*$')
);

drop trigger if exists trg_commission_items_updated_at on public.commission_items;
create trigger trg_commission_items_updated_at
before update on public.commission_items
for each row execute function public.set_updated_at();

create index if not exists idx_commission_items_active_sort
  on public.commission_items (is_active, sort_order);

alter table public.commission_items enable row level security;

drop policy if exists "Anyone can select active commission_items" on public.commission_items;
create policy "Anyone can select active commission_items"
  on public.commission_items
  for select
  using (is_active = true);

drop policy if exists "Platform admin select all commission_items" on public.commission_items;
create policy "Platform admin select all commission_items"
  on public.commission_items
  for select
  using (public.is_platform_admin());

drop policy if exists "Platform admin insert commission_items" on public.commission_items;
create policy "Platform admin insert commission_items"
  on public.commission_items
  for insert
  with check (public.is_platform_admin());

drop policy if exists "Platform admin update commission_items" on public.commission_items;
create policy "Platform admin update commission_items"
  on public.commission_items
  for update
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2) commission_referrer_item_rates
-- ---------------------------------------------------------------------------
create table if not exists public.commission_referrer_item_rates (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references public.app_user_profiles (id) on delete cascade,
  commission_item_id uuid not null references public.commission_items (id) on delete cascade,
  rate numeric(6, 4) not null,
  is_active boolean not null default true,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.app_user_profiles (id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ux_commission_referrer_item unique (referrer_user_id, commission_item_id),
  constraint chk_commission_referrer_item_rate check (rate >= 0 and rate <= 1)
);

drop trigger if exists trg_commission_referrer_item_rates_updated_at on public.commission_referrer_item_rates;
create trigger trg_commission_referrer_item_rates_updated_at
before update on public.commission_referrer_item_rates
for each row execute function public.set_updated_at();

create index if not exists idx_commission_referrer_rates_referrer
  on public.commission_referrer_item_rates (referrer_user_id);

alter table public.commission_referrer_item_rates enable row level security;

drop policy if exists "Referrer can select own commission_referrer_item_rates" on public.commission_referrer_item_rates;
create policy "Referrer can select own commission_referrer_item_rates"
  on public.commission_referrer_item_rates
  for select
  using (referrer_user_id = auth.uid());

drop policy if exists "Platform admin select commission_referrer_item_rates" on public.commission_referrer_item_rates;
create policy "Platform admin select commission_referrer_item_rates"
  on public.commission_referrer_item_rates
  for select
  using (public.is_platform_admin());

drop policy if exists "Platform admin insert commission_referrer_item_rates" on public.commission_referrer_item_rates;
create policy "Platform admin insert commission_referrer_item_rates"
  on public.commission_referrer_item_rates
  for insert
  with check (public.is_platform_admin());

drop policy if exists "Platform admin update commission_referrer_item_rates" on public.commission_referrer_item_rates;
create policy "Platform admin update commission_referrer_item_rates"
  on public.commission_referrer_item_rates
  for update
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3) Seed commission_items (idempotent)
-- ---------------------------------------------------------------------------
insert into public.commission_items (item_key, display_name, description, default_rate, is_active, sort_order)
values
  ('wallet_topup', '儲值金', '錢包儲值（預設分潤比例，Phase 3 起計算）', 0.1000, true, 10),
  ('subscription', '月費訂閱', '訂閱方案（預設分潤比例，Phase 3 起計算）', 0.1000, true, 20),
  ('court_fee', '場地費', '場地費（預留）', 0.1000, false, 30),
  ('coaching_lesson', '教練課', '教練課（預留）', 0.1000, false, 40),
  ('merchandise', '球衣商品', '商品（預留）', 0.1000, false, 50),
  ('other', '其他', '其他項目（預留）', 0.1000, false, 60)
on conflict (item_key) do update set
  display_name = excluded.display_name,
  description = excluded.description;

commit;
