
-- 004_functions_and_triggers.sql
-- 目標：
-- 1. 補齊共享備註版本歷史
-- 2. 補齊評價彙總
-- 3. 提供候補遞補、首次開打扣款、round 鎖定 / 解鎖等 deterministic RPC
-- 4. 讓前端與 AI Agent 透過固定 RPC 操作核心業務，而不是直接拼湊多表寫入

begin;

-- =========================================================
-- 1. Wallet helpers
-- =========================================================

create or replace function public.ensure_wallet_account(input_user_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_wallet_id uuid;
begin
  select id into v_wallet_id
  from public.wallet_accounts
  where owner_user_id = input_user_id;

  if v_wallet_id is null then
    insert into public.wallet_accounts (owner_user_id)
    values (input_user_id)
    returning id into v_wallet_id;
  end if;

  return v_wallet_id;
end;
$$;

create or replace function public.apply_wallet_transaction(
  input_owner_user_id uuid,
  input_tx_type wallet_transaction_type,
  input_amount integer,
  input_status wallet_transaction_status_type,
  input_reference_type text default null,
  input_reference_id uuid default null,
  input_payment_provider payment_provider_type default null,
  input_provider_payment_ref text default null,
  input_note text default null,
  input_idempotency_key text default null,
  input_created_by_user_id uuid default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_wallet_id uuid;
  v_tx_id uuid;
  v_before integer;
  v_after integer;
begin
  if input_amount = 0 then
    raise exception 'wallet transaction amount cannot be zero';
  end if;

  if input_idempotency_key is not null then
    select id into v_tx_id
    from public.wallet_transactions
    where idempotency_key = input_idempotency_key;

    if v_tx_id is not null then
      return v_tx_id;
    end if;
  end if;

  v_wallet_id := public.ensure_wallet_account(input_owner_user_id);

  select balance_amount into v_before
  from public.wallet_accounts
  where id = v_wallet_id
  for update;

  v_after := v_before + input_amount;

  if v_after < 0 then
    raise exception 'wallet balance would become negative';
  end if;

  update public.wallet_accounts
  set balance_amount = v_after,
      updated_at = now()
  where id = v_wallet_id;

  insert into public.wallet_transactions (
    wallet_account_id,
    tx_type,
    status,
    amount,
    balance_before,
    balance_after,
    reference_type,
    reference_id,
    payment_provider,
    provider_payment_ref,
    note,
    idempotency_key,
    created_by_user_id
  )
  values (
    v_wallet_id,
    input_tx_type,
    input_status,
    input_amount,
    v_before,
    v_after,
    input_reference_type,
    input_reference_id,
    input_payment_provider,
    input_provider_payment_ref,
    input_note,
    input_idempotency_key,
    input_created_by_user_id
  )
  returning id into v_tx_id;

  return v_tx_id;
end;
$$;

-- =========================================================
-- 2. Rating summary refresh
-- =========================================================

create or replace function public.refresh_player_rating_summary(input_player_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.player_rating_summary (
    player_id,
    total_rating_count,
    avg_skill_rating,
    avg_punctuality_rating,
    avg_attitude_rating,
    positive_quick_count,
    negative_quick_count,
    updated_at
  )
  select
    pr.player_id,
    count(*)::integer,
    round(avg(pr.skill_rating)::numeric, 2),
    round(avg(pr.punctuality_rating)::numeric, 2),
    round(avg(pr.attitude_rating)::numeric, 2),
    count(*) filter (where coalesce(pr.quick_recommend, false) = true)::integer,
    count(*) filter (where coalesce(pr.quick_recommend, false) = false)::integer,
    now()
  from public.player_ratings pr
  where pr.player_id = input_player_id
    and coalesce(pr.is_hidden, false) = false
  group by pr.player_id
  on conflict (player_id) do update
  set
    total_rating_count = excluded.total_rating_count,
    avg_skill_rating = excluded.avg_skill_rating,
    avg_punctuality_rating = excluded.avg_punctuality_rating,
    avg_attitude_rating = excluded.avg_attitude_rating,
    positive_quick_count = excluded.positive_quick_count,
    negative_quick_count = excluded.negative_quick_count,
    updated_at = now();

  if not exists (
    select 1 from public.player_ratings
    where player_id = input_player_id
      and coalesce(is_hidden, false) = false
  ) then
    delete from public.player_rating_summary
    where player_id = input_player_id;
  end if;
end;
$$;

create or replace function public.trg_refresh_player_rating_summary()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_player_rating_summary(old.player_id);
    return old;
  else
    perform public.refresh_player_rating_summary(new.player_id);
    if tg_op = 'UPDATE' and old.player_id is distinct from new.player_id then
      perform public.refresh_player_rating_summary(old.player_id);
    end if;
    return new;
  end if;
end;
$$;

drop trigger if exists trg_player_ratings_summary on public.player_ratings;
create trigger trg_player_ratings_summary
after insert or update or delete on public.player_ratings
for each row execute function public.trg_refresh_player_rating_summary();

-- =========================================================
-- 3. Shared note history
-- =========================================================

create or replace function public.trg_write_shared_note_history()
returns trigger
language plpgsql
security definer
as $$
declare
  v_next_version integer;
begin
  if tg_op = 'UPDATE' then
    select coalesce(max(version_no), 0) + 1
    into v_next_version
    from public.player_shared_note_history
    where shared_note_id = new.id;

    insert into public.player_shared_note_history (
      shared_note_id,
      version_no,
      note_type,
      quick_tag,
      note_text,
      modified_by_user_id,
      modified_at
    )
    values (
      new.id,
      v_next_version,
      new.note_type,
      new.quick_tag,
      new.note_text,
      coalesce(new.hidden_by_user_id, new.created_by_host_user_id),
      now()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_player_shared_notes_history on public.player_shared_notes;
create trigger trg_player_shared_notes_history
after update on public.player_shared_notes
for each row execute function public.trg_write_shared_note_history();

-- =========================================================
-- 4. Waitlist promotion
-- =========================================================

create or replace function public.promote_next_waitlist_participant(
  input_session_id uuid,
  input_replaced_participant_id uuid default null,
  input_promoted_by_user_id uuid default null,
  input_reason text default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_promoted_participant_id uuid;
begin
  select sp.id
  into v_promoted_participant_id
  from public.session_participants sp
  where sp.session_id = input_session_id
    and sp.status = 'waitlist'
    and coalesce(sp.is_removed, false) = false
  order by sp.waitlist_order asc nulls last, sp.created_at asc
  limit 1
  for update;

  if v_promoted_participant_id is null then
    raise exception 'no waitlist participant available';
  end if;

  update public.session_participants
  set
    status = 'promoted_from_waitlist',
    waitlist_order = null,
    priority_order = coalesce(priority_order, 999999),
    updated_at = now()
  where id = v_promoted_participant_id;

  insert into public.session_waitlist_promotions (
    session_id,
    promoted_participant_id,
    replaced_participant_id,
    promoted_by_user_id,
    reason
  )
  values (
    input_session_id,
    v_promoted_participant_id,
    input_replaced_participant_id,
    coalesce(input_promoted_by_user_id, auth.uid()),
    input_reason
  );

  insert into public.session_events (
    session_id,
    actor_user_id,
    event_type,
    payload
  )
  values (
    input_session_id,
    coalesce(input_promoted_by_user_id, auth.uid()),
    'waitlist_promoted',
    jsonb_build_object(
      'promoted_participant_id', v_promoted_participant_id,
      'replaced_participant_id', input_replaced_participant_id,
      'reason', input_reason
    )
  );

  return v_promoted_participant_id;
end;
$$;

-- =========================================================
-- 5. Session first charge
-- =========================================================

create or replace function public.charge_session_first_start(
  input_session_id uuid,
  input_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_session public.sessions%rowtype;
  v_plan_id uuid;
  v_trial_remaining integer;
  v_charge_id uuid;
  v_wallet_tx_id uuid;
begin
  select *
  into v_session
  from public.sessions
  where id = input_session_id
  for update;

  if not found then
    raise exception 'session not found';
  end if;

  if coalesce(v_session.has_first_charge_applied, false) = true then
    select id into v_charge_id
    from public.usage_charges
    where session_id = input_session_id;
    return v_charge_id;
  end if;

  select id into v_plan_id
  from public.billing_plans
  where code = 'HOST_PAY_PER_USE'
  limit 1;

  if v_plan_id is null then
    raise exception 'HOST_PAY_PER_USE billing plan not found';
  end if;

  -- trial remaining by count of successful charges against this user
  select greatest(
    (select trial_session_count from public.billing_plans where id = v_plan_id)
    -
    (select count(*)::integer from public.usage_charges uc
     where uc.billed_user_id = v_session.host_user_id and uc.status = 'charged'),
    0
  )
  into v_trial_remaining;

  insert into public.usage_charges (
    session_id,
    billed_user_id,
    plan_id,
    amount,
    currency,
    status,
    charged_at
  )
  values (
    input_session_id,
    v_session.host_user_id,
    v_plan_id,
    case when v_trial_remaining > 0 then 0 else 50 end,
    'TWD',
    'charged',
    now()
  )
  returning id into v_charge_id;

  if v_trial_remaining = 0 then
    v_wallet_tx_id := public.apply_wallet_transaction(
      input_owner_user_id      => v_session.host_user_id,
      input_tx_type            => 'debit_usage',
      input_amount             => -50,
      input_status             => 'completed',
      input_reference_type     => 'usage_charge',
      input_reference_id       => v_charge_id,
      input_payment_provider   => null,
      input_provider_payment_ref => null,
      input_note               => 'Session first start charge',
      input_idempotency_key    => 'usage-charge:' || input_session_id::text,
      input_created_by_user_id => coalesce(input_actor_user_id, auth.uid())
    );

    update public.usage_charges
    set wallet_transaction_id = v_wallet_tx_id
    where id = v_charge_id;
  end if;

  update public.sessions
  set has_first_charge_applied = true,
      updated_at = now()
  where id = input_session_id;

  insert into public.session_events (
    session_id,
    actor_user_id,
    event_type,
    payload
  )
  values (
    input_session_id,
    coalesce(input_actor_user_id, auth.uid()),
    'session_first_charge_applied',
    jsonb_build_object(
      'usage_charge_id', v_charge_id,
      'trial_applied', (v_trial_remaining > 0)
    )
  );

  return v_charge_id;
end;
$$;

-- =========================================================
-- 6. Round lifecycle helpers
-- =========================================================

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

  if v_round.status = 'locked' then
    return;
  end if;

  perform public.charge_session_first_start(v_round.session_id, coalesce(input_locked_by_user_id, auth.uid()));

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

create or replace function public.finish_round_and_release_locks(
  input_round_id uuid,
  input_finished_by_user_id uuid default null
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

  update public.rounds
  set status = 'finished',
      finished_at = now(),
      finished_by_user_id = coalesce(input_finished_by_user_id, auth.uid()),
      updated_at = now()
  where id = input_round_id;

  update public.session_participants sp
  set
    is_locked_for_current_round = false,
    updated_at = now()
  where sp.session_id = v_round.session_id;

  -- reset consecutive rounds for players who did not play this round
  update public.session_participants sp
  set
    consecutive_rounds_played = 0,
    updated_at = now()
  where sp.session_id = v_round.session_id
    and not exists (
      select 1
      from public.match_team_players mtp
      join public.match_teams mt on mt.id = mtp.match_team_id
      join public.matches m on m.id = mt.match_id
      where m.round_id = input_round_id
        and mtp.participant_id = sp.id
    );

  update public.sessions
  set status = 'round_finished',
      updated_at = now()
  where id = v_round.session_id;
end;
$$;

-- =========================================================
-- 7. Utility RPC: confirm self-signup into main or waitlist
-- =========================================================

create or replace function public.confirm_participant_status(
  input_session_participant_id uuid,
  input_new_status session_participant_status_type,
  input_actor_user_id uuid default null
)
returns void
language plpgsql
security definer
as $$
declare
  v_sp public.session_participants%rowtype;
begin
  select * into v_sp
  from public.session_participants
  where id = input_session_participant_id
  for update;

  if not found then
    raise exception 'session participant not found';
  end if;

  if input_new_status not in ('confirmed_main', 'waitlist', 'cancelled', 'unavailable', 'no_show', 'completed') then
    raise exception 'unsupported participant status transition';
  end if;

  update public.session_participants
  set
    status = input_new_status,
    updated_at = now()
  where id = input_session_participant_id;

  insert into public.session_events (
    session_id,
    actor_user_id,
    event_type,
    payload
  )
  values (
    v_sp.session_id,
    coalesce(input_actor_user_id, auth.uid()),
    'participant_status_changed',
    jsonb_build_object(
      'session_participant_id', input_session_participant_id,
      'new_status', input_new_status
    )
  );
end;
$$;

commit;
