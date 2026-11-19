-- 093 / 10：Cloudflare 切換「最小必要」相容性 SQL —— 只新增 kb_open_registration_no_charge
-- 內容與 092/01 第 2 段逐字相同（之後再執行完整 092/01 時，create or replace 會得到同一份函式，不衝突）。
-- 只新增一個函式並授權 authenticated（anon 不可執行）；不改任何資料表、資料、RLS、既有函式或權限。
-- 舊版 Vercel 不呼叫此函式，不受影響。新版開放報名少了它會失敗（正式備份還原的隔離環境實測）。
-- 回滾：093/10r_rollback_min_compat.sql
-- 安全審查（M9）：SECURITY DEFINER、search_path = public, pg_temp、無動態 SQL；auth.uid() 必填；
--   只允許場次 host 或該場次組織帳務帳戶的啟用中 owner / host / manager（與 052 相同，且 host 比對用 is distinct from，host 為 NULL 時不放行）；
--   停權 / 已刪除帳號一律拒絕（JWT 到期前仍有效，所以函式內檢查）；anon / PUBLIC 不可執行。
--   Staging 越權測試 14/14：web/scripts/e2e/core-staging/authz-open-registration.mjs
-- 驗證：本檔最後的查詢應回傳 exists = true、authenticated_can_execute = true

begin;

-- 2) 不扣費開放報名：權限與狀態檢查與 kb_open_registration_with_billing（052）相同，
--    但不呼叫配額 / 錢包，也不寫入任何帳務紀錄。
create or replace function public.kb_open_registration_no_charge(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp   -- pg_temp 放最後：暫存表不能遮蔽 public（SECURITY DEFINER 建議寫法）。不可用空字串：sessions 上的 trigger 繼承此 search_path，需解析 public 的 enum 型別
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.sessions%rowtype;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  -- 停權 / 已刪除帳號不可操作（不依賴 01e；JWT 在停權後到期前仍有效，所以函式內必須自行檢查）
  if exists (
    select 1 from public.app_user_profiles p
    where p.id = v_user_id
      -- to_jsonb：is_deleted 不在 repo migrations 內（正式 / Staging 有）；欄位不存在時視為未刪除，與 01e 相同寫法
      and (not coalesce((to_jsonb(p) ->> 'is_active')::boolean, true)
           or coalesce((to_jsonb(p) ->> 'is_deleted')::boolean, false))
  ) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  select * into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  -- 與 052 相同：場次 host，或該場次 organization 帳務帳戶的 owner / host / manager
  if v_session.host_user_id is distinct from v_user_id then
    if v_session.billing_account_id is null then
      raise exception 'NO_PERMISSION';
    end if;
    if not exists (
      select 1
      from public.kb_billing_accounts ba
      join public.kb_organizations o on o.id = ba.organization_id
      join public.kb_organization_members m on m.organization_id = o.id
      where ba.id = v_session.billing_account_id
        and ba.account_type = 'organization'
        and m.user_id = v_user_id
        and m.is_active = true
        and m.role in ('owner', 'host', 'manager')
    ) then
      raise exception 'NO_PERMISSION';
    end if;
  end if;

  if v_session.status = 'registration_open' then
    return jsonb_build_object('ok', true, 'session_id', p_session_id, 'charged_by', 'already_open',
                              'session_status', v_session.status);
  end if;

  if v_session.status not in ('draft', 'pending_confirmation') then
    raise exception 'INVALID_SESSION_STATUS';
  end if;

  update public.sessions
  set status = 'registration_open',
      allow_self_signup = true,
      registration_opened_at = coalesce(registration_opened_at, now()),
      updated_at = now()
  where id = p_session_id;

  return jsonb_build_object('ok', true, 'session_id', p_session_id, 'charged_by', 'none_billing_paused',
                            'session_status', 'registration_open');
end;
$$;

revoke execute on function public.kb_open_registration_no_charge(uuid) from public, anon;
grant execute on function public.kb_open_registration_no_charge(uuid) to authenticated, service_role;

commit;

select to_regprocedure('public.kb_open_registration_no_charge(uuid)') is not null as exists,
       has_function_privilege('authenticated', 'public.kb_open_registration_no_charge(uuid)', 'execute') as authenticated_can_execute;
