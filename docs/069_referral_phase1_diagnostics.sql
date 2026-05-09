-- 069_referral_phase1_diagnostics.sql
-- Phase 1 referral: read-only diagnostics (SELECT / information_schema / pg_policies).

-- 1) member_referral_profiles columns
select table_schema, table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'member_referral_profiles'
order by ordinal_position;

-- 2) member_referral_links columns
select table_schema, table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'member_referral_links'
order by ordinal_position;

-- 3) Recent referral profiles (30)
select * from public.member_referral_profiles order by created_at desc limit 30;

-- 4) Recent referral links (30)
select * from public.member_referral_links order by created_at desc limit 30;

-- 5) Users without referral profile (auth.users exists, no row in member_referral_profiles)
select au.id as user_id, au.email, au.created_at as auth_created_at
from auth.users au
left join public.member_referral_profiles m on m.user_id = au.id
where m.id is null
order by au.created_at desc
limit 50;

-- 6) Duplicate referral_code
select referral_code, count(*) as cnt
from public.member_referral_profiles
group by referral_code
having count(*) > 1;

-- 7) Duplicate referred_user_id
select referred_user_id, count(*) as cnt
from public.member_referral_links
group by referred_user_id
having count(*) > 1;

-- 8) Self-referral rows (should be empty)
select * from public.member_referral_links where referrer_user_id = referred_user_id;

-- 9) app_user_profiles primary_role distribution
select primary_role, count(*) as cnt
from public.app_user_profiles
group by primary_role
order by cnt desc;

-- 10) user_role_memberships role distribution
select role, count(*) as cnt
from public.user_role_memberships
where coalesce(is_active, true)
group by role
order by cnt desc;

-- 11) Recent app_user_profiles (30)
select * from public.app_user_profiles order by created_at desc limit 30;

-- 12) Recent user_role_memberships (30)
select * from public.user_role_memberships order by created_at desc limit 30;

-- 13) RLS policies
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'member_referral_profiles',
    'member_referral_links',
    'app_user_profiles',
    'user_role_memberships'
  )
order by tablename, policyname;
