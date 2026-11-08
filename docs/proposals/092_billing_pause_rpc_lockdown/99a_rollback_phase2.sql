-- 092 / 99a：Rollback 02（恢復 02 收回的兩個 RPC）
-- 用途：02 套用後，發現仍有「舊版 App」在使用（例如 Vercel 正式站尚未更新）導致開放報名失敗。
-- 不會重新開放 01 / 01b / 01c 封堵的問題（扣款函式、帳務表寫入、越權讀取維持收斂）。
--
-- 注意：恢復 kb_open_registration_with_billing 後，舊版 App 開放報名會再次「扣配額 / 扣錢包」，
--       與「暫停期間不扣費」的決策衝突；只應短期使用，直到舊版 App 下線後重新套用 02。

begin;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array['kb_open_registration_with_billing', 'kb_admin_adjust_user_wallet'])
  loop
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    raise notice '092 rollback phase2: re-granted authenticated on %', r.sig;
  end loop;
end
$$;

commit;
