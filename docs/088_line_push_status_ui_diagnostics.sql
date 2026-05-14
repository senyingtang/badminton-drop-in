-- 088_line_push_status_ui_diagnostics.sql
-- 團主正選名單 LINE 推播狀態（與 086 recipient 規則一致；read-only）
-- recipient：notification_user_id → registered_by_user_id → players.auth_user_id（該列 participant）
-- 可推播：該 recipient 對應 players 之 line_oa_user_id 或 line_user_id 任一非空白。

-- 1) 依場次：正選（含遞補）可推播 / 不可推播人數（最近 30 天內建立之參與列）
-- 邏輯對齊 web 087 第 13 段（代報僅看 nu_pl，自報看 p）
select
  sp.session_id,
  s.title as session_title,
  count(*) filter (where
    case
      when sp.is_guest_registration and sp.notification_user_id is not null then
        coalesce(
          nullif(trim(nu_pl.line_oa_user_id), ''),
          nullif(trim(nu_pl.line_user_id), '')
        ) is not null
      else
        coalesce(
          nullif(trim(p.line_oa_user_id), ''),
          nullif(trim(p.line_user_id), '')
        ) is not null
    end
  ) as pushable_main_cnt,
  count(*) filter (where
    case
      when sp.is_guest_registration and sp.notification_user_id is not null then
        coalesce(
          nullif(trim(nu_pl.line_oa_user_id), ''),
          nullif(trim(nu_pl.line_user_id), '')
        ) is null
      else
        coalesce(
          nullif(trim(p.line_oa_user_id), ''),
          nullif(trim(p.line_user_id), '')
        ) is null
    end
  ) as not_pushable_main_cnt
from public.session_participants sp
join public.sessions s on s.id = sp.session_id
join public.players p on p.id = sp.player_id
left join public.app_user_profiles ap_nu on ap_nu.id = sp.notification_user_id
left join public.players nu_pl on nu_pl.auth_user_id = ap_nu.id
where sp.is_removed = false
  and sp.status in ('confirmed_main', 'promoted_from_waitlist')
  and sp.created_at > now() - interval '30 days'
group by sp.session_id, s.title
having count(*) > 0
order by sp.session_id desc;

-- 2) 指定 session：不可推播名單（將 :session_id 換成 uuid）
-- select
--   sp.id as session_participant_id,
--   coalesce(nullif(trim(sp.guest_display_name), ''), nullif(trim(sp.session_display_name), ''), p.display_name) as display_label,
--   sp.is_guest_registration,
--   sp.notification_user_id,
--   sp.registered_by_user_id,
--   p.line_oa_user_id as row_player_line_oa,
--   p.line_user_id as row_player_line_login,
--   nu_pl.line_oa_user_id as notify_line_oa,
--   nu_pl.line_user_id as notify_line_login
-- from public.session_participants sp
-- join public.players p on p.id = sp.player_id
-- left join public.app_user_profiles ap_nu on ap_nu.id = sp.notification_user_id
-- left join public.players nu_pl on nu_pl.auth_user_id = ap_nu.id
-- where sp.session_id = :session_id
--   and sp.is_removed = false
--   and sp.status in ('confirmed_main', 'promoted_from_waitlist')
--   and case
--     when sp.is_guest_registration and sp.notification_user_id is not null then
--       coalesce(nullif(trim(nu_pl.line_oa_user_id), ''), nullif(trim(nu_pl.line_user_id), '')) is null
--     else
--       coalesce(nullif(trim(p.line_oa_user_id), ''), nullif(trim(p.line_user_id), '')) is null
--   end
-- order by sp.created_at;

-- 3) 代報名：notification_user_id 對應 player 是否可推播（最近 50 筆）
select
  sp.id as session_participant_id,
  sp.session_id,
  sp.notification_user_id,
  coalesce(
    nullif(trim(nu_pl.line_oa_user_id), ''),
    nullif(trim(nu_pl.line_user_id), '')
  ) is not null as notification_recipient_pushable
from public.session_participants sp
left join public.app_user_profiles ap on ap.id = sp.notification_user_id
left join public.players nu_pl on nu_pl.auth_user_id = ap.id
where sp.is_removed = false
  and sp.is_guest_registration = true
  and sp.notification_user_id is not null
order by sp.created_at desc
limit 50;

-- 4) 正選 participant 之「列 player」LINE 欄位（非 recipient；僅供對照代報情境）
select sp.id, sp.session_id, sp.is_guest_registration, p.line_oa_user_id, p.line_user_id
from public.session_participants sp
join public.players p on p.id = sp.player_id
where sp.is_removed = false
  and sp.status in ('confirmed_main', 'promoted_from_waitlist')
order by sp.created_at desc
limit 50;
