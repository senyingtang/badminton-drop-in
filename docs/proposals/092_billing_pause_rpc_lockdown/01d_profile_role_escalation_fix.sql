-- 092 / 01d：會員自行提升為平台管理員（權限提升）修正（M1.4，P0）
-- 狀態：提案。只在本機 PGlite 測過，見 staging-test/。需經使用者核准才可執行。
--
-- 問題：002 的 app_user_profiles_update_self_or_admin 允許使用者更新「自己那一列的任何欄位」，
--       app_user_profiles_insert_self 也沒有限制角色：
--         PATCH /rest/v1/app_user_profiles?id=eq.<自己>  {"primary_role":"platform_admin"}
--       就能讓 is_platform_admin() 為真 → 讀寫所有錢包 / 金流設定（含 hash key 欄位）/ 管理員 API / 刪除使用者。
--       同理，被停權者可把自己的 is_active 改回 true。
-- 修正：BEFORE INSERT / UPDATE trigger，只限制 anon / authenticated 角色：
--   - 只有「目前就是平台管理員」的人能變更 primary_role、is_active；
--   - 自行建立 profile 時角色只能是 player（與 App 的 useProfileSync / LINE callback 相同）。
--   service_role（後端 API、LINE callback）與 postgres（SQL Editor、DEFINER 函式）不受影響；
--   display_name / phone 等一般欄位照常可自行修改。不修改 RLS policy 本身。

begin;

create or replace function public.kb092_guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- 只限制前端可用的角色；service_role / postgres / DEFINER 函式照常
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.primary_role is distinct from 'player'::app_role and not public.is_platform_admin() then
      raise exception 'ROLE_CHANGE_NOT_ALLOWED' using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.primary_role is distinct from old.primary_role or new.is_active is distinct from old.is_active)
     and not public.is_platform_admin() then
    raise exception 'ROLE_CHANGE_NOT_ALLOWED' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_kb092_guard_profile_privileged_columns on public.app_user_profiles;
create trigger trg_kb092_guard_profile_privileged_columns
before insert or update on public.app_user_profiles
for each row execute function public.kb092_guard_profile_privileged_columns();

revoke execute on function public.kb092_guard_profile_privileged_columns() from public, anon;

commit;
