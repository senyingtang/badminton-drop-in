-- 羽球臨打排組平台 PostgreSQL / Supabase Schema v2.0
-- 目的：提供可直接作為 migration 基礎的資料庫結構
-- 範圍：enum, functions, tables, constraints, indexes, triggers
-- 不含：完整 RLS policies（建議另拆 002_rls_policies.sql）

begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

-- =========================================================
-- 1. ENUM TYPES
-- =========================================================

create type app_role as enum (
  'platform_admin',
  'venue_owner',
  'host',
  'player'
);

create type handedness_type as enum (
  'left',
  'right',
  'unknown'
);

create type gender_type as enum (
  'male',
  'female',
  'other',
  'prefer_not_to_say'
);

create type assignment_mode_type as enum (
  'rotation_fair',
  'hybrid',
  'custom'
);

create type session_status_type as enum (
  'draft',
  'pending_confirmation',
  'ready_for_assignment',
  'assigned',
  'in_progress',
  'round_finished',
  'session_finished',
  'cancelled'
);

create type round_status_type as enum (
  'draft',
  'locked',
  'finished',
  'cancelled'
);

create type session_participant_status_type as enum (
  'pending',
  'confirmed_main',
  'waitlist',
  'promoted_from_waitlist',
  'cancelled',
  'no_show',
  'unavailable',
  'completed'
);

create type session_participant_source_type as enum (
  'self_signup',
  'host_manual',
  'fixed_list',
  'history_drag',
  'waitlist_promoted'
);

create type request_status_type as enum (
  'pending',
  'approved',
  'rejected',
  'cancelled'
);

create type note_type as enum (
  'no_show',
  'late',
  'attitude',
  'skill_gap',
  'payment_issue',
  'sportsmanship',
  'other'
);

create type warning_status_type as enum (
  'normal',
  'warned',
  'blacklisted',
  'archived'
);

create type recommendation_status_type as enum (
  'draft',
  'generated',
  'applied',
  'discarded'
);

create type generation_source_type as enum (
  'rule_engine',
  'ai_assisted',
  'manual'
);

create type score_submission_status_type as enum (
  'submitted',
  'confirmed',
  'rejected'
);

create type subscription_status_type as enum (
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'expired'
);

create type billing_interval_type as enum (
  'one_time',
  'monthly',
  'yearly'
);

create type plan_scope_type as enum (
  'host',
  'venue_owner',
  'platform'
);

create type wallet_transaction_type as enum (
  'top_up',
  'debit_usage',
  'refund',
  'adjustment',
  'bonus'
);

create type wallet_transaction_status_type as enum (
  'pending',
  'completed',
  'failed',
  'cancelled'
);

create type usage_charge_status_type as enum (
  'pending',
  'charged',
  'failed',
  'cancelled'
);

create type notification_type as enum (
  'signup',
  'waitlist_promotion',
  'session_reminder',
  'payment',
  'subscription',
  'system'
);

create type notification_status_type as enum (
  'pending',
  'sent',
  'failed',
  'read'
);

create type audit_action_type as enum (
  'insert',
  'update',
  'delete',
  'lock',
  'unlock',
  'approve',
  'reject',
  'charge',
  'refund',
  'other'
);

create type payment_provider_type as enum (
  'manual',
  'ecpay',
  'newebpay',
  'stripe',
  'other'
);

create type payment_method_status_type as enum (
  'active',
  'inactive',
  'failed',
  'expired'
);

-- =========================================================
-- 2. GENERIC HELPERS
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.normalize_player_code(input_text text)
returns citext
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(input_text, ''), '[^A-Za-z0-9]', '', 'g'))::citext;
$$;

create or replace function public.is_valid_player_code(input_text text)
returns boolean
language sql
immutable
as $$
  select coalesce(input_text, '') ~ '^[A-Za-z0-9]+$';
$$;

create or replace function public.is_valid_level(input_level smallint)
returns boolean
language sql
immutable
as $$
  select input_level between 1 and 18;
$$;

create or replace function public.generate_match_label(round_no integer, court_no integer)
returns text
language sql
immutable
as $$
  select 'R' || coalesce(round_no::text, '0') || '-C' || coalesce(court_no::text, '0');
$$;

-- =========================================================
-- 3. USER / PROFILE TABLES
-- =========================================================

create table if not exists public.app_user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  primary_role app_role not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_app_user_profiles_updated_at
before update on public.app_user_profiles
for each row execute function public.set_updated_at();

create table if not exists public.user_role_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  role app_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);

create index if not exists idx_user_role_memberships_user_id on public.user_role_memberships(user_id);
create index if not exists idx_user_role_memberships_role on public.user_role_memberships(role);

