-- 每面場獨立輪次：rounds / assignment_recommendations 增加 court_no，
-- 並將 unique(session_id, round_no) 改為 unique(session_id, court_no, round_no)。
-- 若既有資料「一輪多場」會拆成多筆 rounds（僅第一面場保留原 recommendation_id）。

begin;

alter table public.assignment_recommendations
  add column if not exists court_no integer;

alter table public.rounds
  add column if not exists court_no integer;

update public.assignment_recommendations
set court_no = 1
where court_no is null;

-- 必須先移除舊 unique(session_id, round_no)，否則下方為各面場 insert 新 rounds 列時，
-- 會與既有列同一 session_id + round_no 而觸發 rounds_session_id_round_no_key（23505）。
alter table public.rounds
  drop constraint if exists rounds_session_id_round_no_key;

-- 先拆 rounds：同一 round_id 若有多個 court_no 的 matches，為非最小 court 建立新 rounds 列並搬移 matches
do $$
declare
  -- 勿命名為 r：在 UPDATE ... r 時會與表別名衝突，導致 r.id 變成「迴圈 record」而報 42703
  mr record;
  courts int[];
  c int;
  keep_court int;
  new_round_id uuid;
  rid uuid;
  rsession uuid;
  rno int;
  rstat public.round_status_type;
  rrec uuid;
  rlocked timestamptz;
  rlocked_by uuid;
  rfin timestamptz;
  rfin_by uuid;
  i int;
begin
  for mr in
    select r0.id as round_id
    from public.rounds r0
    join public.matches m on m.round_id = r0.id
    group by r0.id
    having count(distinct m.court_no) > 1
  loop
    select array_agg(distinct m.court_no order by m.court_no)
      into courts
    from public.matches m
    where m.round_id = mr.round_id;

    keep_court := courts[1];

    select id, session_id, round_no, status, recommendation_id, locked_at, locked_by_user_id, finished_at, finished_by_user_id
      into rid, rsession, rno, rstat, rrec, rlocked, rlocked_by, rfin, rfin_by
    from public.rounds
    where id = mr.round_id;

    update public.rounds
    set court_no = keep_court
    where id = rid;

    for i in 2..array_length(courts, 1)
    loop
      c := courts[i];
      new_round_id := gen_random_uuid();
      insert into public.rounds (
        id, session_id, court_no, round_no, status, recommendation_id,
        locked_at, locked_by_user_id, finished_at, finished_by_user_id
      ) values (
        new_round_id, rsession, c, rno, rstat, null,
        rlocked, rlocked_by, rfin, rfin_by
      );

      update public.matches
      set round_id = new_round_id
      where round_id = rid
        and court_no = c;
    end loop;
  end loop;

  -- 其餘 rounds：由唯一 match 推 court_no
  update public.rounds r
  set court_no = sub.court_no
  from (
    select m.round_id, min(m.court_no) as court_no
    from public.matches m
    group by m.round_id
  ) sub
  where r.id = sub.round_id
    and r.court_no is null;

  update public.rounds
  set court_no = 1
  where court_no is null;

  update public.assignment_recommendations ar
  set court_no = coalesce((
    select min(ari.court_no)
    from public.assignment_recommendation_items ari
    where ari.recommendation_id = ar.id
  ), 1)
  where ar.court_no is null;
end;
$$;

alter table public.assignment_recommendations
  alter column court_no set not null;

alter table public.rounds
  alter column court_no set not null;

alter table public.rounds
  add constraint rounds_session_court_round_uniq unique (session_id, court_no, round_no);

create index if not exists idx_rounds_session_court on public.rounds(session_id, court_no);

commit;
