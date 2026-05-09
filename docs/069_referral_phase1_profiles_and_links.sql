-- 069_referral_phase1_profiles_and_links.sql
-- Phase 1: member referral codes + signup links (no commission math).
-- Run in Supabase SQL Editor after review. Idempotent where possible.

begin;

-- ---------------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------------
create table if not exists public.member_referral_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  referral_code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ux_member_referral_profiles_user unique (user_id),
  constraint ux_member_referral_profiles_code unique (referral_code),
  constraint chk_member_referral_code_format check (
    referral_code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$'
  )
);

create index if not exists idx_member_referral_profiles_code
  on public.member_referral_profiles (referral_code)
  where is_active = true;

create table if not exists public.member_referral_links (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users (id) on delete restrict,
  referred_user_id uuid not null references auth.users (id) on delete cascade,
  referral_code_used text not null,
  registered_at timestamptz not null default now(),
  source text not null default 'signup',
  status text not null default 'active',
  created_by_user_id uuid references auth.users (id) on delete set null,
  corrected_by_user_id uuid references auth.users (id) on delete set null,
  corrected_at timestamptz,
  correction_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ux_member_referral_links_referred unique (referred_user_id),
  constraint chk_member_referral_links_distinct check (referrer_user_id <> referred_user_id),
  constraint chk_member_referral_links_status check (status in ('active', 'corrected', 'voided'))
);

create index if not exists idx_member_referral_links_referrer
  on public.member_referral_links (referrer_user_id, created_at desc);

drop trigger if exists trg_member_referral_profiles_updated_at on public.member_referral_profiles;
create trigger trg_member_referral_profiles_updated_at
before update on public.member_referral_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_member_referral_links_updated_at on public.member_referral_links;
create trigger trg_member_referral_links_updated_at
before update on public.member_referral_links
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Code generation + ensure profile
-- ---------------------------------------------------------------------------
create or replace function public.generate_referral_code()
returns text
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_chars text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_len int := 8;
  v_out text := '';
  v_i int;
  v_pick int;
begin
  for v_i in 1..v_len loop
    v_pick := 1 + floor(random() * length(v_chars))::int;
    v_out := v_out || substr(v_chars, v_pick, 1);
  end loop;
  return v_out;
end;
$$;

create or replace function public.ensure_member_referral_profile(p_user_id uuid)
returns public.member_referral_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.member_referral_profiles;
  v_code text;
  v_attempt int;
begin
  if auth.uid() is not null and auth.uid() is distinct from p_user_id then
    raise exception 'forbidden';
  end if;
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  select * into v_row from public.member_referral_profiles where user_id = p_user_id;
  if found then
    return v_row;
  end if;

  for v_attempt in 1..40 loop
    v_code := public.generate_referral_code();
    begin
      insert into public.member_referral_profiles (user_id, referral_code)
      values (p_user_id, v_code)
      returning * into v_row;
      return v_row;
    exception
      when unique_violation then
        null;
    end;
  end loop;

  raise exception 'referral_code_generation_failed';
end;
$$;

-- Public: validate code exists (for signup UI). Does not leak PII.
create or replace function public.member_referral_lookup_active_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id
  from public.member_referral_profiles m
  where m.referral_code = upper(trim(p_code))
    and m.is_active = true
  limit 1;
$$;

-- Authenticated referred user OR service_role (LINE callback): create link once.
create or replace function public.member_referral_try_link_after_signup(p_referred_user_id uuid, p_referral_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text;
  v_ref uuid;
begin
  if auth.uid() is not null and auth.uid() is distinct from p_referred_user_id then
    raise exception 'forbidden';
  end if;
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  if p_referral_code is null or length(trim(p_referral_code)) = 0 then
    return;
  end if;

  v_norm := upper(trim(p_referral_code));
  if v_norm !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$' then
    raise exception 'invalid_referral_code' using errcode = '22023';
  end if;

  if exists (select 1 from public.member_referral_links where referred_user_id = p_referred_user_id) then
    return;
  end if;

  select m.user_id into v_ref
  from public.member_referral_profiles m
  where m.referral_code = v_norm and m.is_active = true
  limit 1;

  if v_ref is null then
    raise exception 'invalid_referral_code' using errcode = '22023';
  end if;

  if v_ref = p_referred_user_id then
    raise exception 'self_referral' using errcode = '22023';
  end if;

  insert into public.member_referral_links (
    referrer_user_id,
    referred_user_id,
    referral_code_used,
    source,
    status
  ) values (
    v_ref,
    p_referred_user_id,
    v_norm,
    'signup',
    'active'
  )
  on conflict (referred_user_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) RLS
-- ---------------------------------------------------------------------------
alter table public.member_referral_profiles enable row level security;
alter table public.member_referral_links enable row level security;

drop policy if exists member_referral_profiles_select_own on public.member_referral_profiles;
create policy member_referral_profiles_select_own
on public.member_referral_profiles
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists member_referral_profiles_select_admin on public.member_referral_profiles;
create policy member_referral_profiles_select_admin
on public.member_referral_profiles
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists member_referral_profiles_update_admin on public.member_referral_profiles;
create policy member_referral_profiles_update_admin
on public.member_referral_profiles
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists member_referral_links_select_self on public.member_referral_links;
create policy member_referral_links_select_self
on public.member_referral_links
for select
to authenticated
using (referrer_user_id = auth.uid() or referred_user_id = auth.uid());

drop policy if exists member_referral_links_select_admin on public.member_referral_links;
create policy member_referral_links_select_admin
on public.member_referral_links
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists member_referral_links_write_admin on public.member_referral_links;
create policy member_referral_links_write_admin
on public.member_referral_links
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 4) Grants
-- ---------------------------------------------------------------------------
grant select on public.member_referral_profiles to authenticated;
grant select on public.member_referral_links to authenticated;

grant execute on function public.generate_referral_code() to authenticated, service_role;
grant execute on function public.ensure_member_referral_profile(uuid) to authenticated, service_role;
grant execute on function public.member_referral_lookup_active_code(text) to authenticated, service_role;
grant execute on function public.member_referral_try_link_after_signup(uuid, text) to authenticated, service_role;

commit;
