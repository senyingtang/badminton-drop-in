-- 038: 團主營運報表、場次終止後鎖定不可改、公開報名頁名單 RPC
-- 套用前請確認已依 SQL_MIGRATION_ORDER.md 跑完 037（或至少 034+012 公開場次政策）。

-- ---------------------------------------------------------------------------
-- 1) 團主營運成本／報表（自行填寫支出與報名費假設，前端計算損益）
-- ---------------------------------------------------------------------------

create table if not exists public.host_operation_reports (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references public.app_user_profiles (id) on delete cascade,
  title text,
  shuttlecock_label text,
  shuttlecock_units integer not null default 0,
  shuttlecock_cost_twd integer not null default 0,
  venue_fee_twd integer not null default 0,
  other_cost_twd integer not null default 0,
  other_cost_note text,
  expected_fee_per_person_twd integer not null default 0,
  assumed_collected_headcount integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_host_op_shuttle_units_nonneg check (shuttlecock_units >= 0),
  constraint chk_host_op_costs_nonneg check (
    shuttlecock_cost_twd >= 0
    and venue_fee_twd >= 0
    and other_cost_twd >= 0
    and expected_fee_per_person_twd >= 0
    and assumed_collected_headcount >= 0
  )
);

create index if not exists idx_host_op_reports_host_created
  on public.host_operation_reports (host_user_id, created_at desc);

drop trigger if exists trg_host_operation_reports_updated_at on public.host_operation_reports;
create trigger trg_host_operation_reports_updated_at
before update on public.host_operation_reports
for each row execute function public.set_updated_at();

alter table public.host_operation_reports enable row level security;

drop policy if exists host_operation_reports_select_own on public.host_operation_reports;
create policy host_operation_reports_select_own
on public.host_operation_reports
for select
using (host_user_id = auth.uid() or public.is_platform_admin());

drop policy if exists host_operation_reports_insert_own on public.host_operation_reports;
create policy host_operation_reports_insert_own
on public.host_operation_reports
for insert
with check (host_user_id = auth.uid() or public.is_platform_admin());

drop policy if exists host_operation_reports_update_own on public.host_operation_reports;
create policy host_operation_reports_update_own
on public.host_operation_reports
for update
using (host_user_id = auth.uid() or public.is_platform_admin())
with check (host_user_id = auth.uid() or public.is_platform_admin());

drop policy if exists host_operation_reports_delete_own on public.host_operation_reports;
create policy host_operation_reports_delete_own
on public.host_operation_reports
for delete
using (host_user_id = auth.uid() or public.is_platform_admin());

grant select, insert, update, delete on public.host_operation_reports to authenticated;
grant all on public.host_operation_reports to service_role;

-- ---------------------------------------------------------------------------
-- 2) 場次：已結束或已取消後禁止任何 UPDATE（含主辦）
-- ---------------------------------------------------------------------------

create or replace function public.fn_sessions_block_update_when_terminal()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('session_finished'::session_status_type, 'cancelled'::session_status_type) then
    raise exception 'SESSION_TERMINAL_LOCKED'
      using hint = '已結束或已取消的場次不可再修改內容。';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sessions_block_update_when_terminal on public.sessions;
create trigger trg_sessions_block_update_when_terminal
before update on public.sessions
for each row
execute function public.fn_sessions_block_update_when_terminal();

-- ---------------------------------------------------------------------------
-- 3) 公開報名頁：依分享碼讀取名單（匿名可執行；僅回傳暱稱與候補順序）
-- ---------------------------------------------------------------------------

create or replace function public.get_public_session_roster_by_share_code(
  p_share_code text,
  p_viewer_player_id uuid default null
)
returns table (
  roster_kind text,
  display_name text,
  waitlist_order integer,
  is_self boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with ses as (
    select s.id as session_id
    from public.sessions s
    where s.share_signup_code is not null
      and s.allow_self_signup = true
      and btrim(p_share_code) <> ''
      and lower(btrim(s.share_signup_code)) = lower(btrim(p_share_code))
      and s.status in (
        'draft',
        'pending_confirmation',
        'ready_for_assignment',
        'assigned',
        'in_progress',
        'round_finished',
        'session_finished'
      )
    limit 1
  )
  select
    case
      when sp.status = 'waitlist' then 'waitlist'
      else 'main'
    end::text as roster_kind,
    coalesce(nullif(trim(p.display_name), ''), '未命名')::text as display_name,
    sp.waitlist_order,
    (p_viewer_player_id is not null and sp.player_id = p_viewer_player_id) as is_self
  from ses
  join public.session_participants sp on sp.session_id = ses.session_id
  join public.players p on p.id = sp.player_id
  where sp.is_removed = false
    and sp.status in (
      'confirmed_main',
      'promoted_from_waitlist',
      'waitlist',
      'completed'
    )
  order by
    case when sp.status = 'waitlist' then 1 else 0 end,
    sp.waitlist_order nulls last,
    p.display_name;
$$;

grant execute on function public.get_public_session_roster_by_share_code(text, uuid) to anon, authenticated, service_role;
