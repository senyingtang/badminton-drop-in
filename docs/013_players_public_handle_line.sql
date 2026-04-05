-- 球員公開識別名（英數＋底線，供日後 LINE / 認領流程）
-- line_user_id：LINE Login 的 sub，綁定成功後由後端寫入

alter table public.players
  add column if not exists public_handle citext null,
  add column if not exists line_user_id text null;

comment on column public.players.public_handle is '使用者自訂英數識別名（3–30），唯一、可選，供認領／第三方綁定參考';
comment on column public.players.line_user_id is 'LINE Login 使用者識別（sub），唯一、可選';

create unique index if not exists uq_players_public_handle
  on public.players (public_handle)
  where public_handle is not null;

create unique index if not exists uq_players_line_user_id
  on public.players (line_user_id)
  where line_user_id is not null;

alter table public.players drop constraint if exists chk_players_public_handle_format;

alter table public.players
  add constraint chk_players_public_handle_format
  check (
    public_handle is null
    or (public_handle::text ~ '^[a-zA-Z0-9_]{3,30}$')
  );
