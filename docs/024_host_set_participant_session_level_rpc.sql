-- 團主／場館管理者調整「當場有效級數」
-- 原因：以 PostgREST PATCH 直接 update session_participants 時，RLS 的 OR 條件可能
--       仍會評估到 auth_player_id() → players 表 RLS → 遞迴 → 54001 stack depth exceeded。
-- 解法：security definer RPC 內更新，與 confirm_participant_status 等既有 RPC 一致。

create or replace function public.host_set_participant_session_level(
  input_session_participant_id uuid,
  input_level smallint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sp public.session_participants%rowtype;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if input_level is null or not public.is_valid_level(input_level) then
    raise exception 'invalid_level' using errcode = 'P0001';
  end if;

  select * into v_sp
  from public.session_participants
  where id = input_session_participant_id
  for update;

  if not found then
    raise exception 'session participant not found';
  end if;

  if not (
    public.user_is_session_host(v_sp.session_id)
    or public.user_manages_venue((select s.venue_id from public.sessions s where s.id = v_sp.session_id limit 1))
    or public.is_platform_admin()
  ) then
    raise exception 'forbidden';
  end if;

  update public.session_participants
  set
    host_confirmed_level = input_level,
    session_effective_level = input_level,
    updated_at = now()
  where id = input_session_participant_id;
end;
$$;

grant execute on function public.host_set_participant_session_level(uuid, smallint) to authenticated, service_role;