-- =========================================================
-- 4. PLAYER TABLES
-- =========================================================

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  player_code citext not null unique,
  display_name text not null,
  handedness handedness_type not null default 'unknown',
  gender gender_type not null default 'prefer_not_to_say',
  age integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_players_age check (age is null or age between 5 and 100),
  constraint chk_players_player_code_valid check (public.is_valid_player_code(player_code::text))
);

create trigger trg_players_updated_at
before update on public.players
for each row execute function public.set_updated_at();

create index if not exists idx_players_display_name on public.players(display_name);
create index if not exists idx_players_auth_user_id on public.players(auth_user_id);

create table if not exists public.host_player_profiles (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  self_level smallint,
  host_confirmed_level smallint,
  default_level_adjustment smallint not null default 0,
  warning_status warning_status_type not null default 'normal',
  is_blacklisted boolean not null default false,
  private_note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(host_user_id, player_id),
  constraint chk_hpp_self_level check (self_level is null or public.is_valid_level(self_level)),
  constraint chk_hpp_host_level check (host_confirmed_level is null or public.is_valid_level(host_confirmed_level)),
  constraint chk_hpp_default_level_adjustment check (default_level_adjustment between -1 and 1)
);

create trigger trg_host_player_profiles_updated_at
before update on public.host_player_profiles
for each row execute function public.set_updated_at();

create index if not exists idx_hpp_host on public.host_player_profiles(host_user_id);
create index if not exists idx_hpp_player on public.host_player_profiles(player_id);
create index if not exists idx_hpp_warning_status on public.host_player_profiles(warning_status);

create table if not exists public.host_player_level_adjustments (
  id uuid primary key default gen_random_uuid(),
  host_player_profile_id uuid not null references public.host_player_profiles(id) on delete cascade,
  session_id uuid,
  changed_by_user_id uuid not null references public.app_user_profiles(id) on delete restrict,
  before_level smallint,
  after_level smallint not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint chk_hpla_before_level check (before_level is null or public.is_valid_level(before_level)),
  constraint chk_hpla_after_level check (public.is_valid_level(after_level))
);

create index if not exists idx_hpla_hpp on public.host_player_level_adjustments(host_player_profile_id);
create index if not exists idx_hpla_session on public.host_player_level_adjustments(session_id);

create table if not exists public.player_shared_notes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  created_by_host_user_id uuid not null references public.app_user_profiles(id) on delete restrict,
  note_type note_type not null,
  quick_tag text,
  note_text text,
  is_hidden boolean not null default false,
  hidden_reason text,
  hidden_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_player_shared_notes_updated_at
before update on public.player_shared_notes
for each row execute function public.set_updated_at();

create index if not exists idx_psn_player on public.player_shared_notes(player_id);
create index if not exists idx_psn_host on public.player_shared_notes(created_by_host_user_id);
create index if not exists idx_psn_hidden on public.player_shared_notes(is_hidden);

create table if not exists public.player_shared_note_history (
  id uuid primary key default gen_random_uuid(),
  shared_note_id uuid not null references public.player_shared_notes(id) on delete cascade,
  version_no integer not null,
  note_type note_type not null,
  quick_tag text,
  note_text text,
  modified_by_user_id uuid not null references public.app_user_profiles(id) on delete restrict,
  modified_at timestamptz not null default now(),
  unique(shared_note_id, version_no)
);

create index if not exists idx_psnh_note on public.player_shared_note_history(shared_note_id);

create table if not exists public.player_ratings (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  session_id uuid,
  rated_by_host_user_id uuid not null references public.app_user_profiles(id) on delete restrict,
  overall_score smallint not null,
  punctuality_score smallint,
  sportsmanship_score smallint,
  communication_score smallint,
  stability_score smallint,
  quick_rating_code text,
  comment text,
  is_hidden boolean not null default false,
  hidden_reason text,
  hidden_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint chk_pr_overall check (overall_score between 1 and 5),
  constraint chk_pr_punctuality check (punctuality_score is null or punctuality_score between 1 and 5),
  constraint chk_pr_sportsmanship check (sportsmanship_score is null or sportsmanship_score between 1 and 5),
  constraint chk_pr_communication check (communication_score is null or communication_score between 1 and 5),
  constraint chk_pr_stability check (stability_score is null or stability_score between 1 and 5)
);

create index if not exists idx_pr_player on public.player_ratings(player_id);
create index if not exists idx_pr_session on public.player_ratings(session_id);
create index if not exists idx_pr_host on public.player_ratings(rated_by_host_user_id);

