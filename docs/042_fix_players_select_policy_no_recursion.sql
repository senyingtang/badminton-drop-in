-- 042: 修正 players_select RLS（避免 user_can_access_player 遞迴導致 PostgREST 500）
--
-- 症狀：
-- - 前端 /rest/v1/players?select=... 會回 500（Internal Server Error）
-- - 導致頁面「載入超久」或一直轉圈
--
-- 原因：
-- - players_select policy 使用 user_can_access_player(id)，而該函式內部又查詢 public.players，
--   造成 RLS 評估遞迴／堆疊溢位，PostgREST 回 500 且不一定帶 CORS header。
--
-- 解法：
-- - 改為非遞迴 policy：只使用 players 本身欄位或其他關聯表 exists 查詢。

drop policy if exists players_select on public.players;

create policy players_select
on public.players
for select
to authenticated
using (
  -- 本人
  auth_user_id = auth.uid()
  -- 平台管理員
  or public.is_platform_admin()
  -- 團主 / 場館擁有者（保守放行，避免既有後台功能被擋）
  or public.is_host()
  or public.is_venue_owner()
  -- 團主可讀自己名單上的球員（host_player_profiles）
  or exists (
    select 1
    from public.host_player_profiles hpp
    where hpp.player_id = players.id
      and hpp.host_user_id = auth.uid()
      and hpp.is_active = true
  )
  -- 主辦可讀自己場次參與者
  or exists (
    select 1
    from public.sessions s
    join public.session_participants sp on sp.session_id = s.id
    where s.host_user_id = auth.uid()
      and sp.player_id = players.id
      and sp.is_removed = false
  )
  -- 場館管理者可讀其場館場次的參與者
  or exists (
    select 1
    from public.venue_host_memberships vhm
    join public.sessions s on s.venue_id = vhm.venue_id
    join public.session_participants sp on sp.session_id = s.id
    where vhm.host_user_id = auth.uid()
      and vhm.is_active = true
      and sp.player_id = players.id
      and sp.is_removed = false
  )
);

