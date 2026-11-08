-- 092 / 01e：讓「停權（is_active=false）」與「已刪除（is_deleted）」真正參與授權（M3，P0）。
-- 狀態：提案，尚未在任何 Supabase 執行。需使用者核准；建議在 01d 之後執行。
--
-- 問題（M1.5 審查第 2 節）：
--   is_platform_admin() / is_host() / is_venue_owner() 只看 primary_role，
--   被停權的管理員、團主在所有 RLS policy（約 170 處）中仍保有權限；被停權的球友仍可報名。
--
-- 修補（只新增條件，不放寬任何權限）：
--   1. 三個角色判斷函式加上「is_active 為 true 且未刪除」。啟用中的帳號行為完全不變。
--      保留原本的名稱、參數與回傳型別，所有 policy 不需要改。改為 SECURITY DEFINER + 固定 search_path，
--      避免讀 app_user_profiles 時遞迴套用 RLS，也避免 search_path 劫持（00d I 段）。
--   2. session_participants 新增 BEFORE INSERT OR UPDATE trigger：呼叫者（auth.uid()）若是停權或已刪除帳號，
--      拒絕新增或修改報名（含 046 的「取消後重新報名」走 UPDATE 的路徑）。
--      只檢查「呼叫者」，不檢查被報名的球員；auth.uid() 為 null（service_role、SQL Editor）不受影響。
--      注意：報名 RPC 多為 SECURITY DEFINER，trigger 內的 auth.uid() 仍是原本的使用者，所以停權者透過 RPC 報名也會被擋。
--   3. 不改任何 RLS policy、資料列、排組演算法或帳務公式。
--
-- App 端搭配（同一個 commit）：停權 / 復權 API 會同時 ban / unban Supabase Auth 帳號，
-- 被停權者無法再登入或刷新 session（既有 access token 最多 1 小時內失效）。
--
-- 回滾：99e_rollback_01e.sql（還原 002 / 007 的原始函式定義並移除 trigger）。

begin;

create or replace function public.kb092_profile_is_active(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select coalesce((to_jsonb(p) ->> 'is_active')::boolean, true)
       and not coalesce((to_jsonb(p) ->> 'is_deleted')::boolean, false)
    from public.app_user_profiles p
    where p.id = p_id
  ), true);   -- 沒有 profile（尚未建立）視為非停權；角色判斷函式另外要求 profile 存在
$$;
revoke all on function public.kb092_profile_is_active(uuid) from public, anon;
grant execute on function public.kb092_profile_is_active(uuid) to authenticated, service_role;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.app_user_profiles p
    where p.id = auth.uid()
      and p.primary_role::text = 'platform_admin'
      and coalesce((to_jsonb(p) ->> 'is_active')::boolean, true)
      and not coalesce((to_jsonb(p) ->> 'is_deleted')::boolean, false)
  );
$$;

create or replace function public.is_venue_owner()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.app_user_profiles p
    where p.id = auth.uid()
      and p.primary_role::text = 'venue_owner'
      and coalesce((to_jsonb(p) ->> 'is_active')::boolean, true)
      and not coalesce((to_jsonb(p) ->> 'is_deleted')::boolean, false)
  );
$$;

create or replace function public.is_host()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.app_user_profiles p
    where p.id = auth.uid()
      and p.primary_role::text = 'host'
      and coalesce((to_jsonb(p) ->> 'is_active')::boolean, true)
      and not coalesce((to_jsonb(p) ->> 'is_deleted')::boolean, false)
  );
$$;

create or replace function public.kb092_guard_suspended_signup()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- service_role（JWT 沒有 sub）、SQL Editor、背景工作：auth.uid() 為 null，不受影響
  if v_uid is null then return new; end if;
  if not public.kb092_profile_is_active(v_uid) then
    raise exception 'ACCOUNT_SUSPENDED' using errcode = '42501',
      detail = 'suspended or deleted accounts cannot create or change session registrations';
  end if;
  return new;
end;
$$;
revoke all on function public.kb092_guard_suspended_signup() from public, anon;

drop trigger if exists trg_kb092_guard_suspended_signup on public.session_participants;
create trigger trg_kb092_guard_suspended_signup
before insert or update on public.session_participants
for each row execute function public.kb092_guard_suspended_signup();

commit;
