-- 092 / 00d：身分與權限唯讀診斷（M1.5）。可在 Production 的 Supabase SQL Editor 執行。
--
-- * 整份只有「一個 SELECT」：不修改任何資料、權限或設定；SQL Editor 只會顯示最後一個結果，所以合併成一張表。
-- * 不輸出 Token / Secret / Cookie / 電話；名稱與 Email 皆遮罩（首字 + ***）。
--   LINE / 金流設定只輸出「是否有值」與最後更新時間。
-- * 執行前可把下方 expected_admin_email 改成你預期的平台管理員 Email（只用來比對，結果仍遮罩）；留空也可以。
-- * 欄位：section | item | status | detail
--   status：RISK = 需要處理、REVIEW = 需人工確認、OK、INFO。請把整張結果匯出 CSV 存檔（核准紀錄用）。
--
-- 需要的物件：app_user_profiles、user_role_memberships、kb_audit_logs、auth.users（001 / 002 / 007 皆有）。
-- 其他（081 欄位、platform_line_integration、kb_payment_provider_configs）不存在時會自動略過。

with params as (
  select lower(trim('')) as expected_admin_email   -- ← 可填入，例如 'owner@example.com'
),
prof as (
  select p.id, to_jsonb(p) as j from public.app_user_profiles p
),
guard as (
  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.app_user_profiles'::regclass
      and tgname = 'trg_kb092_guard_profile_privileged_columns' and tgenabled <> 'D'
  ) as present
),
tbl as (
  select t, to_regclass('public.' || t) as oid
  from unnest(array['app_user_profiles', 'user_role_memberships', 'platform_line_integration',
                    'kb_payment_provider_configs', 'kb_audit_logs', 'kb_organization_members',
                    'venue_host_memberships']) t
),
audit as (
  select a.target_entity_id, a.actor_user_id, a.action_type, a.created_at from public.kb_audit_logs a
),
rows as (

  -- A. 實際 Schema
  select 'A schema' as section, c.table_name || '.' || c.column_name as item, 'INFO' as status,
         format('%s default=%s nullable=%s', c.data_type, coalesce(c.column_default, '-'), c.is_nullable) as detail
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name in ('app_user_profiles', 'user_role_memberships')
  union all
  select 'A schema', 'enum app_role', 'INFO', string_agg(e.enumlabel, ', ' order by e.enumsortorder)
  from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'app_role'

  -- B. RLS
  union all
  select 'B rls', tbl.t, case when c.relrowsecurity then 'OK' else 'RISK' end,
         format('rls=%s force=%s', c.relrowsecurity, c.relforcerowsecurity)
  from tbl join pg_class c on c.oid = tbl.oid

  -- C. Policies（app_user_profiles 自己可 INSERT/UPDATE 而且沒有 01d → RISK）
  union all
  select 'C policy', pol.tablename || ' / ' || pol.policyname,
         case when pol.tablename = 'app_user_profiles' and pol.cmd in ('UPDATE', 'INSERT', 'ALL')
                   and coalesce(pol.qual, '') || coalesce(pol.with_check, '') ~ 'auth\.uid\(\)'
                   and not (select present from guard) then 'RISK'
              when pol.tablename = 'user_role_memberships' and pol.cmd in ('UPDATE', 'INSERT', 'ALL')
                   and coalesce(pol.with_check, pol.qual, '') !~ 'player' and coalesce(pol.with_check, pol.qual, '') ~ 'auth\.uid\(\)' then 'RISK'
              else 'INFO' end,
         format('%s roles=%s permissive=%s using=%s check=%s', pol.cmd, array_to_string(pol.roles, ','),
                pol.permissive, coalesce(pol.qual, '-'), coalesce(pol.with_check, '-'))
  from pg_policies pol
  where pol.schemaname = 'public' and pol.tablename in (select t from tbl)

  -- D. GRANT（資料表層級；public = PUBLIC 偽角色）
  union all
  select 'D grant', tbl.t || ' → ' || r.r,
         case when tbl.t in ('app_user_profiles', 'user_role_memberships') and r.r in ('anon', 'public')
                   and (has_table_privilege(r.r, tbl.oid, 'INSERT') or has_table_privilege(r.r, tbl.oid, 'UPDATE')
                        or has_table_privilege(r.r, tbl.oid, 'DELETE')) then 'REVIEW'
              when tbl.t = 'app_user_profiles' and r.r = 'authenticated' and has_table_privilege(r.r, tbl.oid, 'UPDATE')
                   then case when (select present from guard) then 'OK' else 'RISK' end
              else 'INFO' end,
         concat_ws(',',
           case when has_table_privilege(r.r, tbl.oid, 'SELECT') then 'SELECT' end,
           case when has_table_privilege(r.r, tbl.oid, 'INSERT') then 'INSERT' end,
           case when has_table_privilege(r.r, tbl.oid, 'UPDATE') then 'UPDATE' end,
           case when has_table_privilege(r.r, tbl.oid, 'DELETE') then 'DELETE' end,
           case when has_table_privilege(r.r, tbl.oid, 'TRUNCATE') then 'TRUNCATE' end)
  from tbl cross join unnest(array['anon', 'authenticated', 'public']) r(r)
  where tbl.oid is not null

  -- E. Trigger（01d 是否已套用）
  union all
  select 'E trigger', '01d guard trigger present', case when (select present from guard) then 'OK' else 'RISK' end,
         case when (select present from guard) then 'trg_kb092_guard_profile_privileged_columns enabled'
              else '尚未套用 01d：任何登入者可自行改 primary_role / is_active' end
  union all
  select 'E trigger', tg.tgname, 'INFO', format('enabled=%s %s', tg.tgenabled, pg_get_triggerdef(tg.oid))
  from pg_trigger tg where tg.tgrelid = 'public.app_user_profiles'::regclass and not tg.tgisinternal

  -- F. 身分判斷函式（SECURITY DEFINER、search_path、是否檢查 is_active）
  union all
  select 'F role helper', p.oid::regprocedure::text,
         case when p.proname = 'is_platform_admin' and pg_get_functiondef(p.oid) !~* 'is_active' then 'REVIEW' else 'INFO' end,
         format('definer=%s owner=%s config=%s anon_exec=%s auth_exec=%s checks_is_active=%s',
                p.prosecdef, pg_get_userbyid(p.proowner), coalesce(array_to_string(p.proconfig, ';'), '-'),
                has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'),
                pg_get_functiondef(p.oid) ~* 'is_active')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and p.proname in ('is_platform_admin', 'current_app_role', 'is_host', 'is_venue_owner',
                      'kb092_caller_is_active_platform_admin', 'kb092_guard_profile_privileged_columns')

  -- G. 其他可以改身分的路徑：SECURITY DEFINER 函式內有寫入 app_user_profiles / user_role_memberships
  union all
  select 'G definer writes identity', p.oid::regprocedure::text,
         case when (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
                   and pg_get_functiondef(p.oid) ~* '(primary_role|is_active|is_deleted|role\s*=|role\s*\))' then 'REVIEW' else 'INFO' end,
         format('owner=%s anon_exec=%s auth_exec=%s', pg_get_userbyid(p.proowner),
                has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p') and p.prosecdef
    and pg_get_functiondef(p.oid) ~* '(update|insert\s+into|delete\s+from)\s+(public\.)?(app_user_profiles|user_role_memberships)'

  -- H. 角色屬性（01d 依賴 postgres / service_role 具 bypassrls；anon / authenticated 不得有）
  union all
  select 'H role', r.rolname,
         case when r.rolname in ('anon', 'authenticated') and (r.rolsuper or r.rolbypassrls) then 'RISK'
              when r.rolname in ('postgres', 'service_role') and not (r.rolsuper or r.rolbypassrls) then 'REVIEW'
              else 'INFO' end,
         format('super=%s bypassrls=%s login=%s member_of=%s', r.rolsuper, r.rolbypassrls, r.rolcanlogin,
                coalesce((select string_agg(g.rolname, ',') from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid), '-'))
  from pg_roles r
  where r.rolname in ('postgres', 'service_role', 'authenticated', 'anon', 'authenticator')
     or (r.oid >= 16384 and r.rolname !~ '^(pg_|supabase|pgsodium|pgbouncer|dashboard_user|cli_login)')

  -- I. public schema 是否允許一般角色 CREATE（search_path 劫持風險）
  union all
  select 'I schema', 'CREATE on schema public → ' || r, case when has_schema_privilege(r, 'public', 'CREATE') then 'REVIEW' else 'OK' end, ''
  from unnest(array['anon', 'authenticated', 'public']) r

  -- J. 平台管理員帳號（遮罩）
  union all
  select 'J admin account', prof.id::text,
         case when (prof.j ->> 'is_deleted')::boolean then 'RISK'
              when prm.expected_admin_email <> '' and lower(u.email) = prm.expected_admin_email then 'OK'
              else 'REVIEW' end,
         jsonb_build_object(
           'name', left(coalesce(prof.j ->> 'display_name', ''), 1) || '***',
           'email', case when u.email is null then null else left(u.email, 1) || '***@' || split_part(u.email, '@', 2) end,
           'matches_expected', case when prm.expected_admin_email = '' then null else lower(u.email) = prm.expected_admin_email end,
           'provider', u.raw_app_meta_data ->> 'provider',
           'is_active', prof.j -> 'is_active', 'is_deleted', prof.j -> 'is_deleted',
           'profile_created', prof.j ->> 'created_at', 'profile_updated', prof.j ->> 'updated_at',
           'auth_created', u.created_at, 'last_sign_in', u.last_sign_in_at, 'banned_until', u.banned_until,
           'has_admin_membership', exists (select 1 from public.user_role_memberships m where m.user_id = prof.id and m.role::text = 'platform_admin'),
           'audit_role_events_on_me', (select count(*) from audit a where a.target_entity_id = prof.id and a.action_type ilike '%role%'),
           'admin_actions_90d', (select count(*) from audit a where a.actor_user_id = prof.id and a.created_at > now() - interval '90 days')
         )::text
  from prof cross join params prm left join auth.users u on u.id = prof.id
  where prof.j ->> 'primary_role' = 'platform_admin'

  -- K. 角色分佈
  union all
  select 'K distribution', format('%s active=%s deleted=%s', prof.j ->> 'primary_role', coalesce(prof.j ->> 'is_active', '?'), coalesce(prof.j ->> 'is_deleted', 'n/a')),
         'INFO', count(*)::text
  from prof group by 2

  -- L. 異常
  union all  -- L1 被停權（最後一筆是 disable）但現在是啟用：可能自行解除停權
  select 'L1 disabled→active without restore', prof.id::text, 'RISK', 'last audit=' || last.action_type || ' at ' || last.created_at
  from prof
  join lateral (select a.action_type, a.created_at from audit a
                where a.target_entity_id = prof.id
                  and (a.action_type ilike '%disable%' or a.action_type ilike '%restore%' or a.action_type ilike '%ban%' or a.action_type ilike '%active%')
                order by a.created_at desc limit 1) last on true
  where coalesce((prof.j ->> 'is_active')::boolean, true) and last.action_type ilike '%disable%'
  union all  -- L2 曾匿名化 / 刪除但現在 is_deleted = false
  select 'L2 anonymized but not deleted', prof.id::text, 'RISK', 'is_deleted=' || coalesce(prof.j ->> 'is_deleted', 'n/a')
  from prof
  where exists (select 1 from audit a where a.target_entity_id = prof.id and a.action_type = 'member_account_anonymize')
    and not coalesce((prof.j ->> 'is_deleted')::boolean, false)
  union all  -- L3 已刪除卻仍啟用
  select 'L3 deleted but active', prof.id::text, 'RISK', ''
  from prof where coalesce((prof.j ->> 'is_deleted')::boolean, false) and coalesce((prof.j ->> 'is_active')::boolean, true)
  union all  -- L4 管理類角色沒有對應的 membership（管理頁直接改角色也會這樣，需人工判斷）
  select 'L4 role without membership', prof.id::text, 'REVIEW', prof.j ->> 'primary_role'
  from prof
  where prof.j ->> 'primary_role' in ('platform_admin', 'venue_owner', 'host')
    and not exists (select 1 from public.user_role_memberships m where m.user_id = prof.id and m.role::text = prof.j ->> 'primary_role' and m.is_active)
  union all  -- L5 管理類角色，profile 建立後被改過，且沒有任何角色稽核紀錄
  select 'L5 privileged, edited, no role audit', prof.id::text, 'REVIEW',
         format('%s created=%s updated=%s', prof.j ->> 'primary_role', prof.j ->> 'created_at', prof.j ->> 'updated_at')
  from prof
  where prof.j ->> 'primary_role' in ('platform_admin', 'venue_owner', 'host')
    and (prof.j ->> 'updated_at')::timestamptz > (prof.j ->> 'created_at')::timestamptz + interval '1 minute'
    and not exists (select 1 from audit a where a.target_entity_id = prof.id and a.action_type ilike '%role%')
  union all  -- L7 007_test_accounts_and_venue.sql 的測試帳號（固定密碼 password123）不應存在於正式站
  select 'L7 known test account', prof.id::text,
         case when prof.j ->> 'primary_role' in ('platform_admin', 'venue_owner', 'host') then 'RISK' else 'REVIEW' end,
         format('%s email=%s***@%s banned_until=%s', prof.j ->> 'primary_role', left(u.email, 1), split_part(u.email, '@', 2), u.banned_until)
  from prof join auth.users u on u.id = prof.id
  where lower(split_part(u.email, '@', 2)) in ('example.com', 'example.test', 'test.com')
  union all  -- L6 機密設定：只輸出有無值與最後更新時間（若有不明管理員，這些需輪替）
  select 'L6 secrets (presence only)', 'platform_line_integration', 'INFO',
         case when to_regclass('public.platform_line_integration') is null then 'table not found'
              else query_to_xml($q$select count(*) as rows, max(to_jsonb(t) ->> 'updated_at') as last_updated,
                     bool_or(coalesce(to_jsonb(t) ->> 'messaging_channel_access_token', '') <> '') as has_messaging_token,
                     bool_or(coalesce(to_jsonb(t) ->> 'login_channel_secret', '') <> '') as has_login_secret
                     from public.platform_line_integration t$q$, false, true, '')::text end
  union all
  select 'L6 secrets (presence only)', 'kb_payment_provider_configs', 'INFO',
         case when to_regclass('public.kb_payment_provider_configs') is null then 'table not found'
              else query_to_xml($q$select count(*) as rows, max(to_jsonb(t) ->> 'updated_at') as last_updated,
                     bool_or(coalesce(to_jsonb(t) ->> 'hash_key_encrypted', '') <> '') as has_hash_key
                     from public.kb_payment_provider_configs t$q$, false, true, '')::text end

  -- M. 092 各檔是否已套用
  union all
  select 'M applied', f, case when to_regprocedure(f) is not null then 'INFO applied' else 'INFO not applied' end, ''
  from unnest(array['public.kb_open_registration_no_charge(uuid)', 'public.kb_get_quota_dashboard_unchecked(uuid)',
                    'public.kb092_caller_is_active_platform_admin()',
                    'public.kb_payment_order_mark_paid(text,bigint,text,jsonb)']) f
)
select section, item, status, detail
from rows
order by section,
         case split_part(status, ' ', 1) when 'RISK' then 0 when 'REVIEW' then 1 when 'OK' then 2 else 3 end,
         item;
