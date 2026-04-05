-- Phase 8: 公開報名頁可讀取參與者與球員顯示名稱；延長公開場次可見狀態（含待確認名單）
--
-- 可見性檢查須經 SECURITY DEFINER 函式，避免與 sessions_select_related 形成 RLS 遞迴。
-- 需先有：auth_user_is_session_participant（002）、session_is_public_signup_visible、
-- player_on_public_signup_roster（010 或本檔下方於同一批次執行時請先建立函式）。

create or replace function public.session_is_public_signup_visible(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.sessions s
    where s.id = p_session_id
      and s.share_signup_code is not null
      and s.allow_self_signup = true
      and s.status in (
        'draft',
        'pending_confirmation',
        'ready_for_assignment',
        'assigned',
        'in_progress',
        'round_finished'
      )
  );
$$;

create or replace function public.player_on_public_signup_roster(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.session_participants sp
    join public.sessions s on s.id = sp.session_id
    where sp.player_id = p_player_id
      and sp.is_removed = false
      and s.share_signup_code is not null
      and s.allow_self_signup = true
      and s.status in (
        'draft',
        'pending_confirmation',
        'ready_for_assignment',
        'assigned',
        'in_progress',
        'round_finished'
      )
  );
$$;

-- 1) 場次：加入 pending_confirmation 等狀態，並要求 allow_self_signup
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

-- 2) 報名名單：匿名可讀（供 /s/[code] 顯示人數與候補）
DROP POLICY IF EXISTS "Public can view participants for shared signup" ON public.session_participants;
CREATE POLICY "Public can view participants for shared signup" ON public.session_participants
  FOR SELECT
  USING (
    public.session_is_public_signup_visible(session_id)
    AND session_participants.is_removed = false
  );

-- 3) 球員：僅限出現在「可公開報名」場次名單中的列可被查詢（供顯示 display_name）
DROP POLICY IF EXISTS "Public can view players on shared signup roster" ON public.players;
CREATE POLICY "Public can view players on shared signup roster" ON public.players
  FOR SELECT
  USING (public.player_on_public_signup_roster(id));

GRANT EXECUTE ON FUNCTION public.session_is_public_signup_visible(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.player_on_public_signup_roster(uuid) TO authenticated, anon, service_role;
