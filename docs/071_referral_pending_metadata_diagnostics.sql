-- 071_referral_pending_metadata_diagnostics.sql
-- Read-only: pending_referral_code in auth + referral tables.
-- Replace the email literal in all occurrences before running.

-- 1) auth.users for specified email (raw_user_meta_data)
-- ---------------------------------------------------------------------------
select
  au.id,
  au.email,
  au.raw_user_meta_data,
  au.raw_user_meta_data->>'pending_referral_code' as pending_referral_code,
  au.created_at
from auth.users au
where au.email = 'hiroshi01210322@gmail.com'
limit 1;

-- 2) member_referral_profiles for that user
-- ---------------------------------------------------------------------------
select m.*
from public.member_referral_profiles m
where m.user_id = (select id from auth.users where email = 'hiroshi01210322@gmail.com' limit 1);

-- 3) member_referral_links where that user is referrer or referred
-- ---------------------------------------------------------------------------
select l.*
from public.member_referral_links l
where l.referred_user_id = (select id from auth.users where email = 'hiroshi01210322@gmail.com' limit 1)
   or l.referrer_user_id = (select id from auth.users where email = 'hiroshi01210322@gmail.com' limit 1);

-- 4) Recent 20 auth.users with non-empty pending_referral_code
-- ---------------------------------------------------------------------------
select
  id,
  email,
  raw_user_meta_data->>'pending_referral_code' as pending_referral_code,
  created_at
from auth.users
where coalesce(trim(raw_user_meta_data->>'pending_referral_code'), '') <> ''
order by created_at desc
limit 20;

-- 5) Recent 20 member_referral_links
-- ---------------------------------------------------------------------------
select * from public.member_referral_links order by created_at desc limit 20;
