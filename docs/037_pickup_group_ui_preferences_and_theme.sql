-- 037: 臨打團後端設定（UI 偏好 + 主題配色）與公開讀取 RPC
-- 用途：
-- 1) 團主可在 /pickup-group/settings 設定「租借場地顯示方式」與「主題配色」
-- 2) 公開報名頁 /s/[code] 透過 share code 安全讀取（不開放整表 select 給 anon）

alter table public.pickup_group_settings
  add column if not exists rented_courts_display_mode text not null default 'below',
  add column if not exists theme_preset text not null default 'indigo',
  add column if not exists theme_custom jsonb not null default '{}'::jsonb;

-- 基本合法值約束（避免打錯字造成前端不可預期）
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_pickup_group_settings_rented_courts_display_mode'
  ) then
    alter table public.pickup_group_settings
      add constraint chk_pickup_group_settings_rented_courts_display_mode
      check (rented_courts_display_mode in ('below', 'inline'));
  end if;
end $$;

-- 供公開報名頁（anon）以 share code 查詢團主的 UI 偏好與主題配色
-- SECURITY DEFINER：避免必須開放 pickup_group_settings 的 select 給 anon
create or replace function public.get_public_pickup_group_prefs_by_share_code(p_share_code text)
returns table (
  rented_courts_display_mode text,
  theme_preset text,
  theme_custom jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_host uuid;
begin
  if p_share_code is null or btrim(p_share_code) = '' then
    return;
  end if;

  select s.host_user_id
    into v_host
  from public.sessions s
  where s.share_signup_code is not null
    and lower(s.share_signup_code) = lower(btrim(p_share_code))
  limit 1;

  if v_host is null then
    return;
  end if;

  return query
  select
    coalesce(pgs.rented_courts_display_mode, 'below') as rented_courts_display_mode,
    coalesce(pgs.theme_preset, 'indigo') as theme_preset,
    coalesce(pgs.theme_custom, '{}'::jsonb) as theme_custom
  from public.pickup_group_settings pgs
  where pgs.host_user_id = v_host
  limit 1;
end;
$$;

-- 權限：開放匿名/已登入皆可執行（函式自行以 share code 限制資料範圍）
grant execute on function public.get_public_pickup_group_prefs_by_share_code(text) to anon, authenticated;

