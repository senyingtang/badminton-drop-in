-- 092 / 01d：會員自行提升為平台管理員／自行解除停權或刪除 修正（P0）
-- 狀態：提案（M1.5 審查版）。只在本機 PGlite 測過（staging-test/test-01d.mjs）。需經使用者核准才可執行。
-- 可獨立執行：不依賴 01 / 01b / 01c / 02 / 04，也不被它們依賴。可重複執行。回滾：99d。
--
-- 漏洞（依 repo migrations；正式站以 00d 診斷確認）：
--   002 policy app_user_profiles_update_self_or_admin：using / with check 只有 id = auth.uid()，
--   沒有限制欄位；authenticated 又有資料表 UPDATE 權限（Supabase 預設），所以任何登入者都能
--     PATCH /rest/v1/app_user_profiles?id=eq.<自己>  {"primary_role":"platform_admin"}
--   → is_platform_admin() 為真 → 可讀寫所有會員、帳務、platform_line_integration（LINE token/secret）、
--     kb_payment_provider_configs，並可使用全部 /api/admin/*（後端只檢查 primary_role）。
--   同理：被停權者可把 is_active 改回 true；已刪除者可把 is_deleted 改回 false；
--   可自行改寫 line_oa_user_id（正常只由 LINE webhook 以 service_role 寫入）。
--   002 policy app_user_profiles_insert_self：沒有 profile 的新帳號可直接以 platform_admin 身分建立。
--
-- 修正：BEFORE INSERT / UPDATE trigger，限制「受保護欄位」：
--   primary_role, is_active, is_deleted, deleted_at, account_deleted_at, anonymized_at,
--   deleted_display_name_snapshot, line_oa_user_id
--   - 預設拒絕（fail-closed）：除了「本身就能略過 RLS 的角色」（service_role、postgres、超級使用者，
--     以及以它們為 owner 的 SECURITY DEFINER 函式）之外，所有角色（anon、authenticated、PUBLIC 繼承的
--     任何自訂角色）都受限制。
--   - 例外：呼叫者本人是「啟用中」的平台管理員（primary_role = platform_admin 且 is_active = true）
--     → 管理後台 /admin/users 以使用者 JWT 直接改角色 / 停權的既有功能照常。
--   - INSERT：非管理員只能建立 primary_role = 'player'、is_active = true、未刪除、未綁 LINE 的 profile
--     （= useProfileSync 與 LINE callback 的實際寫法）。
--   - 欄位以 to_jsonb 比對：正式站若尚未有 081 / 054 的欄位也不會出錯。
--   - display_name / phone / avatar_url / updated_at 等一般欄位照常可自行修改。
--   - 不修改任何 RLS policy、不修改 is_platform_admin()、不改任何資料列。

begin;

-- 呼叫者是否為「啟用中的」平台管理員。SECURITY DEFINER：不受 app_user_profiles RLS 影響。
create or replace function public.kb092_caller_is_active_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.app_user_profiles p
    where p.id = auth.uid()
      and p.primary_role::text = 'platform_admin'
      and coalesce((to_jsonb(p) ->> 'is_active')::boolean, true)
      and not coalesce((to_jsonb(p) ->> 'is_deleted')::boolean, false)
  );
$$;

revoke all on function public.kb092_caller_is_active_platform_admin() from public, anon;
grant execute on function public.kb092_caller_is_active_platform_admin() to authenticated, service_role;

create or replace function public.kb092_guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_cols constant text[] := array[
    'primary_role', 'is_active', 'is_deleted', 'deleted_at', 'account_deleted_at',
    'anonymized_at', 'deleted_display_name_snapshot', 'line_oa_user_id'
  ];
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_col text;
begin
  -- 本身就能略過 RLS 的角色（service_role / postgres / superuser，以及它們擁有的 DEFINER 函式）不受限
  if exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname = current_user and (r.rolsuper or r.rolbypassrls)
  ) then
    return new;
  end if;

  if public.kb092_caller_is_active_platform_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(v_new ->> 'primary_role', '') <> 'player'
       or not coalesce((v_new ->> 'is_active')::boolean, true)
       or coalesce((v_new ->> 'is_deleted')::boolean, false)
       or v_new ->> 'deleted_at' is not null
       or v_new ->> 'account_deleted_at' is not null
       or v_new ->> 'anonymized_at' is not null
       or v_new ->> 'deleted_display_name_snapshot' is not null
       or v_new ->> 'line_oa_user_id' is not null then
      raise exception 'ROLE_CHANGE_NOT_ALLOWED'
        using errcode = '42501', detail = 'self-created profiles must be active players';
    end if;
    return new;
  end if;

  v_old := to_jsonb(old);
  foreach v_col in array v_cols loop
    if (v_new -> v_col) is distinct from (v_old -> v_col) then
      raise exception 'ROLE_CHANGE_NOT_ALLOWED'
        using errcode = '42501', detail = format('column %s can only be changed by an active platform admin', v_col);
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.kb092_guard_profile_privileged_columns() from public, anon;

drop trigger if exists trg_kb092_guard_profile_privileged_columns on public.app_user_profiles;
create trigger trg_kb092_guard_profile_privileged_columns
before insert or update on public.app_user_profiles
for each row execute function public.kb092_guard_profile_privileged_columns();

commit;

-- 執行後驗證（唯讀）：
--   select tgname, tgenabled from pg_trigger where tgrelid = 'public.app_user_profiles'::regclass and not tgisinternal;
--   → 應看到 trg_kb092_guard_profile_privileged_columns，tgenabled = 'O'
