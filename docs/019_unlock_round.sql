-- Allow host to unlock a locked round (revert to draft).
-- This reverses participant counters for players assigned in that round.
create or replace function public.unlock_round_and_restore_counters(
  input_round_id uuid,
  input_actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rounds%rowtype;
  v_actor uuid;
begin
  v_actor := coalesce(input_actor_user_id, auth.uid());
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

  -- authorize (same as rounds_write policy intent)
  if not public.user_is_session_host(v_round.session_id)
     and not public.user_manages_venue((select s.venue_id from public.sessions s where s.id = v_round.session_id))
     and not public.is_platform_admin()
  then
    raise exception 'forbidden';
  end if;

  if v_round.status <> 'locked' then
    raise exception 'round_not_locked';
  end if;

  -- revert round status
  update public.rounds
  set status = 'draft',
      locked_at = null,
      locked_by_user_id = null,
      updated_at = now()
  where id = input_round_id;

  -- revert participant counters for players who were assigned in this round
  update public.session_participants sp
  set
    total_matches_played = greatest(total_matches_played - 1, 0),
    consecutive_rounds_played = greatest(consecutive_rounds_played - 1, 0),
    is_locked_for_current_round = false,
    updated_at = now()
  where exists (
    select 1
    from public.match_team_players mtp
    join public.match_teams mt on mt.id = mtp.match_team_id
    join public.matches m on m.id = mt.match_id
    where m.round_id = input_round_id
      and mtp.participant_id = sp.id
  );

  -- release any locks for the session (safety)
  update public.session_participants sp
  set is_locked_for_current_round = false,
      updated_at = now()
  where sp.session_id = v_round.session_id;

  -- revert session status to ready_for_assignment (pre-game)
  update public.sessions
  set status = 'ready_for_assignment',
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
    'round_unlocked',
    jsonb_build_object('round_id', input_round_id)
  );
end;
$$;

grant execute on function public.unlock_round_and_restore_counters(uuid, uuid) to authenticated, service_role;

