-- 080_public_and_dropins_venue_map_link_diagnostics.sql
-- 公開報名頁 / 臨打列表 venue 與 Google 導航相關欄位檢查（僅 SELECT）。

-- 1) venues 欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'venues'
order by ordinal_position;

-- 2) 最近 20 筆 venues（地圖相關欄位）
select id,
       name,
       address_text,
       full_address,
       city,
       district,
       google_maps_url
from public.venues
order by created_at desc
limit 20;

-- 3) 有 google_maps_url 的 venues
select id, name, google_maps_url
from public.venues
where google_maps_url is not null
  and trim(google_maps_url) <> ''
order by name
limit 50;

-- 4) 沒有 google_maps_url 但有 full_address 或 address_text
select id,
       name,
       google_maps_url,
       full_address,
       address_text
from public.venues
where (google_maps_url is null or trim(google_maps_url) = '')
  and (
    (full_address is not null and trim(full_address) <> '')
    or (address_text is not null and trim(address_text) <> '')
  )
order by name
limit 50;

-- 5) /s/[code] 可能載入的 session + venue（有 share_signup_code）
select s.id,
       s.title,
       s.share_signup_code,
       s.status,
       s.venue_id,
       v.name as venue_name,
       v.full_address,
       v.address_text,
       v.city,
       v.district,
       v.google_maps_url
from public.sessions s
left join public.venues v on v.id = s.venue_id
where s.share_signup_code is not null
order by s.updated_at desc
limit 30;

-- 6) /member-dashboard/dropins 會列出的 registration_open sessions 與 venue 地圖資料
select s.id,
       s.title,
       s.share_signup_code,
       s.status,
       v.name as venue_name,
       v.full_address,
       v.address_text,
       v.city,
       v.district,
       v.google_maps_url
from public.sessions s
left join public.venues v on v.id = s.venue_id
where s.allow_self_signup = true
  and s.share_signup_code is not null
  and s.status = 'registration_open'::public.session_status_type
order by s.start_at asc
limit 50;

-- 7) google_maps_url 疑似不安全（非 http/https 開頭）
select id,
       name,
       google_maps_url
from public.venues
where google_maps_url is not null
  and trim(google_maps_url) <> ''
  and trim(google_maps_url) not ilike 'http%';

-- 8) full_address 含「桃園市」「中壢區」字樣（地址解析抽樣）
select id,
       name,
       full_address,
       address_text,
       city,
       district
from public.venues
where (full_address like '%桃園市%' and full_address like '%中壢區%')
   or (address_text like '%桃園市%' and address_text like '%中壢區%')
limit 30;
