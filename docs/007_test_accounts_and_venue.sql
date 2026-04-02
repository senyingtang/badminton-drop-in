-- 007_test_accounts_and_venue.sql
-- 建立測試帳號與第一個正式場館

BEGIN;

-- 1. 清理舊資料 (選擇性)
-- DELETE FROM auth.users WHERE email IN ('admin@example.com', 'owner@example.com', 'host@example.com', 'player@example.com');

-- 2. 建立測試帳號 Helper
-- 注意：這是在資料庫層級直接插入，密碼為 'password123'
-- Supabase 的 auth.users 密碼加密方式通常是 bcrypt

-- 宣告變數
DO $$
DECLARE
  v_admin_id uuid := gen_random_uuid();
  v_owner_id uuid := gen_random_uuid();
  v_host_id uuid := gen_random_uuid();
  v_player_id uuid := gen_random_uuid();
  v_venue_id uuid := gen_random_uuid();
  v_password_hash text := crypt('password123', gen_salt('bf'));
BEGIN

  -- 建立 Auth Users
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud)
  VALUES 
    (v_admin_id, '00000000-0000-0000-0000-000000000000', 'admin@example.com', v_password_hash, now(), '{"provider":"email","providers":["email"]}', '{"display_name":"平台管理員"}', now(), now(), 'authenticated', 'authenticated'),
    (v_owner_id, '00000000-0000-0000-0000-000000000000', 'owner@example.com', v_password_hash, now(), '{"provider":"email","providers":["email"]}', '{"display_name":"林口場主"}', now(), now(), 'authenticated', 'authenticated'),
    (v_host_id, '00000000-0000-0000-0000-000000000000', 'host@example.com', v_password_hash, now(), '{"provider":"email","providers":["email"]}', '{"display_name":"熱血團主"}', now(), now(), 'authenticated', 'authenticated'),
    (v_player_id, '00000000-0000-0000-0000-000000000000', 'player@example.com', v_password_hash, now(), '{"provider":"email","providers":["email"]}', '{"display_name":"羽球新手"}', now(), now(), 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  -- 建立 App User Profiles
  INSERT INTO public.app_user_profiles (id, display_name, primary_role)
  VALUES 
    (v_admin_id, '平台管理員', 'platform_admin'),
    (v_owner_id, '林口場主', 'venue_owner'),
    (v_host_id, '熱血團主', 'host'),
    (v_player_id, '羽球新手', 'player')
  ON CONFLICT (id) DO NOTHING;

  -- 建立角色會員資格
  INSERT INTO public.user_role_memberships (user_id, role)
  VALUES 
    (v_admin_id, 'platform_admin'),
    (v_owner_id, 'venue_owner'),
    (v_host_id, 'host'),
    (v_player_id, 'player')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 建立球員主檔 (供測試搜尋)
  INSERT INTO public.players (auth_user_id, player_code, display_name, gender)
  VALUES (v_player_id, 'player001', '羽球新手', 'male')
  ON CONFLICT (player_code) DO NOTHING;

  -- 建立場館：飛。羽球館H-FLYING
  INSERT INTO public.venues (id, owner_user_id, name, address_text, city, district, description)
  VALUES (
    v_venue_id, 
    v_owner_id, 
    '飛。羽球館H-FLYING', 
    '菁埔39之41號', 
    '新北市', 
    '林口區', 
    '挑高9米、側邊防眩光照明、獨立男女淋浴淋浴間、提供免費停車位及Wi-Fi。'
  )
  ON CONFLICT (id) DO NOTHING;

  -- 建立 6 面球場
  INSERT INTO public.courts (venue_id, court_no, name)
  VALUES 
    (v_venue_id, 1, '1號場'),
    (v_venue_id, 2, '2號場'),
    (v_venue_id, 3, '3號場'),
    (v_venue_id, 4, '4號場'),
    (v_venue_id, 5, '5號場'),
    (v_venue_id, 6, '6號場')
  ON CONFLICT (venue_id, court_no) DO NOTHING;

  -- 將團主加入此場地成員
  INSERT INTO public.venue_host_memberships (venue_id, host_user_id)
  VALUES (v_venue_id, v_host_id)
  ON CONFLICT (venue_id, host_user_id) DO NOTHING;

END $$;

COMMIT;
