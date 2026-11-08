-- 092 / 01c：kb_get_quota_dashboard 越權讀取修正（M1.4）
-- 狀態：提案。只在本機 PGlite 測過，見 staging-test/。需經使用者核准才可執行。
--
-- 問題：kb_get_quota_dashboard(p_user_id uuid default auth.uid()) 是 SECURITY DEFINER，且接受任意 p_user_id，
--       任何登入者都能讀取他人的錢包餘額 / 配額 / 方案，並替他人建立帳務帳戶。
-- 修正：保留原函式本體（改名為 kb_get_quota_dashboard_unchecked，只給 service_role），
--       同名新函式先檢查「只能查自己，平台管理員可查他人」，再呼叫原函式。回傳格式完全相同。
-- 相容性：App（新舊版）都以無參數呼叫（= 自己），行為不變。
-- 可重複執行。

begin;

do $$
begin
  -- 只有在尚未改名過時才改名（重複執行時跳過）
  if to_regprocedure('public.kb_get_quota_dashboard_unchecked(uuid)') is null
     and to_regprocedure('public.kb_get_quota_dashboard(uuid)') is not null then
    alter function public.kb_get_quota_dashboard(uuid) rename to kb_get_quota_dashboard_unchecked;
  end if;
end
$$;

revoke execute on function public.kb_get_quota_dashboard_unchecked(uuid) from public, anon, authenticated;
grant execute on function public.kb_get_quota_dashboard_unchecked(uuid) to service_role;

create or replace function public.kb_get_quota_dashboard(p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if p_user_id is distinct from auth.uid() and not public.is_platform_admin() then
    raise exception 'NO_PERMISSION';
  end if;
  return public.kb_get_quota_dashboard_unchecked(p_user_id);
end;
$$;

revoke execute on function public.kb_get_quota_dashboard(uuid) from public, anon;
grant execute on function public.kb_get_quota_dashboard(uuid) to authenticated, service_role;

commit;
