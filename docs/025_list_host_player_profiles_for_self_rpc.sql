-- 團主「球員名單」頁：避免 PostgREST 巢狀 embed players(...) 觸發 players RLS 遞迴 → 500
-- 改由 security definer 一次回傳 host_player_profiles + 顯示用球員欄位。

create or replace function public.list_host_player_profiles_for_self()
returns table (
  id uuid,
  host_user_id uuid,
  player_id uuid,
  self_level smallint,
  host_confirmed_level smallint,
  default_level_adjustment smallint,
  warning_status warning_status_type,
  is_blacklisted boolean,
  private_note text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  player_code citext,
  display_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  return query
  select
    h.id,
    h.host_user_id,
    h.player_id,
    h.self_level,
    h.host_confirmed_level,
    h.default_level_adjustment,
    h.warning_status,
    h.is_blacklisted,
    h.private_note,
    h.is_active,
    h.created_at,
    h.updated_at,
    p.player_code,
    p.display_name
  from public.host_player_profiles h
  join public.players p on p.id = h.player_id
  where h.host_user_id = auth.uid()
    and h.is_active = true
  order by h.created_at desc;
end;
$$;

grant execute on function public.list_host_player_profiles_for_self() to authenticated, service_role;