create table if not exists public.player_rating_summary (
  player_id uuid primary key references public.players(id) on delete cascade,
  rating_count integer not null default 0,
  overall_avg numeric(4,2) not null default 0,
  punctuality_avg numeric(4,2) not null default 0,
  sportsmanship_avg numeric(4,2) not null default 0,
  communication_avg numeric(4,2) not null default 0,
  stability_avg numeric(4,2) not null default 0,
  last_rated_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger trg_player_rating_summary_updated_at
before update on public.player_rating_summary
for each row execute function public.set_updated_at();

-- =========================================================
-- 5. VENUE / HOST MANAGEMENT
-- =========================================================

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  name text not null,
  description text,
  address_text text,
  city text,
  district text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_venues_updated_at
before update on public.venues
for each row execute function public.set_updated_at();

create index if not exists idx_venues_owner on public.venues(owner_user_id);
create index if not exists idx_venues_city_district on public.venues(city, district);

create table if not exists public.courts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  court_no integer not null,
  name text,
  intensity_label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(venue_id, court_no)
);

create trigger trg_courts_updated_at
before update on public.courts
for each row execute function public.set_updated_at();

create index if not exists idx_courts_venue on public.courts(venue_id);

create table if not exists public.venue_host_memberships (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  host_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  unique(venue_id, host_user_id)
);

create index if not exists idx_vhm_venue on public.venue_host_memberships(venue_id);
create index if not exists idx_vhm_host on public.venue_host_memberships(host_user_id);

create table if not exists public.venue_time_slots (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  weekday smallint not null,
  start_time time not null,
  end_time time not null,
  default_court_count integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_vts_weekday check (weekday between 0 and 6),
  constraint chk_vts_time check (start_time < end_time),
  constraint chk_vts_court_count check (default_court_count >= 1)
);

create trigger trg_venue_time_slots_updated_at
before update on public.venue_time_slots
for each row execute function public.set_updated_at();

create table if not exists public.host_session_requests (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  host_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  requested_start_at timestamptz not null,
  requested_end_at timestamptz not null,
  requested_court_count integer not null default 1,
  reason text,
  status request_status_type not null default 'pending',
  reviewed_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_hsr_time check (requested_start_at < requested_end_at),
  constraint chk_hsr_court_count check (requested_court_count >= 1)
);

create trigger trg_host_session_requests_updated_at
before update on public.host_session_requests
for each row execute function public.set_updated_at();

create index if not exists idx_hsr_venue on public.host_session_requests(venue_id);
create index if not exists idx_hsr_host on public.host_session_requests(host_user_id);
create index if not exists idx_hsr_status on public.host_session_requests(status);

-- =========================================================
-- 6. SESSION / PARTICIPANTS
-- =========================================================

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references public.venues(id) on delete set null,
  host_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  created_by_user_id uuid not null references public.app_user_profiles(id) on delete restrict,
  slot_id uuid references public.venue_time_slots(id) on delete set null,
  approved_request_id uuid references public.host_session_requests(id) on delete set null,
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  court_count integer not null default 1,
  assignment_mode assignment_mode_type not null default 'rotation_fair',
  allow_self_signup boolean not null default false,
  share_signup_code text,
  status session_status_type not null default 'draft',
  has_first_charge_applied boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_sessions_time check (start_at < end_at),
  constraint chk_sessions_court_count check (court_count >= 1)
);

create trigger trg_sessions_updated_at
before update on public.sessions
for each row execute function public.set_updated_at();

create index if not exists idx_sessions_host on public.sessions(host_user_id);
create index if not exists idx_sessions_venue on public.sessions(venue_id);
create index if not exists idx_sessions_status on public.sessions(status);
create index if not exists idx_sessions_start_end on public.sessions(start_at, end_at);
create unique index if not exists uq_sessions_signup_code on public.sessions(share_signup_code) where share_signup_code is not null;

create table if not exists public.session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  host_player_profile_id uuid references public.host_player_profiles(id) on delete set null,
  source_type session_participant_source_type not null,
  status session_participant_status_type not null default 'pending',
  priority_order integer,
  waitlist_order integer,
  signup_note text,
  self_level smallint,
  host_confirmed_level smallint,
  session_effective_level smallint,
  total_matches_played integer not null default 0,
  consecutive_rounds_played integer not null default 0,
  is_locked_for_current_round boolean not null default false,
  is_removed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, player_id),
  constraint chk_sp_self_level check (self_level is null or public.is_valid_level(self_level)),
  constraint chk_sp_host_level check (host_confirmed_level is null or public.is_valid_level(host_confirmed_level)),
  constraint chk_sp_session_level check (session_effective_level is null or public.is_valid_level(session_effective_level)),
  constraint chk_sp_total_matches_played check (total_matches_played >= 0),
  constraint chk_sp_consecutive_rounds_played check (consecutive_rounds_played >= 0)
);

