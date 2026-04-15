-- 比分更正審計：當 matches 的比分欄位變更時，寫入 public.audit_logs。
-- 目的：保留「誰在何時更正比分」的可追溯性（不影響前端流程）。

begin;

create or replace function public.audit_match_score_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_json jsonb;
  after_json jsonb;
begin
  -- 只針對比分/勝隊欄位有變更時記錄（避免每次更新 matches 其他欄位都打 log）
  if (coalesce(old.final_score_team_1, -1) = coalesce(new.final_score_team_1, -1))
     and (coalesce(old.final_score_team_2, -1) = coalesce(new.final_score_team_2, -1))
     and (coalesce(old.winning_team_no, -1) = coalesce(new.winning_team_no, -1))
  then
    return new;
  end if;

  before_json := jsonb_build_object(
    'final_score_team_1', old.final_score_team_1,
    'final_score_team_2', old.final_score_team_2,
    'winning_team_no', old.winning_team_no,
    'confirmed_by_user_id', old.confirmed_by_user_id,
    'confirmed_at', old.confirmed_at
  );

  after_json := jsonb_build_object(
    'final_score_team_1', new.final_score_team_1,
    'final_score_team_2', new.final_score_team_2,
    'winning_team_no', new.winning_team_no,
    'confirmed_by_user_id', new.confirmed_by_user_id,
    'confirmed_at', new.confirmed_at
  );

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_table,
    entity_id,
    before_data,
    after_data,
    meta
  ) values (
    auth.uid(),
    'update',
    'matches',
    new.id,
    before_json,
    after_json,
    jsonb_build_object('event', 'match_score_change')
  );

  return new;
end;
$$;

drop trigger if exists trg_audit_match_score_change on public.matches;
create trigger trg_audit_match_score_change
after update on public.matches
for each row
execute function public.audit_match_score_change();

commit;

