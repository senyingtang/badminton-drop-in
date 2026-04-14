-- 帳務總覽 kb_get_quota_dashboard 回傳 null：常見於已有 kb_billing_accounts + kb_wallets，
-- 但尚無 kb_subscriptions（kb_v_quota_dashboard_personal 內 join 無列）導致子查詢為 null。
-- 另：完全無個人帳且無組織帳時，改為自動建立個人帳戶（與 026 精神一致），避免前端空白。
--
-- 與既有行為相容：仍以「有個人帳則走個人」優先；有組織帳且無個人帳時仍走組織分支。

create or replace function public.kb_get_quota_dashboard(p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_personal_account uuid;
  v_org record;
  v_row jsonb;
begin
  if p_user_id is null then
    raise exception 'NO_USER';
  end if;

  select id into v_personal_account
  from public.kb_billing_accounts
  where account_type = 'personal'
    and owner_user_id = p_user_id
  limit 1;

  if v_personal_account is not null then
    select jsonb_build_object(
      'billing_account_type', 'personal',
      'billing_account_id', billing_account_id,
      'user_id', user_id,
      'plan_code', plan_code,
      'subscription_status', subscription_status,
      'period_start', current_period_start,
      'period_end', current_period_end,
      'quota_limit', quota_limit,
      'quota_used', quota_used,
      'quota_remaining', quota_remaining,
      'wallet_balance', coalesce(wallet_balance, 0)
    )
    into v_row
    from public.kb_v_quota_dashboard_personal
    where billing_account_id = v_personal_account
    limit 1;

    if v_row is not null then
      return v_row;
    end if;

    return (
      select jsonb_build_object(
        'billing_account_type', 'personal',
        'billing_account_id', ba.id,
        'user_id', ba.owner_user_id,
        'plan_code', null,
        'subscription_status', 'pending_setup',
        'period_start', null,
        'period_end', null,
        'quota_limit', 0,
        'quota_used', 0,
        'quota_remaining', 0,
        'wallet_balance', coalesce(w.balance, 0)
      )
      from public.kb_billing_accounts ba
      left join public.kb_wallets w on w.billing_account_id = ba.id
      where ba.id = v_personal_account
    );
  end if;

  select o.id, o.name, ba.id as billing_account_id
    into v_org
  from public.kb_organization_members m
  join public.kb_organizations o on o.id = m.organization_id
  join public.kb_billing_accounts ba on ba.organization_id = o.id and ba.account_type = 'organization'
  where m.user_id = p_user_id and m.is_active = true
  order by case when m.role = 'owner' then 0 else 1 end
  limit 1;

  if v_org.billing_account_id is not null then
    return (
      select jsonb_build_object(
        'billing_account_type', 'organization',
        'billing_account_id', v_org.billing_account_id,
        'organization', jsonb_build_object('id', v_org.id, 'name', v_org.name),
        'subscription', (
          select jsonb_build_object(
            'plan_code', p.plan_code,
            'status', s.status,
            'period_start', s.current_period_start,
            'period_end', s.current_period_end
          )
          from public.kb_subscriptions s
          join public.kb_plans p on p.id = s.plan_id
          where s.billing_account_id = v_org.billing_account_id
          order by s.created_at desc
          limit 1
        ),
        'wallet_balance', coalesce((select balance from public.kb_wallets where billing_account_id = v_org.billing_account_id), 0),
        'hosts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', m.user_id,
            'role', m.role,
            'quota_limit', coalesce(qb.quota_limit, 0),
            'quota_used', coalesce(qb.quota_used, 0),
            'quota_remaining', greatest(coalesce(qb.quota_limit, 0) - coalesce(qb.quota_used, 0), 0)
          ) order by m.joined_at asc)
          from public.kb_organization_members m
          left join public.kb_quota_buckets qb
            on qb.billing_account_id = v_org.billing_account_id
           and qb.user_id = m.user_id
           and now() between qb.valid_from and qb.valid_to
          where m.organization_id = v_org.id
            and m.is_active = true
        ), '[]'::jsonb)
      )
    );
  end if;

  v_personal_account := public.kb_create_personal_billing_account_if_missing(p_user_id);

  return (
    select jsonb_build_object(
      'billing_account_type', 'personal',
      'billing_account_id', ba.id,
      'user_id', ba.owner_user_id,
      'plan_code', null,
      'subscription_status', 'pending_setup',
      'period_start', null,
      'period_end', null,
      'quota_limit', 0,
      'quota_used', 0,
      'quota_remaining', 0,
      'wallet_balance', coalesce(w.balance, 0)
    )
    from public.kb_billing_accounts ba
    left join public.kb_wallets w on w.billing_account_id = ba.id
    where ba.id = v_personal_account
  );
end;
$$;

-- 供前端一鍵補帳（僅能為自己建立）
create or replace function public.kb_ensure_my_billing_account()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  return public.kb_create_personal_billing_account_if_missing(auth.uid());
end;
$$;

grant execute on function public.kb_get_quota_dashboard(uuid) to authenticated, service_role;
grant execute on function public.kb_ensure_my_billing_account() to authenticated, service_role;