create trigger trg_session_participants_updated_at
before update on public.session_participants
for each row execute function public.set_updated_at();

create index if not exists idx_sp_session on public.session_participants(session_id);
create index if not exists idx_sp_player on public.session_participants(player_id);
create index if not exists idx_sp_status on public.session_participants(status);
create index if not exists idx_sp_waitlist on public.session_participants(session_id, waitlist_order);

create table if not exists public.session_waitlist_promotions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  promoted_participant_id uuid not null references public.session_participants(id) on delete cascade,
  replaced_participant_id uuid references public.session_participants(id) on delete set null,
  promoted_by_user_id uuid not null references public.app_user_profiles(id) on delete restrict,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_swp_session on public.session_waitlist_promotions(session_id);

create table if not exists public.session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_session_events_session on public.session_events(session_id, created_at desc);

-- =========================================================
-- 7. ASSIGNMENT / ROUND / MATCH
-- =========================================================

create table if not exists public.assignment_recommendations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_no integer not null,
  status recommendation_status_type not null default 'draft',
  source generation_source_type not null default 'rule_engine',
  rule_summary text,
  ai_summary text,
  debug_payload jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_assignment_recommendations_updated_at
before update on public.assignment_recommendations
for each row execute function public.set_updated_at();

create index if not exists idx_ar_session_round on public.assignment_recommendations(session_id, round_no);

create table if not exists public.assignment_recommendation_items (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.assignment_recommendations(id) on delete cascade,
  court_no integer not null,
  team_no smallint not null,
  participant_id uuid not null references public.session_participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(recommendation_id, court_no, team_no, participant_id),
  constraint chk_ari_team_no check (team_no in (1,2)),
  constraint chk_ari_court_no check (court_no >= 1)
);

create index if not exists idx_ari_recommendation on public.assignment_recommendation_items(recommendation_id);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_no integer not null,
  status round_status_type not null default 'draft',
  recommendation_id uuid references public.assignment_recommendations(id) on delete set null,
  locked_at timestamptz,
  locked_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  finished_at timestamptz,
  finished_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, round_no)
);

create trigger trg_rounds_updated_at
before update on public.rounds
for each row execute function public.set_updated_at();

create index if not exists idx_rounds_session on public.rounds(session_id);
create index if not exists idx_rounds_status on public.rounds(status);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  court_no integer not null,
  match_label text not null,
  final_score_team_1 integer,
  final_score_team_2 integer,
  winning_team_no smallint,
  confirmed_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(round_id, court_no),
  constraint chk_matches_court_no check (court_no >= 1),
  constraint chk_matches_scores check (
    (final_score_team_1 is null and final_score_team_2 is null and winning_team_no is null)
    or
    (final_score_team_1 is not null and final_score_team_2 is not null and winning_team_no in (1,2))
  )
);

create trigger trg_matches_updated_at
before update on public.matches
for each row execute function public.set_updated_at();

create index if not exists idx_matches_session on public.matches(session_id);
create index if not exists idx_matches_round on public.matches(round_id);

create table if not exists public.match_teams (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_no smallint not null,
  created_at timestamptz not null default now(),
  unique(match_id, team_no),
  constraint chk_match_teams_team_no check (team_no in (1,2))
);

create table if not exists public.match_team_players (
  id uuid primary key default gen_random_uuid(),
  match_team_id uuid not null references public.match_teams(id) on delete cascade,
  participant_id uuid not null references public.session_participants(id) on delete cascade,
  seat_no smallint,
  created_at timestamptz not null default now(),
  unique(match_team_id, participant_id)
);

create index if not exists idx_mtp_match_team on public.match_team_players(match_team_id);
create index if not exists idx_mtp_participant on public.match_team_players(participant_id);

create table if not exists public.match_score_submissions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  submitted_by_player_id uuid not null references public.players(id) on delete restrict,
  score_team_1 integer not null,
  score_team_2 integer not null,
  status score_submission_status_type not null default 'submitted',
  submitted_at timestamptz not null default now(),
  reviewed_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  constraint chk_mss_scores check (score_team_1 >= 0 and score_team_2 >= 0)
);

create index if not exists idx_mss_match on public.match_score_submissions(match_id);
create index if not exists idx_mss_player on public.match_score_submissions(submitted_by_player_id);

-- =========================================================
-- 8. BILLING / WALLET / PAYMENT
-- =========================================================

