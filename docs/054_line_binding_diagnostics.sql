-- 054_line_binding_diagnostics.sql
-- Diagnostics for member-dashboard LINE@ binding.

-- 1) line_oa_binding_codes exists?
select to_regclass('public.line_oa_binding_codes') as line_oa_binding_codes_table;

-- 2) Column list
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'line_oa_binding_codes'
order by ordinal_position;

-- 3) Recent 20 binding codes
select id, code, status, user_id, player_id, expires_at, used_at, line_oa_user_id, used_line_oa_user_id, created_at, updated_at
from public.line_oa_binding_codes
order by created_at desc
limit 20;

-- 4) LINE OA config (public link only)
select id, oa_add_friend_url
from public.platform_line_integration
where id = 1;

-- 5) players has line_oa_user_id?
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'players' and column_name = 'line_oa_user_id';

-- 6) app_user_profiles has line_oa_user_id?
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'app_user_profiles' and column_name = 'line_oa_user_id';

