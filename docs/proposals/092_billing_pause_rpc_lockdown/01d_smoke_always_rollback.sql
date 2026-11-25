-- 092 / 01d 冒煙測試（套用前後都可執行；永遠不留下任何變更）
-- 以真實的 authenticated 角色 + JWT sub 模擬 PostgREST 請求，逐項嘗試修改 app_user_profiles。
-- 每一項都在子交易內執行並回滾；最後一定以 ERROR「01D_SMOKE_RESULT ...」結束，整個交易回滾，
-- 所以不論結果如何，正式資料都不會改變（包括 updated_at）。
-- 不能加 --read-only：唯讀交易會在 trigger 之前就拒絕 UPDATE，測不到 01d。
-- 不輸出任何 id / Email / 姓名。
--
-- 預期結果（以 ERROR 訊息呈現）：
--   套用 01d 後：01D_SMOKE_RESULT PASS  failed=0 ...
--   套用 01d 前：01D_SMOKE_RESULT FAIL  （攻擊項目沒有被擋 = 漏洞存在，用來證明測試有效）
--
-- 執行（D:\project\badminton\web）：
--   npx supabase db query --remote=ngudidpitcfyzmbphlgt --yes -f..\docs\proposals\092_billing_pause_rpc_lockdown\01d_smoke_always_rollback.sql

do $smoke$
declare
  v_player uuid; v_susp uuid; v_del uuid; v_admin uuid; v_susp_admin uuid;
  v_res text[] := '{}';
  v_fail int := 0; v_skip int := 0; v_pass int := 0;
  v_n int;
  v_case text;
  v_expect text;
  v_who uuid;
  v_sql text;
  v_cases text[][] := array[
    -- case name,                                     actor,        expect,   statement (%1$L = actor id, %2$L = player id)
    array['member self-promotes to platform_admin',   'player',     'block',  'update public.app_user_profiles set primary_role = ''platform_admin'' where id = %1$L'],
    array['member self-promotes to host',             'player',     'block',  'update public.app_user_profiles set primary_role = ''host'' where id = %1$L'],
    array['member fakes own deletion',                'player',     'block',  'update public.app_user_profiles set is_deleted = true where id = %1$L'],
    array['suspended member re-activates self',       'suspended',  'block',  'update public.app_user_profiles set is_active = true where id = %1$L'],
    array['deleted member un-deletes self',           'deleted',    'block',  'update public.app_user_profiles set is_deleted = false where id = %1$L'],
    -- 一定是「真的改變」：原本有值就清掉，原本是 NULL 就填入（避免 NULL→NULL 被視為未修改）
    array['deleted member changes deleted_at',        'deleted',    'block',  'update public.app_user_profiles set deleted_at = case when deleted_at is null then now() end, account_deleted_at = case when account_deleted_at is null then now() end where id = %1$L'],
    array['deleted member re-activates self',         'deleted',    'block',  'update public.app_user_profiles set is_active = true where id = %1$L'],
    array['SUSPENDED admin re-activates self',        'susp_admin', 'block',  'update public.app_user_profiles set is_active = true where id = %1$L'],
    array['SUSPENDED admin changes a member role',    'susp_admin', 'block',  'update public.app_user_profiles set primary_role = ''host'' where id = %2$L'],
    array['member edits own display_name (ProfileForm)', 'player',  'allow',  'update public.app_user_profiles set display_name = display_name where id = %1$L'],
    array['ACTIVE admin changes a member role (/admin/users)', 'admin', 'allow', 'update public.app_user_profiles set primary_role = ''host'' where id = %2$L'],
    array['ACTIVE admin suspends a member (/admin/users)',     'admin', 'allow', 'update public.app_user_profiles set is_active = false where id = %2$L']
  ];
  i int;
begin
  -- 測試對象（以 postgres 身分挑選；只用 id，不輸出）
  select id into v_player from public.app_user_profiles p
   where p.primary_role::text = 'player' and coalesce((to_jsonb(p)->>'is_active')::boolean, true)
     and not coalesce((to_jsonb(p)->>'is_deleted')::boolean, false)
   order by created_at limit 1;
  select id into v_susp from public.app_user_profiles p
   where p.primary_role::text <> 'platform_admin' and not coalesce((to_jsonb(p)->>'is_active')::boolean, true)
     and not coalesce((to_jsonb(p)->>'is_deleted')::boolean, false)
   order by created_at limit 1;
  select id into v_del from public.app_user_profiles p
   where coalesce((to_jsonb(p)->>'is_deleted')::boolean, false)
   order by created_at limit 1;
  select id into v_admin from public.app_user_profiles p
   where p.primary_role::text = 'platform_admin' and coalesce((to_jsonb(p)->>'is_active')::boolean, true)
     and not coalesce((to_jsonb(p)->>'is_deleted')::boolean, false)
   order by created_at limit 1;
  select id into v_susp_admin from public.app_user_profiles p
   where p.primary_role::text = 'platform_admin' and not coalesce((to_jsonb(p)->>'is_active')::boolean, true)
   order by created_at limit 1;

  for i in 1 .. array_length(v_cases, 1) loop
    v_case := v_cases[i][1];
    v_expect := v_cases[i][3];
    v_who := case v_cases[i][2] when 'player' then v_player when 'suspended' then v_susp when 'deleted' then v_del
                                when 'admin' then v_admin when 'susp_admin' then v_susp_admin end;
    if v_who is null or v_player is null then
      v_skip := v_skip + 1; v_res := v_res || ('SKIP ' || v_case || ' (no such account)');
      continue;
    end if;
    v_sql := format(v_cases[i][4], v_who, v_player);
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_who::text, true);
      perform set_config('request.jwt.claim.role', 'authenticated', true);
      perform set_config('role', 'authenticated', true);
      execute v_sql;
      get diagnostics v_n = row_count;
      raise exception 'SMOKE_DONE rows=%', v_n;          -- 一定回滾這個子交易（含 role 設定）
    exception when others then
      if v_expect = 'block' and sqlerrm = 'ROLE_CHANGE_NOT_ALLOWED' then
        v_pass := v_pass + 1; v_res := v_res || ('PASS blocked: ' || v_case);
      elsif v_expect = 'allow' and sqlerrm = 'SMOKE_DONE rows=1' then
        v_pass := v_pass + 1; v_res := v_res || ('PASS allowed: ' || v_case);
      else
        v_fail := v_fail + 1; v_res := v_res || ('FAIL ' || v_case || ' (expected ' || v_expect || ', got: ' || sqlerrm || ')');
      end if;
    end;
  end loop;

  -- 一定以錯誤結束 → 整個交易回滾
  raise exception '01D_SMOKE_RESULT % passed=% failed=% skipped=% | %',
    case when v_fail = 0 and v_pass > 0 then 'PASS' else 'FAIL' end, v_pass, v_fail, v_skip,
    array_to_string(v_res, ' | ');
end
$smoke$;
