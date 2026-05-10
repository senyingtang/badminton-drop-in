-- 070_referral_signup_flow_diagnostics.sql
-- Read-only: referral signup flow + pending_referral_code in auth metadata.

-- 1) Recent referral profiles (30)
select * from public.member_referral_profiles order by created_at desc limit 30;

-- 2) Recent referral links (30)
select * from public.member_referral_links order by created_at desc limit 30;

-- 3) Recent auth.users: pending_referral_code in raw_user_meta_data
select
  id,
  email,
  created_at,
  raw_user_meta_data->>'pending_referral_code' as pending_referral_code,
  raw_user_meta_data->>'display_name' as display_name
from auth.users
order by created_at desc
limit 30;

-- 4) Recent app_user_profiles primary_role (30)
select id, display_name, primary_role, created_at
from public.app_user_profiles
order by created_at desc
limit 30;

-- 5) Recent user_role_memberships (30)
select id, user_id, role, is_active, created_at
from public.user_role_memberships
order by created_at desc
limit 30;

-- 6) Profiles without any referral link as referrer or referred (sample diagnostic)
select m.user_id, m.referral_code, m.created_at
from public.member_referral_profiles m
where not exists (
  select 1 from public.member_referral_links l
  where l.referrer_user_id = m.user_id or l.referred_user_id = m.user_id
)
order by m.created_at desc
limit 50;

-- 7) Duplicate referral_code
select referral_code, count(*) as cnt
from public.member_referral_profiles
group by referral_code
having count(*) > 1;

-- 8) Self-referral rows (should be empty)
select * from public.member_referral_links where referrer_user_id = referred_user_id;
