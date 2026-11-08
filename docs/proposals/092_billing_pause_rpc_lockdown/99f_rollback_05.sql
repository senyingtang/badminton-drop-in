-- 092 / 99f：回滾 05（依 kb_audit_logs 還原 007 測試帳號的角色與 is_active，並解除 ban）。
-- 警告：還原後 admin@example.com 等帳號會重新成為原本的角色。密碼不會還原（05 已改成隨機值），
--       需要使用時請由管理員在 Supabase Dashboard 重設。僅限緊急。

begin;

with last as (
  select distinct on (a.target_entity_id) a.target_entity_id as id, a.old_data
  from public.kb_audit_logs a
  where a.action_type = 'm3_disable_007_test_account'
  order by a.target_entity_id, a.created_at asc   -- 最早的一筆 = 05 第一次執行前的原始狀態（重複執行 05 不影響）
)
update public.app_user_profiles p
set primary_role = (last.old_data ->> 'primary_role')::public.app_role,
    is_active = coalesce((last.old_data ->> 'is_active')::boolean, true)
from last
where p.id = last.id;

update auth.users u
set banned_until = null
where u.id in (select a.target_entity_id from public.kb_audit_logs a where a.action_type = 'm3_disable_007_test_account');

insert into public.kb_audit_logs (actor_user_id, action_type, target_entity_type, target_entity_id)
select distinct null::uuid, 'm3_rollback_disable_007_test_account', 'user', a.target_entity_id
from public.kb_audit_logs a where a.action_type = 'm3_disable_007_test_account';

commit;
