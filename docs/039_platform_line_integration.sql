-- 039: 平台 LINE 整合設定（管理後台維護）+ RLS
-- 用途：
-- 1) 儲存 LINE Messaging API（Channel access token 等）與 LINE Login 通道資訊（供後續綁定／驗證用）
-- 2) 僅 platform_admin 可讀寫；應用程式以 service_role 讀取後呼叫 LINE Push API
--
-- 部署後請在 Vercel／執行環境設定 SUPABASE_SERVICE_ROLE_KEY，否則「候補轉正選通知」API 無法讀取權杖。

create table if not exists public.platform_line_integration (
  id smallint primary key default 1,
  constraint platform_line_integration_singleton check (id = 1),
  messaging_channel_id text,
  messaging_channel_secret text,
  messaging_channel_access_token text,
  login_channel_id text,
  login_channel_secret text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_user_profiles (id) on delete set null
);

insert into public.platform_line_integration (id)
values (1)
on conflict (id) do nothing;

drop trigger if exists trg_platform_line_integration_updated_at on public.platform_line_integration;
create trigger trg_platform_line_integration_updated_at
before update on public.platform_line_integration
for each row execute function public.set_updated_at();

alter table public.platform_line_integration enable row level security;

drop policy if exists platform_line_integration_select_admin on public.platform_line_integration;
create policy platform_line_integration_select_admin
on public.platform_line_integration
for select
using (public.is_platform_admin());

drop policy if exists platform_line_integration_insert_admin on public.platform_line_integration;
create policy platform_line_integration_insert_admin
on public.platform_line_integration
for insert
with check (public.is_platform_admin());

drop policy if exists platform_line_integration_update_admin on public.platform_line_integration;
create policy platform_line_integration_update_admin
on public.platform_line_integration
for update
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists platform_line_integration_delete_admin on public.platform_line_integration;
create policy platform_line_integration_delete_admin
on public.platform_line_integration
for delete
using (public.is_platform_admin());

grant select, insert, update, delete on public.platform_line_integration to authenticated;
grant all on public.platform_line_integration to service_role;

comment on table public.platform_line_integration is '平台級 LINE 設定（僅 platform_admin 可經 API／管理後台維護；場次團主不可寫入）。Messaging access token 僅供伺服端讀取，勿對外公開。';
comment on column public.platform_line_integration.messaging_channel_access_token is 'LINE Messaging API Channel access token（長效）';
comment on column public.platform_line_integration.login_channel_id is 'LINE Login Channel ID';
comment on column public.platform_line_integration.login_channel_secret is 'LINE Login Channel secret';
