-- 092 / 99d：Rollback 01d（會員角色提升 / 自行解除停權 防護）
-- ⚠️ 會重新開放「會員自行把 primary_role 改成 platform_admin」與「自行解除停權」的漏洞。
-- 只在 01d 造成正式站無法修復的故障、且經使用者書面核准時使用。

begin;
drop trigger if exists trg_kb092_guard_profile_privileged_columns on public.app_user_profiles;
drop function if exists public.kb092_guard_profile_privileged_columns();
drop function if exists public.kb092_caller_is_active_platform_admin();
commit;
