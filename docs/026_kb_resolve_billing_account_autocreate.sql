-- 第一輪鎖定前 preflight：若主辦尚無個人 kb_billing_accounts，舊版 kb_resolve 會 raise
-- 「No billing account found for session …」導致無法鎖定。
-- 改為呼叫既有 kb_create_personal_billing_account_if_missing 自動建立帳戶＋錢包。

create or replace function public.kb_resolve_billing_account_for_session(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_host uuid;
  v_account_id uuid;
begin
  select host_user_id, billing_account_id
    into v_session_host, v_account_id
  from public.sessions
  where id = p_session_id;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_account_id is not null then
    return v_account_id;
  end if;

  select ba.id
    into v_account_id
  from public.kb_billing_accounts ba
  where ba.account_type = 'personal'
    and ba.owner_user_id = v_session_host
  limit 1;

  if v_account_id is null then
    v_account_id := public.kb_create_personal_billing_account_if_missing(v_session_host);
  end if;

  update public.sessions
  set billing_account_id = v_account_id
  where id = p_session_id;

  return v_account_id;
end;
$$;
