-- Phase 6 Schema Extensions

-- Add columns to sessions for public registration
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS max_participants integer DEFAULT 24,
ADD COLUMN IF NOT EXISTS min_participants integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS fee_twd integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS fee_description text;

-- Venue extensions for Phase 6
ALTER TABLE public.venues
ADD COLUMN IF NOT EXISTS contact_phone text,
ADD COLUMN IF NOT EXISTS full_address text,
ADD COLUMN IF NOT EXISTS google_maps_url text;

-- Check and create match_score_submissions if not exists
-- (Player self score submission)
CREATE TABLE IF NOT EXISTS public.match_score_submissions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid references public.players(id) on delete restrict,
  submitted_by_user_id uuid not null references public.app_user_profiles(id) on delete restrict,
  team1_score smallint not null,
  team2_score smallint not null,
  is_adopted boolean not null default false,
  status text not null default 'pending', -- pending, adopted, rejected, conflict
  created_at timestamptz not null default now()
);

create index if not exists idx_mss_match on public.match_score_submissions(match_id);

-- Update RLS policies for public session access
-- Anyone can view sessions that have a share_signup_code
CREATE POLICY "Public can view shared sessions" ON public.sessions
  FOR SELECT
  USING (share_signup_code IS NOT NULL AND status IN ('ready_for_assignment', 'draft', 'round_finished'));

-- Public can view active venues for shared sessions
CREATE POLICY "Public can view venues of shared sessions" ON public.venues
  FOR SELECT
  USING (is_active = true);
