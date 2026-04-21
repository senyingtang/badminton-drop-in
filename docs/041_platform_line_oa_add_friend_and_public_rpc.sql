-- 041: 平台 LINE@ 加好友連結（公開報名頁 Pop-up 用）+ 公開讀取 RPC
--
-- 目的：
-- - 管理後台可維護 LINE 官方帳號（OA）的「加好友連結」
-- - 公開報名頁 /s/[code]（anon）可安全取得該連結，用於提示加入 LINE@ 才能收到名單異動通知
--
-- 注意：
-- - 只公開 oa_add_friend_url；不公開 Messaging access token 等敏感資訊

alter table public.platform_line_integration
  add column if not exists oa_add_friend_url text;

comment on column public.platform_line_integration.oa_add_friend_url is 'LINE 官方帳號加好友連結（例如 https://lin.ee/xxxxx），供公開報名頁提示加入 LINE@';

create or replace function public.get_public_platform_line_oa()
returns table (
  oa_add_friend_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select pli.oa_add_friend_url
  from public.platform_line_integration pli
  where pli.id = 1
  limit 1;
$$;

grant execute on function public.get_public_platform_line_oa() to anon, authenticated;

