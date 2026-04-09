-- Apply assignment result in one RPC (host/admin only).
-- Input JSON format:
-- {
--   "assignments":[{"courtNo":1,"team1":[{"participantId":"..."},...],"team2":[...]}],
--   "debugInfo": {...}
-- }
create or replace function public.apply_assignment_recommendation_and_create_round(
  input_session_id uuid,
  input_round_no integer,
  input_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
  v_rec_id uuid;
  v_round_id uuid;
  v_match_id uuid;
  v_t1_id uuid;
  v_t2_id uuid;
  v_court_no integer;
  v_team jsonb;
  v_participant_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  select * into v_session from public.sessions where id = input_session_id;
  if not found then
    raise exception 'session not found';
  end if;

  if not public.user_is_session_host(input_session_id)
     and not public.user_manages_venue(v_session.venue_id)
     and not public.is_platform_admin()
  then
    raise exception 'forbidden';
  end if;

  insert into public.assignment_recommendations (
    session_id, round_no, status, source, rule_summary, debug_payload
  ) values (
    input_session_id,
    input_round_no,
    'applied',
    'rule_engine',
    coalesce(input_payload->>'rule_summary', ''),
    coalesce(input_payload->'debugInfo', '{}'::jsonb)
  )
  returning id into v_rec_id;

  -- recommendation items
  for v_team in select jsonb_array_elements(coalesce(input_payload->'assignments', '[]'::jsonb))
  loop
    v_court_no := coalesce((v_team->>'courtNo')::int, 0);
    if v_court_no < 1 then
      continue;
    end if;

    -- team1
    for v_participant_id in
      select (x->>'participantId')::uuid
      from jsonb_array_elements(coalesce(v_team->'team1','[]'::jsonb)) as x
    loop
      insert into public.assignment_recommendation_items (
        recommendation_id, court_no, team_no, participant_id
      ) values (v_rec_id, v_court_no, 1, v_participant_id);
    end loop;

    -- team2
    for v_participant_id in
      select (x->>'participantId')::uuid
      from jsonb_array_elements(coalesce(v_team->'team2','[]'::jsonb)) as x
    loop
      insert into public.assignment_recommendation_items (
        recommendation_id, court_no, team_no, participant_id
      ) values (v_rec_id, v_court_no, 2, v_participant_id);
    end loop;
  end loop;

  insert into public.rounds (
    session_id, round_no, status, recommendation_id
  ) values (
    input_session_id, input_round_no, 'draft', v_rec_id
  )
  returning id into v_round_id;

  -- Create matches & teams using recommendation items as source of truth
  for v_court_no in
    select distinct court_no
    from public.assignment_recommendation_items
    where recommendation_id = v_rec_id
    order by court_no
  loop
    insert into public.matches (session_id, round_id, court_no, match_label)
    values (input_session_id, v_round_id, v_court_no, format('R%s-C%s', input_round_no, v_court_no))
    returning id into v_match_id;

    insert into public.match_teams (match_id, team_no) values (v_match_id, 1) returning id into v_t1_id;
    insert into public.match_teams (match_id, team_no) values (v_match_id, 2) returning id into v_t2_id;

    insert into public.match_team_players (match_team_id, participant_id)
    select v_t1_id, participant_id
    from public.assignment_recommendation_items
    where recommendation_id = v_rec_id and court_no = v_court_no and team_no = 1;

    insert into public.match_team_players (match_team_id, participant_id)
    select v_t2_id, participant_id
    from public.assignment_recommendation_items
    where recommendation_id = v_rec_id and court_no = v_court_no and team_no = 2;
  end loop;

  return v_round_id;
end;
$$;

grant execute on function public.apply_assignment_recommendation_and_create_round(uuid, integer, jsonb) to authenticated, service_role;

