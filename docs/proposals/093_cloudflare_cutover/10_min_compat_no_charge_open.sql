-- 093 / 10：Cloudflare 切換「最小必要」相容性 SQL —— 只新增 kb_open_registration_no_charge
-- 內容與 092/01 第 2 段逐字相同（之後再執行完整 092/01 時，create or replace 會得到同一份函式，不衝突）。
-- 只新增一個函式並授權 authenticated；不改任何資料表、資料、RLS、既有函式或權限。
-- 舊版 Vercel 不呼叫此函式，不受影響。新版開放報名少了它會失敗（正式備份還原的隔離環境實測）。
-- 回滾：093/10r_rollback_min_compat.sql
-- 驗證：本檔最後的查詢應回傳 exists = true、authenticated_can_execute = true

begin;

-- 2) 不扣費開放報名：權限與狀態檢查與 kb_open_registration_with_billing（052）相同，
--    但不呼叫配額 / 錢包，也不寫入任何帳務紀錄。
create or replace function public.kb_open_registration_no_charge(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.sessions%rowtype;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED';
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
