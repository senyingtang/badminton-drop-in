-- 044: 場次一次性匿名暱稱（僅該場次有效）+ 場次結束/取消後清除
--
-- 目標：
-- - 讓球員在報名時可填寫「一次性匿名暱稱」（僅存在該場次）
-- - 場次狀態變為 session_finished / cancelled 時，自動清除該場次參與者的暱稱與級數
-- - 公開名單 RPC 優先回傳一次性暱稱，若無則回 players.display_name

alter table public.session_participants
  add column if not exists session_display_name text null;

comment on column public.session_participants.session_display_name is '一次性匿名暱稱：僅該場次有效；場次結束/取消時清除';

alter table public.session_participants
  drop constraint if exists chk_sp_session_display_name_len;

alter table public.session_participants
  add constraint chk_sp_session_display_name_len
  check (
    session_display_name is null
    or (length(btrim(session_display_name)) between 1 and 100)
  );

-- 場次進入終態時，清除一次性欄位（暱稱、級數）
create or replace function public.fn_clear_one_time_participant_fields_on_terminal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.status in ('session_finished', 'cancelled')
     and old.status is distinct from new.status
  then
    update public.session_participants sp
      set session_display_name = null,
          self_level = null,
          updated_at = now()
    where sp.session_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sessions_clear_one_time_fields on public.sessions;
create trigger trg_sessions_clear_one_time_fields
after update of status on public.sessions
for each row
execute function public.fn_clear_one_time_participant_fields_on_terminal();

-- 公開名單 RPC：優先回傳一次性暱稱
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
    coalesce(
      nullif(btrim(sp.session_display_name), ''),
      nullif(btrim(p.display_name), ''),
      '未命名'
    )::text as display_name,
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
    coalesce(nullif(btrim(sp.session_display_name), ''), p.display_name);
$$;

grant execute on function public.get_public_session_roster_by_share_code(text, uuid) to anon, authenticated, service_role;

