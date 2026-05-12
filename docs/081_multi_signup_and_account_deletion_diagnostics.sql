-- 081 diagnostics：多人代報名欄位、公開名單 RPC、會員軟刪除、Auth / LINE 綁定
-- 僅查詢與驗證，不修改資料。

-- 1) session_participants 新欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'session_participants'
  and column_name in (
    'registered_by_user_id',
    'notification_user_id',
    'is_guest_registration',
    'guest_display_name',
    'guest_level',
    'guest_player_code',
    'registration_group_id'
  )
order by column_name;

-- 2) app_user_profiles 軟刪除欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'app_user_profiles'
  and column_name in (
    'is_deleted',
    'deleted_at',
    'account_deleted_at',
    'deleted_display_name_snapshot',
    'anonymized_at',
    'avatar_url'
  )
order by column_name;

-- 3) app_user_profiles 是否仍指向 auth.users（若有 FK，刪 auth 可能 cascade）
select
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
  and ccu.table_schema = tc.table_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
  and rc.constraint_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.table_name = 'app_user_profiles'
  and tc.constraint_type = 'FOREIGN KEY'
  and kcu.column_name = 'id';

-- 4) 代報名筆數（最近）
select
  count(*) filter (where is_guest_registration) as guest_participant_rows,
  count(*) as total_recent
from public.session_participants
where created_at > now() - interval '30 days';

-- 5) registered_by / notification 可 join profile
select sp.id, sp.registered_by_user_id, sp.notification_user_id, p.display_name as registrar_profile_name, p.is_deleted
from public.session_participants sp
left join public.app_user_profiles p on p.id = sp.registered_by_user_id
where sp.is_guest_registration = true
order by sp.created_at desc
limit 20;

-- 6) 已標記刪除的會員
select id, display_name, is_deleted, deleted_at, account_deleted_at, anonymized_at
from public.app_user_profiles
where coalesce(is_deleted, false) = true
order by account_deleted_at desc nulls last
limit 30;

-- 7) 已刪除會員仍被歷史表 join（範例：場次主辦）
select s.id as session_id, s.title, s.host_user_id, p.display_name, p.is_deleted
from public.sessions s
left join public.app_user_profiles p on p.id = s.host_user_id
where s.created_at > now() - interval '90 days'
  and coalesce(p.is_deleted, false) = true
limit 20;

-- 8) audit：會員刪除相關（kb_audit_logs）
select id, action_type, target_entity_type, target_entity_id, created_at
from public.kb_audit_logs
where action_type like 'member_account_%'
order by created_at desc
limit 30;

-- 9) 公開名單 RPC 簽名
select p.oid::regprocedure as signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'get_public_session_roster_by_share_code';

-- 10) LINE：來賓 player 應無綁定；代報者 players
select p.id, p.auth_user_id is null as is_guest_player, p.line_oa_user_id is null as no_oa, p.line_user_id is null as no_line_login
from public.players p
join public.session_participants sp on sp.player_id = p.id
where sp.is_guest_registration = true
order by sp.created_at desc
limit 15;
