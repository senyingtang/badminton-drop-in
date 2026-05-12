-- 077_member_dropins_open_sessions_diagnostics.sql
-- 會員臨打列表：僅 SELECT，不修改資料。
-- 用途：確認 sessions 欄位、status enum、仍可報名條件、venue、session_courts、報名路徑與地址欄位。

-- 1) sessions 欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'sessions'
order by ordinal_position;

-- 2) session_status_type enum values
select e.enumlabel as session_status
from pg_type t
join pg_enum e on t.oid = e.enumtypid
join pg_catalog.pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname = 'session_status_type'
order by e.enumsortorder;

-- 3) 仍可報名條件（與 /api/member/dropins/open 一致：registration_open）
select s.id,
       s.title,
       s.status,
       s.allow_self_signup,
       s.share_signup_code,
       s.start_at
from public.sessions s
where s.allow_self_signup = true
  and s.share_signup_code is not null
  and s.status = 'registration_open'::public.session_status_type
order by s.start_at asc
limit 50;

-- 4) 上述場次的 venue（僅實際存在欄位）
select v.id,
       v.name,
       v.address_text,
       v.city,
       v.district
from public.venues v
where v.id in (
  select distinct s.venue_id
  from public.sessions s
  where s.allow_self_signup = true
    and s.share_signup_code is not null
    and s.status = 'registration_open'::public.session_status_type
    and s.venue_id is not null
)
order by v.name;

-- 5) 上述場次的 session_courts
select sc.session_id,
       sc.sort_order,
       sc.court_no,
       sc.label
from public.session_courts sc
where sc.session_id in (
  select s.id
  from public.sessions s
  where s.allow_self_signup = true
    and s.share_signup_code is not null
    and s.status = 'registration_open'::public.session_status_type
)
order by sc.session_id, sc.sort_order;

-- 6) 組合報名連結（相對路徑；完整網址由前端加上 origin）
select s.id,
       s.title,
       s.share_signup_code,
       ('/s/' || s.share_signup_code) as registration_path
from public.sessions s
where s.allow_self_signup = true
  and s.share_signup_code is not null
  and s.status = 'registration_open'::public.session_status_type
order by s.start_at asc
limit 50;

-- 7) 地址解析用測試：address_text 是否含常見縣市／區域字樣
select v.id,
       v.name,
       v.city,
       v.district,
       v.address_text,
       (v.address_text ~ '桃園市|新北市|台北市|臺北市|台中市|臺中市') as address_likely_has_county_zh,
       (v.address_text ~ '區|鄉|鎮') as address_likely_has_district_zh,
       (v.address_text ~* 'city|district') as address_has_english_place
from public.venues v
where v.id in (
  select distinct s.venue_id
  from public.sessions s
  where s.allow_self_signup = true
    and s.share_signup_code is not null
    and s.status = 'registration_open'::public.session_status_type
    and s.venue_id is not null
)
order by v.name;

-- 8) 疑似重複 share_signup_code（應為 unique；若出現多筆請檢查約束）
select s.share_signup_code,
       count(*)::bigint as cnt
from public.sessions s
where s.share_signup_code is not null
group by s.share_signup_code
having count(*) > 1;
