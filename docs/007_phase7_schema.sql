-- Phase 7 Schema Extensions

-- 1. Notifications Table
CREATE TABLE IF NOT EXISTS public.kb_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  title text not null,
  body text,
  action_url text,
  is_read boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_kb_notifications_user on public.kb_notifications(user_id, created_at desc);
create index if not exists idx_kb_notifications_unread on public.kb_notifications(user_id, is_read);

-- 2. Audit Logs Table
CREATE TABLE IF NOT EXISTS public.kb_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  action_type text not null, -- 'wallet_adjustment', 'user_ban', 'hide_rating' etc.
  target_entity_type text not null,
  target_entity_id uuid,
  reason text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_kb_audit_logs_actor on public.kb_audit_logs(actor_user_id);
create index if not exists idx_kb_audit_logs_action on public.kb_audit_logs(action_type);

-- 3. Update player_ratings to support hiding (Moderation)
ALTER TABLE public.player_ratings
ADD COLUMN IF NOT EXISTS is_hidden boolean not null default false;

-- 4. RLS for Admin
-- Create a helper function to check if a user is an admin
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user_profiles
    WHERE id = auth.uid() AND primary_role = 'platform_admin'
  );
$$;

-- Notifications Policies
ALTER TABLE public.kb_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications" ON public.kb_notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications" ON public.kb_notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- Audit Logs Policies
ALTER TABLE public.kb_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can view audit logs" ON public.kb_audit_logs
  FOR SELECT USING (public.is_platform_admin());

-- Allow platform admin to see all wallets and transactions
CREATE POLICY "Platform admin view wallets" ON public.kb_wallets
  FOR SELECT USING (public.is_platform_admin());

CREATE POLICY "Platform admin view txns" ON public.kb_wallet_transactions
  FOR SELECT USING (public.is_platform_admin());

-- View users
CREATE POLICY "Platform admin view users" ON public.app_user_profiles
  FOR SELECT USING (public.is_platform_admin());
CREATE POLICY "Platform admin update users" ON public.app_user_profiles
  FOR UPDATE USING (public.is_platform_admin());

-- Admin Stats RPC
CREATE OR REPLACE FUNCTION public.kb_admin_get_kpis()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_total_sessions integer;
  v_active_hosts integer;
  v_total_revenue integer;
BEGIN
  -- Check permission
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT count(*) INTO v_total_sessions FROM public.sessions;
  
  SELECT count(distinct host_user_id) INTO v_active_hosts 
  FROM public.sessions 
  WHERE created_at > now() - interval '30 days';

  -- approximate revenue by summing consumptions 
  -- In a real scenario we'd query kb_ledger_lines or stripe
  -- For demo, sum all deduction from ledgers
  SELECT COALESCE(SUM(amount), 0) INTO v_total_revenue
  FROM public.kb_ledger_lines
  WHERE amount < 0 AND entry_type = 'payment_intent';

  RETURN jsonb_build_object(
    'total_sessions', v_total_sessions,
    'active_hosts_30d', v_active_hosts,
    'total_revenue_twd', ABS(v_total_revenue)
  );
END;
$$;
