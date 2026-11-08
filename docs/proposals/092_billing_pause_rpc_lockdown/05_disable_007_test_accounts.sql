-- 092 / 05：停用 docs/007_test_accounts_and_venue.sql 建立的測試帳號（M3，P0）。
-- 狀態：提案，尚未在任何 Supabase 執行。需使用者核准；只有 00d 的 L7 段列出這些帳號時才需要執行。
--
-- 007 以固定密碼 'password123' 建立 4 個帳號：
--   admin@example.com（platform_admin）、owner@example.com（venue_owner）、host@example.com（host）、player@example.com（player）
-- 任何看過 repo 的人都能用它們登入；admin@example.com 若存在於正式站等同後門。
--
-- 做法（不刪除任何資料，可回滾）：
--   1. 只鎖定上列 4 個 Email，且必須是 007 建立方式（provider = email）。
--   2. auth.users：banned_until = 'infinity'（無法登入、無法刷新 session），並把密碼改成隨機值。
--   3. app_user_profiles：primary_role = 'player'、is_active = false。
--   4. 帳號建立的場次、場館、報名等資料全部保留。
--   5. 每個被停用的帳號寫入 kb_audit_logs（action_type = 'm3_disable_007_test_account'），舊角色存在 old_data。
-- 執行前請先單獨執行最下方的「預覽查詢」，確認這些帳號沒有被當成真實帳號使用。
--
-- 回滾：99f_rollback_05.sql（依 audit log 還原角色與 is_active、解除 ban；密碼不還原，需由管理員重設）。

begin;

create temporary table kb092_05_targets on commit drop as
select u.id, u.email, p.primary_role::text as old_role, p.is_active as old_active
from auth.users u
join public.app_user_profiles p on p.id = u.id
where lower(u.email) in ('admin@example.com', 'owner@example.com', 'host@example.com', 'player@example.com')
  and coalesce(u.raw_app_meta_data ->> 'provider', 'email') = 'email';

update auth.users u
set banned_until = 'infinity',
    encrypted_password = crypt(encode(gen_random_bytes(24), 'base64'), gen_salt('bf'))
from kb092_05_targets t
where u.id = t.id;

update public.app_user_profiles p
set primary_role = 'player', is_active = false
from kb092_05_targets t
where p.id = t.id;

insert into public.kb_audit_logs (actor_user_id, action_type, target_entity_type, target_entity_id, old_data, new_data)
select null, 'm3_disable_007_test_account', 'user', t.id,
       jsonb_build_object('primary_role', t.old_role, 'is_active', t.old_active),
       jsonb_build_object('primary_role', 'player', 'is_active', false, 'banned', true)
from kb092_05_targets t;

select 'disabled' as result, count(*) as accounts from kb092_05_targets;

commit;

-- 預覽查詢（唯讀，先單獨執行；遮罩 Email）：
-- select left(u.email, 1) || '***@' || split_part(u.email, '@', 2) as email, p.primary_role, p.is_active,
--        u.last_sign_in_at, u.created_at,
--        (select count(*) from public.sessions s where s.host_user_id = u.id) as hosted_sessions
-- from auth.users u join public.app_user_profiles p on p.id = u.id
-- where lower(u.email) in ('admin@example.com', 'owner@example.com', 'host@example.com', 'player@example.com');
