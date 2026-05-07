-- 053_fix_quota_bucket_period_columns_and_admin_quota.sql
-- Fix: admin quota operations failed due to missing columns (e.g. period_end) in kb_quota_buckets.
-- Safe to re-run; keeps legacy columns and backfills when possible.

begin;

-- Ensure table exists
do $$
begin
  if to_regclass('public.kb_quota_buckets') is null then
    raise exception 'kb_quota_buckets table not found. Please apply docs/005_billing_schema.sql first.';
  end if;
end $$;

-- Add missing columns
alter table public.kb_quota_buckets
  add column if not exists period_start timestamptz,
  add column if not exists period_end timestamptz,
  add column if not exists quota_total integer not null default 0,
  add column if not exists status text not null default 'active',
  add column if not exists source text not null default 'system',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- NOTE: kb_quota_buckets already has quota_used, quota_limit, valid_from, valid_to in 005.
-- We do NOT add quota_used to avoid conflicts; we only backfill if it exists.

-- Backfill period_start from legacy columns when available
update public.kb_quota_buckets
set period_start = coalesce(
  period_start,
  valid_from,
  created_at
)
where period_start is null;

-- Backfill period_end using reset_at if exists, otherwise valid_to or +1 month
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='kb_quota_buckets' and column_name='reset_at'
  ) then
    execute $q$
      update public.kb_quota_buckets
      set period_end = coalesce(period_end, reset_at, valid_to, created_at + interval '1 month')
      where period_end is null;
    $q$;
  else
    execute $q$
      update public.kb_quota_buckets
      set period_end = coalesce(period_end, valid_to, created_at + interval '1 month')
      where period_end is null;
    $q$;
  end if;
end $$;

-- Backfill quota_total from quota_limit if missing/zero
update public.kb_quota_buckets
set quota_total = case
  when quota_total is null or quota_total = 0 then coalesce(quota_limit, 0)
  else quota_total end
where quota_total is null or quota_total = 0;

-- Backfill source from source_label if exists
update public.kb_quota_buckets
set source = coalesce(source, source_label, 'system')
where source is null or source = '';

-- Touch updated_at
update public.kb_quota_buckets
set updated_at = now()
where updated_at is null;

-- updated_at trigger if kb_touch_updated_at exists
do $$
begin
  if exists (
    select 1
    from pg_proc
    join pg_namespace n on n.oid = pg_proc.pronamespace
    where n.nspname = 'public' and pg_proc.proname = 'kb_touch_updated_at'
  ) then
    execute 'drop trigger if exists trg_kb_quota_buckets_updated_at on public.kb_quota_buckets;';
    execute 'create trigger trg_kb_quota_buckets_updated_at before update on public.kb_quota_buckets for each row execute function public.kb_touch_updated_at();';
  end if;
end $$;

commit;

