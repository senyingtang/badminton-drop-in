-- 090_session_display_name_and_unpaid_diagnostics.sql
-- 排組顯示名稱、正選人數、已繳／未繳費診斷（read-only）
-- 依環境調整條件後執行。若欄位與下列查詢不符，請先跑「0) Schema introspection」對照實際欄位。

-- =============================================================================
-- 0) Schema introspection（建議先跑；Production / repo 以 information_schema 為準）
-- =============================================================================

-- 0a) public.session_participants 姓名／繳費相關欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'session_participants'
  and column_name in (
    'id',
    'session_id',
    'player_id',
    'status',
    'is_removed',
    'session_display_name',
    'guest_display_name',
    'guest_player_code',
    'paid_at',
    'is_guest_registration'
  )
order by ordinal_position;

-- 0b) public.players 顯示名稱欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'players'
  and column_name in ('id', 'display_name', 'player_code')
order by ordinal_position;

-- 0c) public.session_operation_reports 營運報表欄位（實際收費人數）
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'session_operation_reports'
  and column_name in ('session_id', 'actual_paid_players', 'deleted_at')
order by ordinal_position;

-- =============================================================================
-- 1) session_participants 姓名相關欄位抽樣（最近 50 筆）
-- =============================================================================
select
  sp.id,
  sp.session_id,
  sp.player_id,
  sp.status,
  sp.is_removed,
  sp.session_display_name,
  sp.guest_display_name,
  sp.guest_player_code,
  sp.is_guest_registration,
  sp.paid_at,
  p.display_name as players_display_name
from public.session_participants sp
join public.players p on p.id = sp.player_id
where sp.is_removed = false
order by sp.created_at desc
limit 50;

-- =============================================================================
-- 2) 指定場次排組顯示名稱來源（將 :session_id 換成 uuid）
-- 優先序對齊 web getSessionParticipantDisplayName
-- =============================================================================
-- select
--   sp.id as participant_id,
--   sp.session_display_name,
--   sp.guest_display_name,
--   p.display_name as players_display_name,
--   sp.guest_player_code,
--   coalesce(
--     nullif(trim(sp.session_display_name), ''),
--     nullif(trim(sp.guest_display_name), ''),
--     nullif(trim(p.display_name), ''),
--     nullif(trim(sp.guest_player_code), ''),
--     left(sp.id::text, 8)
--   ) as final_display_name,
--   case
--     when nullif(trim(sp.session_display_name), '') is not null then 'session_display_name'
--     when nullif(trim(sp.guest_display_name), '') is not null then 'guest_display_name'
--     when nullif(trim(p.display_name), '') is not null then 'players.display_name'
--     when nullif(trim(sp.guest_player_code), '') is not null then 'guest_player_code'
--     else 'participant_id_short'
--   end as name_source
-- from public.session_participants sp
-- join public.players p on p.id = sp.player_id
-- where sp.session_id = :session_id
--   and sp.is_removed = false
-- order by sp.priority_order nulls last, sp.created_at asc;

-- =============================================================================
-- 3) 指定場次正選人數（confirmed_main count）
-- =============================================================================
-- select
--   sp.session_id,
--   count(*) as confirmed_main_count
-- from public.session_participants sp
-- where sp.session_id = :session_id
--   and sp.is_removed = false
--   and sp.status = 'confirmed_main'
-- group by sp.session_id;

-- =============================================================================
-- 4) 指定場次已繳費人數（confirmed_main + paid_at not null）
-- =============================================================================
-- select
--   sp.session_id,
--   count(*) filter (where sp.status = 'confirmed_main') as confirmed_main_count,
--   count(*) filter (where sp.status = 'confirmed_main' and sp.paid_at is not null) as confirmed_main_paid_count
-- from public.session_participants sp
-- where sp.session_id = :session_id
--   and sp.is_removed = false
-- group by sp.session_id;

-- =============================================================================
-- 5) 指定場次未繳費正選名單
-- =============================================================================
-- select
--   sp.id as participant_id,
--   coalesce(
--     nullif(trim(sp.session_display_name), ''),
--     nullif(trim(sp.guest_display_name), ''),
--     nullif(trim(p.display_name), ''),
--     nullif(trim(sp.guest_player_code), ''),
--     left(sp.id::text, 8)
--   ) as display_name,
--   sp.paid_at,
--   case when sp.paid_at is null then 'unpaid' else 'paid' end as payment_status
-- from public.session_participants sp
-- join public.players p on p.id = sp.player_id
-- where sp.session_id = :session_id
--   and sp.is_removed = false
--   and sp.status = 'confirmed_main'
--   and sp.paid_at is null
-- order by sp.priority_order nulls last, sp.created_at asc;

-- =============================================================================
-- 6) 最近 20 場未結束場次的未繳費統計
-- =============================================================================
select
  s.id as session_id,
  s.title,
  s.status,
  s.start_at,
  count(*) filter (where sp.status = 'confirmed_main') as confirmed_main_count,
  count(*) filter (where sp.status = 'confirmed_main' and sp.paid_at is null) as unpaid_confirmed_main_count
from public.sessions s
left join public.session_participants sp
  on sp.session_id = s.id
 and sp.is_removed = false
where s.status <> 'session_finished'
  and s.status <> 'cancelled'
group by s.id, s.title, s.status, s.start_at
order by s.start_at desc nulls last
limit 20;
