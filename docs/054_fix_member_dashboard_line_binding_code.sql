-- 054_fix_member_dashboard_line_binding_code.sql
-- Expand line_oa_binding_codes to support member-dashboard binding UX.
-- Safe to re-run; keeps legacy columns.

begin;

-- Ensure table exists
do $$
begin
  if to_regclass('public.line_oa_binding_codes') is null then
    raise exception 'line_oa_binding_codes table not found. Please apply docs/043_line_oa_binding_codes.sql first.';
  end if;
end $$;

-- Add new columns (keep legacy schema)
alter table public.line_oa_binding_codes
  add column if not exists id uuid,
  add column if not exists user_id uuid,
  add column if not exists status text not null default 'pending',
  add column if not exists line_oa_user_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

-- Make player_id nullable (spec requires nullable)
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='line_oa_binding_codes' and column_name='player_id'
  ) then
    begin
      alter table public.line_oa_binding_codes alter column player_id drop not null;
    exception when others then
      -- ignore if already nullable / constrained by older migrations
      null;
    end;
  end if;
end $$;

-- Backfill id for existing rows
update public.line_oa_binding_codes
set id = gen_random_uuid()
where id is null;

-- Backfill user_id from players.auth_user_id when possible
update public.line_oa_binding_codes bc
set user_id = p.auth_user_id
from public.players p
where bc.user_id is null
  and bc.player_id = p.id;

-- Backfill line_oa_user_id from legacy used_line_oa_user_id when available
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='line_oa_binding_codes' and column_name='used_line_oa_user_id'
  ) then
    execute $q$
      update public.line_oa_binding_codes
      set line_oa_user_id = coalesce(line_oa_user_id, used_line_oa_user_id)
      where line_oa_user_id is null;
    $q$;
  end if;
end $$;

-- Backfill status
update public.line_oa_binding_codes
set status = case
  when used_at is not null then 'used'
  when expires_at < now() then 'expired'
  else 'pending'
end
where status is null or status = '';

-- Ensure PK is id (keep unique code)
do $$
declare
  pk_name text;
begin
  select tc.constraint_name into pk_name
  from information_schema.table_constraints tc
  where tc.table_schema='public'
    and tc.table_name='line_oa_binding_codes'
    and tc.constraint_type='PRIMARY KEY'
  limit 1;

  if pk_name is not null then
    -- If PK is already on id, do nothing. Otherwise move PK to id.
    if exists (
      select 1
      from information_schema.key_column_usage k
      where k.table_schema='public'
        and k.table_name='line_oa_binding_codes'
        and k.constraint_name = pk_name
        and k.column_name = 'id'
    ) then
      null;
    else
      execute format('alter table public.line_oa_binding_codes drop constraint %I', pk_name);
      execute 'alter table public.line_oa_binding_codes add constraint line_oa_binding_codes_pkey primary key (id)';
      execute 'create unique index if not exists uq_line_oa_binding_codes_code on public.line_oa_binding_codes(code)';
    end if;
  else
    execute 'alter table public.line_oa_binding_codes add constraint line_oa_binding_codes_pkey primary key (id)';
    execute 'create unique index if not exists uq_line_oa_binding_codes_code on public.line_oa_binding_codes(code)';
  end if;
end $$;

-- Indexes
create index if not exists idx_line_oa_binding_codes_user_id on public.line_oa_binding_codes(user_id);
create index if not exists idx_line_oa_binding_codes_player_id on public.line_oa_binding_codes(player_id);
create index if not exists idx_line_oa_binding_codes_status on public.line_oa_binding_codes(status);
create index if not exists idx_line_oa_binding_codes_expires_at on public.line_oa_binding_codes(expires_at);
create index if not exists idx_line_oa_binding_codes_code on public.line_oa_binding_codes(code);

-- updated_at trigger
do $$
begin
  if exists (
    select 1
    from pg_proc
    join pg_namespace n on n.oid = pg_proc.pronamespace
    where n.nspname = 'public' and pg_proc.proname = 'set_updated_at'
  ) then
    execute 'drop trigger if exists trg_line_oa_binding_codes_updated_at on public.line_oa_binding_codes;';
    execute 'create trigger trg_line_oa_binding_codes_updated_at before update on public.line_oa_binding_codes for each row execute function public.set_updated_at();';
  end if;
end $$;

commit;

