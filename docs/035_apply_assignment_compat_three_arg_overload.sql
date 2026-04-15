-- 與 030 並存的三參數 overload：供 PostgREST schema cache／舊版前端仍打三參數時使用。
-- 內部依 payload.assignments 內的 courtNo 去重後，逐一呼叫四參數版本（同筆 payload 傳入，030 會依 input_court_no 過濾）。
-- 須已套用 029、030。
--
-- 若 assignments 為空或無任何有效 courtNo，改為只對 1 號場呼叫一次（避免舊 payload 全缺 courtNo 時完全失敗）。

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
  v_cn integer;
  v_last uuid;
  v_found boolean := false;
begin
  for v_cn in
    select distinct c
    from (
      select case
        when (x->>'courtNo') is null or btrim(x->>'courtNo') = '' then null
        when (x->>'courtNo') ~ '^[0-9]+$' then (x->>'courtNo')::int
        else null
      end as c
      from jsonb_array_elements(coalesce(input_payload->'assignments', '[]'::jsonb)) as x
    ) s
    where c is not null and c >= 1
    order by 1
  loop
    v_found := true;
    v_last := public.apply_assignment_recommendation_and_create_round(
      input_session_id,
      v_cn,
      input_round_no,
      input_payload
    );
  end loop;

  if v_found then
    return v_last;
  end if;

  return public.apply_assignment_recommendation_and_create_round(
    input_session_id,
    1,
    input_round_no,
    input_payload
  );
end;
$$;

grant execute on function public.apply_assignment_recommendation_and_create_round(uuid, integer, jsonb) to authenticated, service_role;
