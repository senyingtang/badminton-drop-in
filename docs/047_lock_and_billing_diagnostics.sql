-- 047_lock_and_billing_diagnostics.sql
-- 用途：在 Supabase SQL Editor 快速診斷「首次開打扣款 / quota / wallet」狀態與 idempotency。

-- 1) 檢查指定 session 的 billing 狀態（換成你的 session_id）
-- select
--   id,
--   host_user_id,
--   status,
--   billing_account_id,
--   billing_status,
--   first_started_at,
--   quota_consumed_at,
--   quota_ledger_id,
--   overage_charge_id
-- from public.sessions
-- where id = '<session_id>';

-- 2) 檢查是否已寫入 quota ledger / usage event（同一 session 不應重複）
-- select *
-- from public.kb_quota_ledger
-- where session_id = '<session_id>'
-- order by created_at desc;

-- select *
-- from public.kb_usage_events
-- where session_id = '<session_id>'
-- order by occurred_at desc;

-- 3) 檢查 quota bucket（看 quota_used 是否只加 1）
-- select
--   qb.id,
--   qb.billing_account_id,
--   qb.user_id,
--   qb.bucket_type,
--   qb.quota_limit,
--   qb.quota_used,
--   qb.valid_from,
--   qb.valid_to
-- from public.kb_quota_buckets qb
-- where qb.billing_account_id = (select billing_account_id from public.sessions where id = '<session_id>')
-- order by qb.valid_from desc;

-- 4) 檢查 overage 是否真的只產生一筆 charge + 一筆 wallet txn
-- select *
-- from public.kb_billing_charges
-- where reference_type = 'session'
--   and reference_id = '<session_id>'
-- order by created_at desc;

-- select wt.*
-- from public.kb_wallet_transactions wt
-- join public.kb_wallets w on w.id = wt.wallet_id
-- where w.billing_account_id = (select billing_account_id from public.sessions where id = '<session_id>')
-- order by wt.created_at desc;

-- 5) 檢查 round lock idempotency（同一 round 重複 lock，不應重複增加統計）
-- select id, session_id, round_no, court_no, status, locked_at, locked_by_user_id
-- from public.rounds
-- where session_id = '<session_id>'
-- order by court_no asc, round_no asc;

-- -- 找出某 round 的參賽者，並核對 total_matches_played / consecutive_rounds_played
-- select
--   sp.id as participant_id,
--   sp.player_id,
--   sp.status,
--   sp.total_matches_played,
--   sp.consecutive_rounds_played,
--   sp.is_locked_for_current_round
-- from public.session_participants sp
-- where sp.session_id = '<session_id>'
-- order by sp.created_at asc;

