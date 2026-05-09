-- 067_add_session_physical_court_no_helper.sql
-- 新增 helper：public.session_physical_court_no(session_id, court_slot)
-- 用途：將「面場 slot（1..N）」對應到「實體場號（如 5、6）」供顯示/診斷使用

begin;

create or replace function public.session_physical_court_no(
  p_session_id uuid,
  p_court_slot integer
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_court_no integer;
  v_raw text;
begin
  -- A) 優先：session_courts.sort_order -> court_no
  select sc.court_no
  into v_court_no
  from public.session_courts sc
  where sc.session_id = p_session_id
    and sc.sort_order = p_court_slot
  order by sc.sort_order asc
  limit 1;

  if v_court_no is not null then
    return v_court_no;
  end if;

  -- B) fallback：sessions.metadata.rented_court_nos（1-based slot -> 0-based json index）
  select s.metadata -> 'rented_court_nos' ->> (greatest(p_court_slot, 1) - 1)
  into v_raw
  from public.sessions s
  where s.id = p_session_id
  limit 1;

  if v_raw is not null and length(btrim(v_raw)) > 0 then
    v_court_no := nullif(btrim(v_raw), '')::integer;
    if v_court_no is not null then
      return v_court_no;
    end if;
  end if;

  -- C) fallback：sessions.metadata.rented_court_numbers
  select s.metadata -> 'rented_court_numbers' ->> (greatest(p_court_slot, 1) - 1)
  into v_raw
  from public.sessions s
  where s.id = p_session_id
  limit 1;

  if v_raw is not null and length(btrim(v_raw)) > 0 then
    v_court_no := nullif(btrim(v_raw), '')::integer;
    if v_court_no is not null then
      return v_court_no;
    end if;
  end if;

  -- D) 最後 fallback：回傳 slot 本身（避免頁面壞掉）
  return greatest(p_court_slot, 1);
end;
$$;

grant execute on function public.session_physical_court_no(uuid, integer) to authenticated, anon, service_role;

commit;

