-- 094 / 99：回滾 094/01，還原 docs/008 的原始 trg_notify_waitlist_promotion（自足檔，可直接貼到 SQL Editor）。
-- ⚠️ 原始版本讀取不存在的 players.user_id：回滾後「⬆ 遞補下一位」會再次失敗。只在 094/01 造成未預期故障時使用。
-- 只換函式本體；trigger on_waitlist_promotion 本身未被 094 修改，不需要重建。不改任何資料列。

begin;

CREATE OR REPLACE FUNCTION public.trg_notify_waitlist_promotion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_session_title text;
  v_player_id uuid;
BEGIN
  -- Get the player_id for the promoted participant
  SELECT player_id INTO v_player_id
  FROM public.session_participants
  WHERE id = NEW.promoted_participant_id;

  -- Get the user_id for the player
  SELECT user_id INTO v_user_id
  FROM public.players
  WHERE id = v_player_id;

  -- Get the session title
  SELECT title INTO v_session_title
  FROM public.sessions
  WHERE id = NEW.session_id;

  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.kb_notifications (user_id, title, body, action_url)
    VALUES (
      v_user_id,
      '候補遞補成功！',
      '您已成功遞補加入場次：' || v_session_title || '，請準時出席。',
      '/sessions/' || NEW.session_id
    );
  END IF;

  RETURN NEW;
END;
$$;

commit;

-- 驗證（唯讀）：回滾後 still_original = 1；094/01 套用中 = 0
select count(*) as still_original from pg_proc
where proname = 'trg_notify_waitlist_promotion' and prosrc ~* 'select\s+user_id';