create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  scope plan_scope_type not null,
  billing_interval billing_interval_type not null,
  price_amount integer not null,
  currency text not null default 'TWD',
  trial_session_count integer not null default 0,
  included_session_count integer,
  auto_renew_default boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_bp_price_amount check (price_amount >= 0),
  constraint chk_bp_trial_session_count check (trial_session_count >= 0)
);

create trigger trg_billing_plans_updated_at
before update on public.billing_plans
for each row execute function public.set_updated_at();

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  subscriber_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  payment_provider payment_provider_type not null default 'manual',
  provider_customer_ref text,
  provider_subscription_ref text,
  status subscription_status_type not null default 'trialing',
  auto_renew boolean not null default true,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create index if not exists idx_subscriptions_user on public.subscriptions(subscriber_user_id);
create index if not exists idx_subscriptions_status on public.subscriptions(status);

create table if not exists public.wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references public.app_user_profiles(id) on delete cascade,
  balance_amount integer not null default 0,
  currency text not null default 'TWD',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_wa_balance_amount check (balance_amount >= 0)
);

create trigger trg_wallet_accounts_updated_at
before update on public.wallet_accounts
for each row execute function public.set_updated_at();

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade,
  tx_type wallet_transaction_type not null,
  status wallet_transaction_status_type not null default 'pending',
  amount integer not null,
  balance_before integer,
  balance_after integer,
  reference_type text,
  reference_id uuid,
  payment_provider payment_provider_type,
  provider_payment_ref text,
  note text,
  idempotency_key text,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(idempotency_key),
  constraint chk_wt_amount_nonzero check (amount <> 0)
);

create index if not exists idx_wt_wallet on public.wallet_transactions(wallet_account_id);
create index if not exists idx_wt_reference on public.wallet_transactions(reference_type, reference_id);

create table if not exists public.usage_charges (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions(id) on delete cascade,
  billed_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  plan_id uuid references public.billing_plans(id) on delete set null,
  wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null,
  amount integer not null,
  currency text not null default 'TWD',
  status usage_charge_status_type not null default 'pending',
  charged_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_uc_amount check (amount >= 0)
);

create trigger trg_usage_charges_updated_at
before update on public.usage_charges
for each row execute function public.set_updated_at();

create index if not exists idx_uc_billed_user on public.usage_charges(billed_user_id);
create index if not exists idx_uc_status on public.usage_charges(status);

create table if not exists public.payment_provider_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  provider payment_provider_type not null,
  provider_customer_ref text not null,
  created_at timestamptz not null default now(),
  unique(user_id, provider),
  unique(provider, provider_customer_ref)
);

create table if not exists public.payment_provider_payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  provider payment_provider_type not null,
  provider_payment_method_ref text not null,
  masked_label text,
  status payment_method_status_type not null default 'active',
  is_default boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_payment_method_ref)
);

create trigger trg_payment_provider_payment_methods_updated_at
before update on public.payment_provider_payment_methods
for each row execute function public.set_updated_at();

create table if not exists public.payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider payment_provider_type not null,
  provider_event_ref text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, provider_event_ref)
);

-- =========================================================
-- 9. NOTIFICATION / AUDIT
-- =========================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  notification_type notification_type not null,
  status notification_status_type not null default 'pending',
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_status on public.notifications(status);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  action audit_action_type not null,
  entity_table text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_entity on public.audit_logs(entity_table, entity_id, created_at desc);
create index if not exists idx_audit_logs_actor on public.audit_logs(actor_user_id, created_at desc);

-- =========================================================
-- 10. FK ADDITIONS REQUIRING FORWARD REFERENCES
-- =========================================================

alter table public.host_player_level_adjustments
  add constraint fk_hpla_session
  foreign key (session_id) references public.sessions(id) on delete set null;

alter table public.player_ratings
  add constraint fk_pr_session
  foreign key (session_id) references public.sessions(id) on delete set null;

-- =========================================================
-- 11. RECOMMENDED COMMENTS
-- =========================================================

comment on table public.players is '平台共享球員主體；透過 player_code 跨團識別';
comment on table public.host_player_profiles is '球員在特定團主底下的專屬視角資料';
comment on table public.session_participants is 'Session 內的球員快照，包含正選 / 候補 / 當場有效級數';
comment on table public.assignment_recommendations is '規則引擎與 AI 生成的分組建議主表';
comment on table public.player_shared_notes is '所有團主可見的球員共享備註';
comment on table public.player_ratings is '球員評價；匿名對外顯示，平台可追溯來源';
comment on table public.usage_charges is '個人方案按 Session 首次開打產生的單次扣款紀錄';

commit;
