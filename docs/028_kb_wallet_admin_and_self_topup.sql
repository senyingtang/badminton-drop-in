-- 1) 平台管理員調整指定會員個人錢包餘額（走 billing_account + kb_wallets 正規模型）
-- 2) 已登入使用者自行「儲值」模擬入帳（無金流閘道時使用；仍寫入 kb_wallet_transactions）

create or replace function public.kb_admin_adjust_user_wallet(
  p_target_user_id uuid,
  p_delta numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_billing_id uuid;
  v_wallet record;
  v_new numeric;
  v_txn public.kb_wallet_txn_type;
  v_amt numeric;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  if p_target_user_id is null or p_delta is null or p_delta = 0 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  if p_reason is null or length(trim(p_reason)) < 1 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  v_billing_id := public.kb_create_personal_billing_account_if_missing(p_target_user_id);

  select * into v_wallet
  from public.kb_wallets
  where billing_account_id = v_billing_id
  for update;

  if not found then
    raise exception 'wallet_not_found';
  end if;

  v_new := v_wallet.balance + p_delta;

  if coalesce(v_wallet.allow_negative, false) = false and v_new < 0 then
    raise exception 'INSUFFICIENT_WALLET_BALANCE';
  end if;

  if p_delta > 0 then
    v_txn := 'topup'::public.kb_wallet_txn_type;
    v_amt := p_delta;
  else
    v_txn := 'debit_adjustment'::public.kb_wallet_txn_type;
    v_amt := p_delta;
  end if;

  insert into public.kb_wallet_transactions (
    wallet_id, txn_type, amount, balance_before, balance_after,
    reference_type, reference_id, note
  ) values (
    v_wallet.id,
    v_txn,
    v_amt,
    v_wallet.balance,
    v_new,
    'admin_manual',
    auth.uid(),
    trim(p_reason)
  );

  update public.kb_wallets
  set balance = v_new,
      updated_at = now()
  where id = v_wallet.id;

  insert into public.kb_audit_logs (
    actor_user_id,
    action_type,
    target_entity_type,
    target_entity_id,
    reason,
    new_data
  ) values (
    auth.uid(),
    'wallet_adjustment',
    'user',
    p_target_user_id,
    trim(p_reason),
    jsonb_build_object('delta', p_delta, 'balance_after', v_new)
  );

  return jsonb_build_object('ok', true, 'balance_after', v_new);
end;
$$;

create or replace function public.kb_user_self_wallet_topup(p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_billing_id uuid;
  v_wallet record;
  v_new numeric;
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;

  if p_amount is null or p_amount < 50 or p_amount > 20000 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  v_billing_id := public.kb_create_personal_billing_account_if_missing(v_uid);

  select * into v_wallet
  from public.kb_wallets
  where billing_account_id = v_billing_id
  for update;

  if not found then
    raise exception 'wallet_not_found';
  end if;

  v_new := v_wallet.balance + p_amount;

  insert into public.kb_wallet_transactions (
    wallet_id, txn_type, amount, balance_before, balance_after,
    reference_type, reference_id, note
  ) values (
    v_wallet.id,
    'topup'::public.kb_wallet_txn_type,
    p_amount,
    v_wallet.balance,
    v_new,
    'self_topup_simulated',
    v_uid,
    '使用者於前台儲值頁手動入帳（模擬，未接金流閘道）'
  );

  update public.kb_wallets
  set balance = v_new,
      updated_at = now()
  where id = v_wallet.id;

  return jsonb_build_object('ok', true, 'balance_after', v_new);
end;
$$;

grant execute on function public.kb_admin_adjust_user_wallet(uuid, numeric, text) to authenticated, service_role;
grant execute on function public.kb_user_self_wallet_topup(numeric) to authenticated, service_role;
