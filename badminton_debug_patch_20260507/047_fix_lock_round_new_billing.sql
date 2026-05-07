-- 047_fix_lock_round_new_billing.sql
-- Purpose:
-- 1) Fix "wallet balance would become negative" when locking/starting a round.
-- 2) Stop lock_round_and_increment_counters from calling the legacy pay-per-use wallet flow
--    (charge_session_first_start -> wallet_accounts), because the app already uses the new
--    kb_billing_* quota / wallet model.
--
-- Root cause:
-- - Frontend RoundList.tsx calls kb_billing_preflight_session_start / kb_billing_consume_on_session_start.
-- - Then it calls lock_round_and_increment_counters.
-- - The old implementation of lock_round_and_increment_counters calls charge_session_first_start,
--   which debits legacy wallet_accounts by 50 if legacy trial is exhausted.
-- - Therefore users may still be blocked by legacy wallet_accounts even when kb_wallets balance/quota is enough.
--
-- Apply after migrations 001-046.

begin;

create or replace function public.lock_round_and_increment_counters(
  input_round_id uuid,
  input_locked_by_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rounds%rowtype;
  v_session public.sessions%rowtype;
  v_actor uuid;
begin
  v_actor := coalesce(input_locked_by_user_id, auth.uid());
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select * into v_round
  from public.rounds
  where id = input_round_id
  for update;

  if not found then
    raise exception 'round not found';
  end if;

  select * into v_session
  from public.sessions
  where id = v_round.session_id
  for update;

  if not found then
    raise exception 'session not found';
  end if;

  if not public.user_is_session_host(v_round.session_id)
     and not public.user_manages_venue(v_session.venue_id)
     and not public.is_platform_admin()
  then
    raise exception 'forbidden';
  end if;

  if v_round.status = 'locked' then
    return;
  end if;

  if v_round.status <> 'draft' then
    raise exception 'round_not_lockable';
  end if;

  -- New billing model guard:
  -- If the frontend has not consumed billing yet, let the host consume it here.
  -- This is idempotent because kb_billing_consume_on_session_start returns already_consumed
  -- when quota_ledger_id or overage_charge_id already exists.
  -- Note: venue_owner / platform_admin locking on behalf of host should pre-consume via a
  -- dedicated admin-aware billing RPC in the future. For now this prevents legacy double charge.
  if v_session.quota_ledger_id is null
     and v_session.overage_charge_id is null
     and coalesce(v_session.has_first_charge_applied, false) = false
  then
    perform public.kb_billing_consume_on_session_start(v_round.session_id);
  end if;

  update public.rounds
  set status = 'locked',
      locked_at = now(),
      locked_by_user_id = v_actor,
      updated_at = now()
  where id = input_round_id;

  update public.session_participants sp
  set
    total_matches_played = total_matches_played + 1,
    consecutive_rounds_played = consecutive_rounds_played + 1,
    is_locked_for_current_round = true,
    updated_at = now()
  where exists (
    select 1
    from public.match_team_players mtp
    join public.match_teams mt on mt.id = mtp.match_team_id
    join public.matches m on m.id = mt.match_id
    where m.round_id = input_round_id
      and mtp.participant_id = sp.id
  );

  update public.sessions
  set status = 'in_progress',
      first_started_at = coalesce(first_started_at, now()),
      has_first_charge_applied = true,
      updated_at = now()
  where id = v_round.session_id;

  insert into public.session_events (
    session_id,
    actor_user_id,
    event_type,
    payload
  ) values (
    v_round.session_id,
    v_actor,
    'round_locked',
    jsonb_build_object('round_id', input_round_id, 'billing_model', 'kb_billing_v2')
  );
end;
$$;

grant execute on function public.lock_round_and_increment_counters(uuid, uuid) to authenticated, service_role;

commit;
