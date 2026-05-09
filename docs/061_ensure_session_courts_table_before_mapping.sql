-- 061_ensure_session_courts_table_before_mapping.sql
-- 新場次專用：確保 session_courts 表存在，且團主／管理員可讀寫（供前端建立場次後 insert）。
-- 不含舊場次 rounds/matches 修復、不含 sessions.metadata 批次更新（如 058_court_physical_done）。
-- 可重複執行。

begin;

create table if not exists public.session_courts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  court_no integer not null,
  label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint chk_session_courts_court_no check (court_no >= 1)
);

create unique index if not exists uq_session_courts_session_sort
  on public.session_courts(session_id, sort_order);

create index if not exists idx_session_courts_session on public.session_courts(session_id);

comment on table public.session_courts is '場次實際租借面場：sort_order 為排組 1..N 序，court_no 為球館場地編號';

alter table public.session_courts enable row level security;

drop policy if exists session_courts_select_access on public.session_courts;
create policy session_courts_select_access
on public.session_courts
for select
using (public.user_can_access_session(session_id));

-- 移除「禁止所有寫入」舊政策（若存在），改為僅主辦／平台管理員可寫
drop policy if exists session_courts_no_direct_write on public.session_courts;

drop policy if exists session_courts_insert_host on public.session_courts;
create policy session_courts_insert_host
on public.session_courts
for insert
with check (
  public.user_is_session_host(session_id)
  or public.is_platform_admin()
);

drop policy if exists session_courts_update_host on public.session_courts;
create policy session_courts_update_host
on public.session_courts
for update
using (
  public.user_is_session_host(session_id)
  or public.is_platform_admin()
)
with check (
  public.user_is_session_host(session_id)
  or public.is_platform_admin()
);

drop policy if exists session_courts_delete_host on public.session_courts;
create policy session_courts_delete_host
on public.session_courts
for delete
using (
  public.user_is_session_host(session_id)
  or public.is_platform_admin()
);

grant select, insert, update, delete on public.session_courts to authenticated;
grant all on public.session_courts to service_role;

-- PostgREST / Supabase：重載 schema cache（新表或新政策後建議執行）
notify pgrst, 'reload schema';

commit;
