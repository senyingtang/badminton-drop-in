-- 093 / 97：正式 SQL 修補「目前狀態」總表（唯讀，可重複執行）
-- 每一階段「套用前、套用後、回滾後」各跑一次，比對 applied 欄位是否如預期翻轉，
-- 以及第二段的資料筆數是否不變（只允許正常營運造成的增加）。
-- 不輸出任何個資、Email、token。

-- 1) 每個修補是否已套用（true = 已套用）
select '01d 會員不可自行提升角色' as patch,
       exists (select 1 from pg_trigger where tgrelid = 'public.app_user_profiles'::regclass
               and tgname = 'trg_kb092_guard_profile_privileged_columns' and tgenabled = 'O') as applied
union all
select '01  收回錢包 RPC／帳務表寫入 + 不扣費開放報名',
       to_regprocedure('public.kb_open_registration_no_charge(uuid)') is not null
       and not coalesce((select bool_or(has_function_privilege('authenticated', p.oid, 'execute'))
                         from pg_proc p where p.pronamespace = 'public'::regnamespace
                           and p.proname in ('kb_wallet_debit_cents', 'kb_wallet_debit', 'kb_user_self_wallet_topup')), false)
       and not has_table_privilege('authenticated', 'public.kb_wallets', 'UPDATE')
union all
select '01b 帳務表讀取範圍（RLS + kb092 policy）',
       (select relrowsecurity from pg_class where oid = 'public.kb_wallets'::regclass)
       and (select count(*) from pg_policies where schemaname = 'public' and policyname like 'kb092\_%\_select' escape '\') >= 10
union all
select '01c 配額總覽越權修正',
       to_regprocedure('public.kb_get_quota_dashboard_unchecked(uuid)') is not null
union all
select '01e 停權參與授權（角色函式 + 報名 trigger）',
       exists (select 1 from pg_trigger where tgrelid = 'public.session_participants'::regclass
               and tgname = 'trg_kb092_guard_suspended_signup')
       and (select prosrc ~ 'is_active' from pg_proc where oid = 'public.is_host()'::regprocedure)
union all
select '02  收回舊版扣費開放報名（切換後才可套用）',
       not coalesce((select bool_or(has_function_privilege('authenticated', p.oid, 'execute'))
                     from pg_proc p where p.pronamespace = 'public'::regnamespace
                       and p.proname = 'kb_open_registration_with_billing'), false)
union all
select '05  007 測試帳號已停用（無此帳號時為 false，屬正常）',
       exists (select 1 from public.kb_audit_logs where action_type = 'm3_disable_007_test_account')
       and not exists (select 1 from public.kb_audit_logs where action_type = 'm3_rollback_disable_007_test_account'
                       and created_at > (select max(created_at) from public.kb_audit_logs where action_type = 'm3_disable_007_test_account'))
union all
select '094 遞補 trigger 欄位修正',
       not exists (select 1 from pg_proc where proname = 'trg_notify_waitlist_promotion' and prosrc ~* 'select\s+user_id');

-- 2) 資料筆數（與 00e 基準比對：206 Auth / 50 場次 / 595 報名 / 276 比賽 / 53 錢包交易 / 27 營運報表）
--    修補只改權限與函式，不改資料：每一階段前後這些數字只能「不變或因正常營運增加」，錢包合計不可改變。
select (select count(*) from auth.users)                                             as auth_users,
       (select count(*) from public.app_user_profiles)                               as profiles,
       (select count(*) from public.players where line_user_id is not null)          as players_with_line,
       (select count(*) from public.sessions)                                        as sessions,
       (select count(*) from public.sessions where status = 'registration_open')     as open_sessions,
       (select count(*) from public.session_participants)                            as registrations,
       (select count(*) from public.session_participants where status = 'waitlist')  as waitlist,
       (select count(*) from public.session_waitlist_promotions)                     as waitlist_promotions,
       (select count(*) from public.rounds)                                          as rounds,
       (select count(*) from public.matches)                                         as matches,
       (select count(*) from public.match_score_submissions)                         as score_submissions,
       (select count(*) from public.kb_wallet_transactions)                          as wallet_txns,
       (select coalesce(sum(balance_cents), 0) from public.kb_wallets)               as wallet_balance_cents_sum,
       (select count(*) from public.session_operation_reports where deleted_at is null) as operation_reports,
       (select count(*) from auth.users where banned_until = 'infinity')             as infinity_bans_must_be_0;

-- 3) LINE 身分對應（新版 LINE callback 先以 players.line_user_id 找人；舊版每次 LINE 登入都會寫入此綁定）
--    line_meta_unbound > 0 不代表會失敗：新版會再以 email + user_metadata.line_sub 找回同一個帳號，並補上綁定。
select (select count(*) from auth.users where raw_user_meta_data ? 'line_sub')            as line_created_users,
       (select count(*) from auth.users u where u.raw_user_meta_data ? 'line_sub'
          and not exists (select 1 from public.players p
                          where p.line_user_id = u.raw_user_meta_data ->> 'line_sub'))  as line_meta_unbound,
       (select count(*) from (select line_user_id from public.players where line_user_id is not null
                              group by line_user_id having count(*) > 1) d)              as duplicate_line_bindings_must_be_0;
