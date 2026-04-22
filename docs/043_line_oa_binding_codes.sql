-- 043: LINE OA 綁定碼 + players 欄位（LINE@ 推播用）
--
-- 目的：
-- - 使用者可在站內產生一次性綁定碼
-- - 使用者到 LINE@ 聊天室輸入「綁定 <代碼>」
-- - Webhook 以綁定碼找到對應 player，寫入 players.line_oa_user_id（LINE UID）
--
-- 設計：
-- - 綁定碼與綁定處理皆由伺服端（service_role）執行，因此本 migration 將表的 RLS 預設鎖死
-- - 後續若要開放前端直接查詢，可再加 security definer RPC

alter table public.players
  add column if not exists line_oa_user_id text null;

comment on column public.players.line_oa_user_id is 'LINE 官方帳號（OA）userId，用於推播通知；由 LINE webhook 綁定流程寫入';

create unique index if not exists uq_players_line_oa_user_id
  on public.players (line_oa_user_id)
  where line_oa_user_id is not null;

create table if not exists public.line_oa_binding_codes (
  code text primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  used_line_oa_user_id text null
);

create index if not exists idx_line_oa_binding_codes_player on public.line_oa_binding_codes(player_id);
create index if not exists idx_line_oa_binding_codes_expires on public.line_oa_binding_codes(expires_at);
create index if not exists idx_line_oa_binding_codes_used_at on public.line_oa_binding_codes(used_at);

comment on table public.line_oa_binding_codes is 'LINE OA 綁定碼（一次性、短效）；僅伺服端可讀寫';

alter table public.line_oa_binding_codes enable row level security;

-- 預設鎖死（僅 service_role 可用）
drop policy if exists line_oa_binding_codes_deny_all on public.line_oa_binding_codes;
create policy line_oa_binding_codes_deny_all
on public.line_oa_binding_codes
for all
using (false)
with check (false);

grant all on public.line_oa_binding_codes to service_role;

