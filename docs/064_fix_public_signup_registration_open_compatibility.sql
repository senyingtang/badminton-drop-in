-- 064_fix_public_signup_registration_open_compatibility.sql
-- 最小修復：公開報名/名單相關 function 的 status whitelist 補上 registration_open。
-- 限制：不處理 rounds/matches、不處理 terminal sessions、不更新 sessions.metadata、不處理 session_courts 舊資料。

begin;

-- 1) 公開可見性判斷：補 registration_open
create or replace function public.session_is_public_signup_visible(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.sessions s
    where s.id = p_session_id
      and s.share_signup_code is not null
      and s.allow_self_signup = true
      and s.status in (
        'draft',
        'registration_open',
        'pending_confirmation',
        'ready_for_assignment',
        'assigned',
        'in_progress',
        'round_finished'
      )
  );
$$;

grant execute on function public.session_is_public_signup_visible(uuid) to authenticated, anon, service_role;

-- 2) players 公開可見：補 registration_open
create or replace function public.player_on_public_signup_roster(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.session_participants sp
    join public.sessions s on s.id = sp.session_id
    where sp.player_id = p_player_id
      and sp.is_removed = false
      and s.share_signup_code is not null
      and s.allow_self_signup = true
      and s.status in (
        'draft',
        'registration_open',
        'pending_confirmation',
        'ready_for_assignment',
        'assigned',
        'in_progress',
        'round_finished'
      )
  );
$$;

grant execute on function public.player_on_public_signup_roster(uuid) to authenticated, anon, service_role;

-- 3) 公開名單：補 registration_open（原定義於 docs/044_session_one_time_display_name_and_cleanup.sql）
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
        'registration_open',
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

commit;

