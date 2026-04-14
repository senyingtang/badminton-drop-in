-- finish_round：僅在「全場次已無 locked 輪」時才把 session 標成 round_finished；否則維持 in_progress。
-- unlock_round：不再清空整場所有球員 is_locked；僅還原本輪上場者；若仍有其他 locked 輪則 session 維持 in_progress。

create or replace function public.finish_round_and_release_locks(
  input_round_id uuid,
  input_finished_by_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
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
  where exists (
    select 1
    from public.match_team_players mtp
    join public.match_teams mt on mt.id = mtp.match_team_id
    join public.matches m on m.id = mt.match_id
    where m.round_id = input_round_id
      and mtp.participant_id = sp.id
  );

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

  if exists (
    select 1
    from public.rounds r
    where r.session_id = v_round.session_id
      and r.status = 'locked'
  ) then
    update public.sessions
    set status = 'in_progress',
        updated_at = now()
    where id = v_round.session_id;
  elsif exists (
    select 1
    from public.rounds r
    where r.session_id = v_round.session_id
      and r.status = 'draft'
  ) then
    update public.sessions
    set status = 'in_progress',
        updated_at = now()
    where id = v_round.session_id;
  else
    update public.sessions
    set status = 'round_finished',
        updated_at = now()
    where id = v_round.session_id;
  end if;
end;
$$;

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

  if not public.user_is_session_host(v_round.session_id)
     and not public.user_manages_venue((select s.venue_id from public.sessions s where s.id = v_round.session_id))
     and not public.is_platform_admin()
  then
    raise exception 'forbidden';
  end if;

  if v_round.status <> 'locked' then
    raise exception 'round_not_locked';
  end if;

  update public.rounds
  set status = 'draft',
      locked_at = null,
      locked_by_user_id = null,
      updated_at = now()
  where id = input_round_id;

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

  if exists (
    select 1
    from public.rounds r
    where r.session_id = v_round.session_id
      and r.status = 'locked'
      and r.id <> input_round_id
  ) then
    update public.sessions
    set status = 'in_progress',
        updated_at = now()
    where id = v_round.session_id;
  elsif exists (
    select 1
    from public.rounds r
    where r.session_id = v_round.session_id
      and r.status = 'draft'
  ) then
    update public.sessions
    set status = 'in_progress',
        updated_at = now()
    where id = v_round.session_id;
  else
    update public.sessions
    set status = 'ready_for_assignment',
        updated_at = now()
    where id = v_round.session_id;
  end if;

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

grant execute on function public.finish_round_and_release_locks(uuid, uuid) to authenticated, service_role;
grant execute on function public.unlock_round_and_restore_counters(uuid, uuid) to authenticated, service_role;
