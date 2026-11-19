-- 093 / 10r：回滾 10（移除 kb_open_registration_no_charge）
-- 注意：若之後已執行完整 092/01，請改用 092/99b，不要用本檔。
-- 回滾後新版 Cloudflare App 的「開放報名」會失敗（舊版 Vercel 不受影響）。
begin;
drop function if exists public.kb_open_registration_no_charge(uuid);
commit;
select to_regprocedure('public.kb_open_registration_no_charge(uuid)') is null as removed;
