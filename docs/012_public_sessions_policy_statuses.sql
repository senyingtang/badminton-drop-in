-- Fix: 匿名開啟 /s/[code] 顯示「找不到場次」
--
-- Phase 6 政策只允許 draft / ready_for_assignment / round_finished，
-- 場次在「待確認」(pending_confirmation) 等狀態時 anon 無法 SELECT sessions。
-- 與 007_phase8 對齊：須 allow_self_signup，並納入完整開放報名相關狀態。

DROP POLICY IF EXISTS "Public can view shared sessions" ON public.sessions;

CREATE POLICY "Public can view shared sessions" ON public.sessions
  FOR SELECT
  USING (
    share_signup_code IS NOT NULL
    AND allow_self_signup = true
    AND status IN (
      'draft',
      'pending_confirmation',
      'ready_for_assignment',
      'assigned',
      'in_progress',
      'round_finished'
    )
  );
