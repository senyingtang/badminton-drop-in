-- 093 / 00e：正式資料盤點與核對（唯讀，M3）。可在 Production 的 Supabase SQL Editor 執行。
--
-- * 整份只有「一個 SELECT」：不修改任何資料、權限或設定。SQL Editor 只顯示最後一個結果，所以合併成一張表。
-- * 只輸出數量、金額合計與內容指紋（md5），不輸出姓名、Email、電話、Token。
--   近期場次只列 id、開始時間、狀態、標題前 20 字與報名人數。
-- * 欄位：section | item | value
-- * 用途：
--   1. 任何正式 SQL（01d / 01 / 01b / 01c / 01e / 05）執行「前、後」各跑一次並匯出 CSV。
--      除了 Z 段的指紋（任何日常報名或修改都會改變），A–H 的數字在權限修補前後應該完全相同。
--   2. Vercel 與 Cloudflare 切換前後各跑一次，數字應一致（期間若有真實報名，差異應等於新增的筆數）。
-- * 表或欄位不存在時顯示 'n/a'，不會報錯。

with spec(ord, section, item, need_tbl, need_cols, q) as (
  values
  -- A. 專案識別
  (100, 'A project', 'database', null, null, 'select current_database() as v'),
  (101, 'A project', 'server_version', null, null, 'select current_setting(''server_version'') as v'),
  (102, 'A project', 'checked_at (UTC)', null, null, 'select to_char(now() at time zone ''utc'', ''YYYY-MM-DD HH24:MI:SS'') as v'),
  (103, 'A project', 'auth jwt issuer hint', null, null,
     'select coalesce(nullif(current_setting(''app.settings.jwt_issuer'', true), ''''), ''(以 Dashboard 專案網址確認 ref)'') as v'),

  -- B. 會員
  (200, 'B members', 'auth.users total', 'auth.users', null, 'select count(*) as v from auth.users'),
  (201, 'B members', 'app_user_profiles total', 'public.app_user_profiles', null, 'select count(*) as v from public.app_user_profiles'),
  (202, 'B members', 'profiles active (is_active=true, not deleted)', 'public.app_user_profiles', array['is_active'],
     'select count(*) as v from public.app_user_profiles p where coalesce(p.is_active, true) and not coalesce((to_jsonb(p) ->> ''is_deleted'')::boolean, false)'),
  (203, 'B members', 'profiles suspended (is_active=false)', 'public.app_user_profiles', array['is_active'],
     'select count(*) as v from public.app_user_profiles where is_active = false'),
  (204, 'B members', 'profiles deleted', 'public.app_user_profiles', array['is_deleted'],
     'select count(*) as v from public.app_user_profiles where is_deleted'),
  (205, 'B members', 'profiles by primary_role', 'public.app_user_profiles', null,
     'select string_agg(r || ''='' || n, '', '' order by r) as v from (select primary_role::text r, count(*) n from public.app_user_profiles group by 1) x'),
  (206, 'B members', 'players total', 'public.players', null, 'select count(*) as v from public.players'),
  (207, 'B members', 'players linked to an account', 'public.players', array['auth_user_id'],
     'select count(*) as v from public.players where auth_user_id is not null'),

  -- C. 場次
  (300, 'C sessions', 'sessions total', 'public.sessions', null, 'select count(*) as v from public.sessions'),
  (301, 'C sessions', 'sessions by status', 'public.sessions', null,
     'select string_agg(s || ''='' || n, '', '' order by s) as v from (select status::text s, count(*) n from public.sessions group by 1) x'),
  (302, 'C sessions', 'start_at range', 'public.sessions', array['start_at'],
     'select min(start_at)::text || '' → '' || max(start_at)::text as v from public.sessions'),
  (303, 'C sessions', 'past 30 days / next 30 days', 'public.sessions', array['start_at'],
     'select count(*) filter (where start_at >= now() - interval ''30 days'' and start_at < now()) || '' / '' || count(*) filter (where start_at >= now() and start_at < now() + interval ''30 days'') as v from public.sessions'),

  -- D. 報名 / 候補
  (400, 'D roster', 'session_participants total', 'public.session_participants', null, 'select count(*) as v from public.session_participants'),
  (401, 'D roster', 'by status (not removed)', 'public.session_participants', array['status', 'is_removed'],
     'select string_agg(s || ''='' || n, '', '' order by s) as v from (select status::text s, count(*) n from public.session_participants where not coalesce(is_removed, false) group by 1) x'),
  (402, 'D roster', 'removed', 'public.session_participants', array['is_removed'],
     'select count(*) as v from public.session_participants where is_removed'),
  (403, 'D roster', 'waitlist (status=waitlist, not removed)', 'public.session_participants', array['status', 'is_removed'],
     'select count(*) as v from public.session_participants where status::text = ''waitlist'' and not coalesce(is_removed, false)'),
  (404, 'D roster', 'session_waitlist_promotions', 'public.session_waitlist_promotions', null,
     'select count(*) as v from public.session_waitlist_promotions'),

  -- E. 排組 / 比分
  (500, 'E matches', 'rounds', 'public.rounds', null, 'select count(*) as v from public.rounds'),
  (501, 'E matches', 'rounds by status', 'public.rounds', array['status'],
     'select string_agg(s || ''='' || n, '', '' order by s) as v from (select status::text s, count(*) n from public.rounds group by 1) x'),
  (502, 'E matches', 'matches', 'public.matches', null, 'select count(*) as v from public.matches'),
  (503, 'E matches', 'matches with result (winning_team_no)', 'public.matches', array['winning_team_no'],
     'select count(*) as v from public.matches where winning_team_no is not null'),
  (504, 'E matches', 'match_teams / match_team_players', 'public.match_team_players', null,
     'select (select count(*) from public.match_teams) || '' / '' || (select count(*) from public.match_team_players) as v'),
  (505, 'E matches', 'match_score_submissions by status', 'public.match_score_submissions', array['status'],
     'select coalesce(string_agg(s || ''='' || n, '', '' order by s), ''0'') as v from (select status::text s, count(*) n from public.match_score_submissions group by 1) x'),
  (506, 'E matches', 'session_courts', 'public.session_courts', null, 'select count(*) as v from public.session_courts'),

  -- F. 錢包（kb_*，現行）與舊版 wallet_accounts
  (600, 'F wallet', 'kb_wallets count / sum(balance) / negative', 'public.kb_wallets', array['balance'],
     'select count(*) || '' / '' || coalesce(sum(balance), 0) || '' / '' || count(*) filter (where balance < 0) as v from public.kb_wallets'),
  (601, 'F wallet', 'kb_wallet_transactions count / sum(amount)', 'public.kb_wallet_transactions', array['amount'],
     'select count(*) || '' / '' || coalesce(sum(amount), 0) as v from public.kb_wallet_transactions'),
  (602, 'F wallet', 'kb_wallet_transactions by txn_type (count:sum)', 'public.kb_wallet_transactions', array['txn_type', 'amount'],
     'select string_agg(t || ''='' || n || '':'' || a, '', '' order by t) as v from (select txn_type::text t, count(*) n, sum(amount) a from public.kb_wallet_transactions group by 1) x'),
  (603, 'F wallet', 'wallet balance == last txn balance_after (mismatches)', 'public.kb_wallet_transactions', array['balance_after', 'wallet_id'],
     'select count(*) as v from public.kb_wallets w join lateral (select t.balance_after from public.kb_wallet_transactions t where t.wallet_id = w.id order by t.created_at desc, t.id desc limit 1) last on true where last.balance_after is distinct from w.balance'),
  (604, 'F wallet', 'legacy wallet_accounts count / sum(balance_amount)', 'public.wallet_accounts', array['balance_amount'],
     'select count(*) || '' / '' || coalesce(sum(balance_amount), 0) as v from public.wallet_accounts'),
  (605, 'F wallet', 'legacy wallet_transactions', 'public.wallet_transactions', null, 'select count(*) as v from public.wallet_transactions'),

  -- G. 營運報表
  (700, 'G reports', 'session_operation_reports (not deleted)', 'public.session_operation_reports', array['deleted_at'],
     'select count(*) as v from public.session_operation_reports where deleted_at is null'),
  (701, 'G reports', 'sum actual_fee / gross / net (cents, not deleted)', 'public.session_operation_reports', array['actual_fee_cents', 'gross_revenue_cents', 'net_revenue_cents', 'deleted_at'],
     'select coalesce(sum(actual_fee_cents), 0) || '' / '' || coalesce(sum(gross_revenue_cents), 0) || '' / '' || coalesce(sum(net_revenue_cents), 0) as v from public.session_operation_reports where deleted_at is null'),
  (702, 'G reports', 'sum shuttlecock_cost / venue_cost / other_expense (cents)', 'public.session_operation_reports', array['shuttlecock_cost_cents', 'venue_cost_cents', 'other_expense_cents', 'deleted_at'],
     'select coalesce(sum(shuttlecock_cost_cents), 0) || '' / '' || coalesce(sum(venue_cost_cents), 0) || '' / '' || coalesce(sum(other_expense_cents), 0) as v from public.session_operation_reports where deleted_at is null'),
  (703, 'G reports', 'host_operation_reports (legacy)', 'public.host_operation_reports', null, 'select count(*) as v from public.host_operation_reports'),
  (704, 'G reports', 'session_participants marked paid (045 paid_at)', 'public.session_participants', array['paid_at'],
     'select count(*) filter (where paid_at is not null) || '' paid / '' || count(*) || '' total'' as v from public.session_participants'),

  -- H. 付款 / 分潤（應維持停用：預期沒有新的 paid 訂單）
  (800, 'H payments', 'kb_payment_orders by status (count:sum cents)', 'public.kb_payment_orders', array['status', 'amount_cents'],
     'select coalesce(string_agg(s || ''='' || n || '':'' || a, '', '' order by s), ''0'') as v from (select status::text s, count(*) n, sum(amount_cents) a from public.kb_payment_orders group by 1) x'),
  (801, 'H payments', 'kb_payment_orders latest paid_at', 'public.kb_payment_orders', array['paid_at'],
     'select coalesce(max(paid_at)::text, ''none'') as v from public.kb_payment_orders'),
  (802, 'H payments', 'commission_events by status (count:sum cents)', 'public.commission_events', array['status', 'commission_amount_cents'],
     'select coalesce(string_agg(s || ''='' || n || '':'' || a, '', '' order by s), ''0'') as v from (select status::text s, count(*) n, sum(commission_amount_cents) a from public.commission_events group by 1) x'),
  (803, 'H payments', 'kb_subscriptions by status', 'public.kb_subscriptions', array['status'],
     'select coalesce(string_agg(s || ''='' || n, '', '' order by s), ''0'') as v from (select status::text s, count(*) n from public.kb_subscriptions group by 1) x'),

  -- Z. 內容指紋（md5；任何資料變動都會改變。權限 SQL 前後應相同，前提是期間沒有使用者操作）
  (900, 'Z fingerprint', 'sessions', 'public.sessions', null,
     'select count(*) || '' rows md5='' || md5(coalesce(string_agg(md5(t::text), '''' order by t.id::text), '''')) as v from public.sessions t'),
  (901, 'Z fingerprint', 'session_participants', 'public.session_participants', null,
     'select count(*) || '' rows md5='' || md5(coalesce(string_agg(md5(t::text), '''' order by t.id::text), '''')) as v from public.session_participants t'),
  (902, 'Z fingerprint', 'kb_wallets', 'public.kb_wallets', null,
     'select count(*) || '' rows md5='' || md5(coalesce(string_agg(md5(t::text), '''' order by t.id::text), '''')) as v from public.kb_wallets t'),
  (903, 'Z fingerprint', 'kb_wallet_transactions', 'public.kb_wallet_transactions', null,
     'select count(*) || '' rows md5='' || md5(coalesce(string_agg(md5(t::text), '''' order by t.id::text), '''')) as v from public.kb_wallet_transactions t'),
  (904, 'Z fingerprint', 'session_operation_reports', 'public.session_operation_reports', null,
     'select count(*) || '' rows md5='' || md5(coalesce(string_agg(md5(t::text), '''' order by t.id::text), '''')) as v from public.session_operation_reports t'),
  (905, 'Z fingerprint', 'matches', 'public.matches', null,
     'select count(*) || '' rows md5='' || md5(coalesce(string_agg(md5(t::text), '''' order by t.id::text), '''')) as v from public.matches t'),
  (906, 'Z fingerprint', 'app_user_profiles (id, role, active)', 'public.app_user_profiles', null,
     'select count(*) || '' rows md5='' || md5(coalesce(string_agg(md5(t.id::text || t.primary_role::text || coalesce((to_jsonb(t) ->> ''is_active''), '''')), '''' order by t.id::text), '''')) as v from public.app_user_profiles t')
),
evaluated as (
  select s.ord, s.section, s.item,
         case
           when s.need_tbl is not null and to_regclass(s.need_tbl) is null then 'n/a (table missing)'
           when s.need_cols is not null and exists (
             select 1 from unnest(s.need_cols) c
             where not exists (
               select 1 from information_schema.columns ic
               where ic.table_schema || '.' || ic.table_name = s.need_tbl and ic.column_name = c))
             then 'n/a (column missing)'
           else coalesce((xpath('/row/v/text()', query_to_xml(s.q, false, true, '')))[1]::text, 'null')
         end as value
  from spec s
),
recent as (
  -- C2. 近期場次（前後 14 天，最多 40 筆）：用來和 Vercel / Cloudflare 畫面逐筆比對
  select 1000 + row_number() over (order by s.start_at desc) as ord, 'C2 recent sessions' as section,
         s.id::text as item,
         format('%s | %s | %s | main=%s waitlist=%s',
                to_char(s.start_at at time zone 'Asia/Taipei', 'YYYY-MM-DD HH24:MI'), s.status,
                left(coalesce(s.title, ''), 20),
                (select count(*) from public.session_participants p where p.session_id = s.id and p.status::text = 'confirmed_main' and not coalesce(p.is_removed, false)),
                (select count(*) from public.session_participants p where p.session_id = s.id and p.status::text = 'waitlist' and not coalesce(p.is_removed, false))) as value
  from public.sessions s
  where s.start_at between now() - interval '14 days' and now() + interval '14 days'
  order by s.start_at desc
  limit 40
)
select section, item, value
from (select ord, section, item, value from evaluated union all select ord, section, item, value from recent) x
order by ord, item;
