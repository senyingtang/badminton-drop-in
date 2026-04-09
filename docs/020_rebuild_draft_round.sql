-- Delete a draft round and its recommendation (host/admin only), to allow rebuild/regenerate.
create or replace function public.host_delete_draft_round(
  input_round_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rounds%rowtype;
  v_session public.sessions%rowtype;
  v_rec_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  select * into v_round
  from public.rounds
  where id = input_round_id
  for update;

  if not found then
    raise exception 'round not found';
  end if;

  if v_round.status <> 'draft' then
    raise exception 'round_not_draft';
  end if;

  select * into v_session
  from public.sessions
  where id = v_round.session_id;

  if not found then
    raise exception 'session not found';
  end if;

  if not public.user_is_session_host(v_round.session_id)
     and not public.user_manages_venue(v_session.venue_id)
     and not public.is_platform_admin()
  then
    raise exception 'forbidden';
  end if;

  v_rec_id := v_round.recommendation_id;

  -- deleting round cascades matches → match_teams → match_team_players
  delete from public.rounds where id = input_round_id;

  if v_rec_id is not null then
    delete from public.assignment_recommendation_items where recommendation_id = v_rec_id;
    delete from public.assignment_recommendations where id = v_rec_id;
  end if;

  insert into public.session_events (
    session_id,
    actor_user_id,
    event_type,
    payload
  ) values (
    v_round.session_id,
    auth.uid(),
    'round_deleted',
    jsonb_build_object('round_id', input_round_id)
  );
end;
$$;

grant execute on function public.host_delete_draft_round(uuid) to authenticated, service_role;

