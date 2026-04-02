-- =========================
-- RPC: Lock Round (開打)
-- =========================
create or replace function public.kb_lock_round(p_round_id uuid)
returns void
language plpgsql
security definer
as $$
declare
    v_session_id uuid;
    v_user_id uuid;
begin
    v_user_id := auth.uid();

    select session_id into v_session_id
    from kb_rounds
    where id = p_round_id;

    -- 檢查權限（只能團主）
    if not exists (
        select 1 from kb_sessions
        where id = v_session_id
        and host_user_id = v_user_id
    ) then
        raise exception 'No permission';
    end if;

    update kb_rounds
    set status = 'locked',
        started_at = now()
    where id = p_round_id;

    -- 更新出賽次數
    update kb_session_players
    set match_count = match_count + 1,
        consecutive_play = consecutive_play + 1
    where id in (
        select player_id
        from kb_round_teams
        where round_id = p_round_id
    );

end;
$$;

-- =========================
-- RPC: Finish Round
-- =========================
create or replace function public.kb_finish_round(p_round_id uuid)
returns void
language plpgsql
security definer
as $$
begin
    update kb_rounds
    set status = 'finished',
        ended_at = now()
    where id = p_round_id;

    -- 重置未上場者連打
    update kb_session_players
    set consecutive_play = 0
    where id not in (
        select player_id
        from kb_round_teams
        where round_id = p_round_id
    );
end;
$$;

-- =========================
-- VIEW: 玩家統計
-- =========================
create or replace view kb_player_stats as
select
    p.id,
    p.nickname,
    avg(r.rating) as avg_rating,
    count(r.id) as rating_count
from kb_players p
left join kb_player_ratings r on r.player_id = p.id
group by p.id;