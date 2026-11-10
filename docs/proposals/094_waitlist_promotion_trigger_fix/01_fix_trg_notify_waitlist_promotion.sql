-- 094/01：修正「⬆ 遞補下一位」失敗（column "user_id" does not exist）
-- 原因：docs/008 的 trg_notify_waitlist_promotion 讀 players.user_id，但欄位是 players.auth_user_id。
--       session_waitlist_promotions 每次 INSERT 都觸發 → promote_next_waitlist_participant(_simple) 整筆交易失敗。
-- 只改 trigger 函式本體（欄位名稱 + 固定 search_path），不改 schema / RLS / 遞補規則。
-- Staging 已驗證（M8）。正式站需使用者核准後執行。
CREATE OR REPLACE FUNCTION public.trg_notify_waitlist_promotion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_session_title text;
BEGIN
  SELECT p.auth_user_id INTO v_user_id
  FROM public.session_participants sp
  JOIN public.players p ON p.id = sp.player_id
  WHERE sp.id = NEW.promoted_participant_id;

  SELECT title INTO v_session_title FROM public.sessions WHERE id = NEW.session_id;

  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.kb_notifications (user_id, title, body, action_url)
    VALUES (
      v_user_id,
      '候補遞補成功！',
      '您已成功遞補加入場次：' || coalesce(v_session_title, '') || '，請準時出席。',
      '/sessions/' || NEW.session_id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 驗證：應回傳 0（函式本體不再引用 user_id 欄位於 players）
SELECT count(*) AS still_broken FROM pg_proc
WHERE proname = 'trg_notify_waitlist_promotion' AND prosrc ~* 'select\s+user_id';
