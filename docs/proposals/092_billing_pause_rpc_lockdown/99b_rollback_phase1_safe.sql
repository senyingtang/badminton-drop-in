-- 092 / 99b：Rollback 01（安全版）
--
-- 01 收回的權限，App（舊版與新版）都沒有以 anon / authenticated 身分使用，所以正常情況下不需要恢復。
-- 本檔「不會」重新授權扣款函式或帳務表寫入（那等於重新開放 P0）；完整還原請見 99z（UNSAFE）。
--
-- 若 01 之後出現預期外的故障，請先從 Supabase logs 找出被拒絕的「單一」函式或資料表，
-- 再只針對它、只授權給 authenticated（不要授權給 anon / PUBLIC），例如：
--   grant execute on function public.<function>(<args>) to authenticated;
--   grant insert on table public.<table> to authenticated;   -- 只在該表已啟用 RLS 且有正確 policy 時
-- 並在 00 / 03 的輸出上記錄原因。

begin;

-- 移除新函式：只在「新版 App 尚未上線」時執行（新版 App 的開放報名需要它，移除後會顯示「功能尚未啟用」）。
do $$
begin
  if to_regprocedure('public.kb_open_registration_no_charge(uuid)') is not null then
    drop function public.kb_open_registration_no_charge(uuid);
    raise notice '092 rollback phase1: dropped kb_open_registration_no_charge';
  end if;
end
$$;

commit;
