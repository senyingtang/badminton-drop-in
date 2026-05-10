-- 072_user_role_membership_player_sync_diagnostics.sql
-- Read-only: profile primary_role vs player membership.
-- Replace email literals before running.

-- 1) app_user_profiles.primary_role for specified email
-- ---------------------------------------------------------------------------
select aup.id, aup.display_name, aup.primary_role, aup.created_at
from public.app_user_profiles aup
join auth.users au on au.id = aup.id
where au.email = 'eric25035200724@gmail.com'
limit 1;

-- 2) user_role_memberships for specified email
-- ---------------------------------------------------------------------------
select urm.*
from public.user_role_memberships urm
join auth.users au on au.id = urm.user_id
where au.email = 'eric25035200724@gmail.com'
order by urm.created_at;

-- 3) primary_role = player but zero membership rows
-- ---------------------------------------------------------------------------
select aup.id, aup.display_name, au.email, aup.primary_role
from public.app_user_profiles aup
join auth.users au on au.id = aup.id
where aup.primary_role = 'player'
  and not exists (
    select 1 from public.user_role_memberships urm where urm.user_id = aup.id
  )
order by aup.created_at desc
limit 50;

-- 4) primary_role = player but no player membership (may still have host etc.)
-- ---------------------------------------------------------------------------
select aup.id, aup.display_name, au.email, aup.primary_role
from public.app_user_profiles aup
join auth.users au on au.id = aup.id
where aup.primary_role = 'player'
  and not exists (
    select 1
    from public.user_role_memberships urm
    where urm.user_id = aup.id and urm.role = 'player'
  )
order by aup.created_at desc
limit 50;

-- 5) Recent 30 users: profile + aggregated memberships
-- ---------------------------------------------------------------------------
select
  au.email,
  aup.primary_role,
  aup.created_at as profile_created_at,
  coalesce(
    (select string_agg(urm.role::text, ', ' order by urm.role)
     from public.user_role_memberships urm
     where urm.user_id = aup.id and coalesce(urm.is_active, true)),
    '(none)'
  ) as membership_roles
from public.app_user_profiles aup
join auth.users au on au.id = aup.id
order by aup.created_at desc
limit 30;
