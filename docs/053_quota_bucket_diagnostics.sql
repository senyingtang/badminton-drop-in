-- 053_quota_bucket_diagnostics.sql
-- Diagnose kb_quota_buckets shape and recent admin operations.

-- 1) Column list
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'kb_quota_buckets'
order by ordinal_position;

-- 2) Recent 20 quota buckets
select id, billing_account_id, user_id, bucket_type, quota_limit, quota_used, quota_total, status, source, period_start, period_end, valid_from, valid_to, created_at, updated_at
from public.kb_quota_buckets
order by created_at desc
limit 20;

-- 3) Active buckets right now
select id, billing_account_id, user_id, bucket_type, quota_limit, quota_used, quota_total, status, source, period_start, period_end, valid_from, valid_to
from public.kb_quota_buckets
where now() between valid_from and valid_to
order by valid_from desc
limit 20;

-- 4) Ensure period_start/period_end present
select
  count(*) filter (where period_start is null) as missing_period_start,
  count(*) filter (where period_end is null) as missing_period_end
from public.kb_quota_buckets;

-- 5) Recent admin audit logs
select *
from public.kb_admin_audit_logs
order by created_at desc
limit 20;

-- 6) Recent billing events
select *
from public.kb_billing_events
order by created_at desc
limit 20;

