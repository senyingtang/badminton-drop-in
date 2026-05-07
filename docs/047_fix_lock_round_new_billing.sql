-- 047_fix_lock_round_new_billing.sql
-- Fix: lock_round_and_increment_counters should NOT charge legacy wallet.
-- New billing/quota flow is handled by kb_billing_preflight_session_start + kb_billing_consume_on_session_start.

begin;

create or replace function public.lock_round_and_increment_counters(
  input_round_id uuid,
  input_locked_by_user_id uuid default null
)
returns void
language plpgsql
security definer
as $$
declare
  v_round public.rounds%rowtype;
begin
  select * into v_round
  from public.rounds
  where id = input_round_id
  for update;

  if not found then
    raise exception 'round not found';
  end if;

  -- Idempotent: repeated lock should not re-bill nor re-increment counters.
  if v_round.status = 'locked' then
    return;
  end if;

  -- IMPORTANT: Do NOT call legacy wallet charge here.
  -- Billing consumption happens via kb_billing_consume_on_session_start (idempotent by sessions.quota_ledger_id / overage_charge_id).

  update public.rounds
  set status = 'locked',
      locked_at = now(),
      locked_by_user_id = coalesce(input_locked_by_user_id, auth.uid()),
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
      updated_at = now()
  where id = v_round.session_id;
end;
$$;

commit;

