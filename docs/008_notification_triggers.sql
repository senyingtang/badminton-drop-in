-- Phase 7 Notification Triggers

-- 1. Notify player on waitlist promotion
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

DROP TRIGGER IF EXISTS on_waitlist_promotion ON public.session_waitlist_promotions;
CREATE TRIGGER on_waitlist_promotion
  AFTER INSERT ON public.session_waitlist_promotions
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_waitlist_promotion();

-- 2. Notify host when a player submits a score
CREATE OR REPLACE FUNCTION public.trg_notify_score_submission()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_host_id uuid;
  v_match_label text;
  v_session_id uuid;
BEGIN
  -- Get match details
  SELECT matches.match_label, rounds.session_id INTO v_match_label, v_session_id
  FROM public.matches matches
  JOIN public.rounds rounds ON rounds.id = matches.round_id
  WHERE matches.id = NEW.match_id;

  -- Get host user id
  SELECT host_user_id INTO v_host_id
  FROM public.sessions
  WHERE id = v_session_id;

  IF v_host_id IS NOT NULL THEN
    INSERT INTO public.kb_notifications (user_id, title, body, action_url)
    VALUES (
      v_host_id,
      '球員回報比分',
      '場次比賽 ' || v_match_label || ' 有球員回報比分，請前往採納。',
      '/sessions/' || v_session_id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_score_submission ON public.match_score_submissions;
CREATE TRIGGER on_score_submission
  AFTER INSERT ON public.match_score_submissions
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_score_submission();
