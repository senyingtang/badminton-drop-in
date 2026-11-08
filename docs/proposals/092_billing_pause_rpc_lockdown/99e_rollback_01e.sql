-- 092 / 99e：回滾 01e（還原 002 / 007 的角色判斷函式，移除停權報名 trigger）。
-- 注意：回滾後被停權的管理員 / 團主會重新取得 RLS 權限（Auth ban 仍有效）。

begin;

drop trigger if exists trg_kb092_guard_suspended_signup on public.session_participants;
drop function if exists public.kb092_guard_suspended_signup();

-- 007：is_platform_admin 為 SECURITY DEFINER
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer
-- （007 原本沒有設定 search_path）
as $$
  select exists(select 1 from public.app_user_profiles where id = auth.uid() and primary_role = 'platform_admin');
$$;

-- 002：is_venue_owner / is_host 原為 SECURITY INVOKER、未設定 search_path
create or replace function public.is_venue_owner()
returns boolean language sql stable security invoker
as $$
  select exists(select 1 from public.app_user_profiles where id = auth.uid() and primary_role = 'venue_owner');
$$;
alter function public.is_venue_owner() reset search_path;

create or replace function public.is_host()
returns boolean language sql stable security invoker
as $$
  select exists(select 1 from public.app_user_profiles where id = auth.uid() and primary_role = 'host');
$$;
alter function public.is_host() reset search_path;

alter function public.is_platform_admin() reset search_path;

drop function if exists public.kb092_profile_is_active(uuid);

commit;
