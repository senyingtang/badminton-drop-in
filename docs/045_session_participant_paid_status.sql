-- 045: 場次參與者繳費狀態（主辦可切換未繳費 <-> 已繳費）
--
-- 目的：
-- - 在後台「正選名單」可勾選/取消「已繳費」
-- - 最小 schema 變更：以 paid_at 是否為 null 表示繳費狀態

alter table public.session_participants
  add column if not exists paid_at timestamptz null;

comment on column public.session_participants.paid_at is '繳費完成時間；null 表示未繳費';

create or replace function public.host_set_participant_paid_status(
  input_session_participant_id uuid,
  input_is_paid boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  select sp.session_id
    into v_session_id
  from public.session_participants sp
  where sp.id = input_session_participant_id
    and sp.is_removed = false
  limit 1;

  if v_session_id is null then
    raise exception 'not_found';
  end if;

  if not public.user_can_access_session(v_session_id) then
    raise exception 'forbidden';
  end if;

  update public.session_participants sp
    set paid_at = case when input_is_paid then now() else null end,
        updated_at = now()
  where sp.id = input_session_participant_id;
end;
$$;

grant execute on function public.host_set_participant_paid_status(uuid, boolean) to authenticated, service_role;

