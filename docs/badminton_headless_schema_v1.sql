-- 羽球臨打排組平台 PostgreSQL / Supabase Schema v1.0
-- 說明：
-- 1. 此檔以 Supabase(PostgreSQL) 為前提
-- 2. 主要負責建立 extension, enum, table, constraint, index, trigger, helper functions
-- 3. RLS policy 建議於下一版獨立 migration 檔處理

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

create type fee_mode_type as enum (
  'pay_per_session',
  'monthly_subscription',
  'trial',
  'unlimited'
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

create type note_type as enum (
  'no_show',
  'late',
  'attitude',
  'skill_gap',
  'payment_issue',
  'other'
);

create type warning_status_type as enum (
  'normal',
  'warned',
  'blacklisted',
  'archived'
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
  select lower(regexp_replace(coalesce(input_text, ''), '[^a-zA-Z0-9]', '', 'g'))::citext;
$$;

create or replace function public.is_valid_player_code(input_text text)
returns boolean
language sql
immutable
as $$
  select input_text ~ '^[A-Za-z0-9]+$';
$$;

-- =========================================================
-- 3. USER / PLAYER / HOST CORE TABLES
-- =========================================================

create table if not exists public.app_user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role app_role not null,
  display_name text not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_app_user_profiles_updated_at
before update on public.app_user_profiles
for each row execute function public.set_updated_at();

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

create index if not exists idx_players_display_name on public.players(display_name);
create index if not exists idx_players_auth_user_id on public.players(auth_user_id);

create trigger trg_players_updated_at
before update on public.players
for each row execute function public.set_updated_at();

create table if not exists public.host_player_profiles (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  self_level smallint,
  host_confirmed_level smallint,
  default_level_adjustment smallint not null default 0,
  warning_status warning_status_type not null default 'normal',
  private_note text,
  is_blacklisted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(host_user_id, player_id),
  constraint chk_host_player_profiles_self_level check (self_level is null or self_level between 1 and 18),
  constraint chk_host_player_profiles_confirmed_level check (host_confirmed_level is null or host_confirmed_level between 1 and 18),
  constraint chk_host_player_profiles_adjustment check (default_level_adjustment between -3 and 3)
);

create index if not exists idx_host_player_profiles_host on public.host_player_profiles(host_user_id);
create index if not exists idx_host_player_profiles_player on public.host_player_profiles(player_id);

create trigger trg_host_player_profiles_updated_at
before update on public.host_player_profiles
for each row execute function public.set_updated_at();

create table if not exists public.host_player_lists (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_host_player_lists_default
on public.host_player_lists(host_user_id)
where is_default = true;

create trigger trg_host_player_lists_updated_at
before update on public.host_player_lists
for each row execute function public.set_updated_at();

create table if not exists public.host_player_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.host_player_lists(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(list_id, player_id)
);

create index if not exists idx_host_player_list_items_list on public.host_player_list_items(list_id, sort_order);

-- =========================================================
-- 4. VENUE / COURT / HOST RELATION
-- =========================================================

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  name text not null,
  address_text text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_venues_updated_at
before update on public.venues
for each row execute function public.set_updated_at();

create table if not exists public.courts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  intensity_pool text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(venue_id, name)
);

create index if not exists idx_courts_venue on public.courts(venue_id, sort_order);

create trigger trg_courts_updated_at
before update on public.courts
for each row execute function public.set_updated_at();

create table if not exists public.venue_host_links (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  host_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(venue_id, host_user_id)
);

create trigger trg_venue_host_links_updated_at
before update on public.venue_host_links
for each row execute function public.set_updated_at();

create table if not exists public.venue_time_slots (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  title text,
  weekday smallint,
  starts_at_local time not null,
  ends_at_local time not null,
  max_court_count integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_venue_time_slots_weekday check (weekday is null or weekday between 0 and 6),
  constraint chk_venue_time_slots_time_order check (ends_at_local > starts_at_local)
);

create index if not exists idx_venue_time_slots_venue on public.venue_time_slots(venue_id, weekday);

create trigger trg_venue_time_slots_updated_at
before update on public.venue_time_slots
for each row execute function public.set_updated_at();

create table if not exists public.session_requests (
  id uuid primary key default gen_random_uuid(),
  requester_host_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  approver_owner_user_id uuid references public.app_user_profiles(id) on delete set null,
  venue_id uuid not null references public.venues(id) on delete cascade,
  requested_slot_id uuid references public.venue_time_slots(id) on delete set null,
  requested_starts_at timestamptz not null,
  requested_ends_at timestamptz not null,
  requested_court_count integer not null,
  status request_status_type not null default 'pending',
  request_note text,
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_session_requests_court_count check (requested_court_count > 0),
  constraint chk_session_requests_time_order check (requested_ends_at > requested_starts_at)
);

create index if not exists idx_session_requests_requester on public.session_requests(requester_host_user_id, status);
create index if not exists idx_session_requests_venue on public.session_requests(venue_id, status);

create trigger trg_session_requests_updated_at
before update on public.session_requests
for each row execute function public.set_updated_at();

-- =========================================================
-- 5. SESSION / PARTICIPANT / WAITLIST
-- =========================================================

create table if not exists public.play_sessions (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  venue_id uuid references public.venues(id) on delete set null,
  venue_host_link_id uuid references public.venue_host_links(id) on delete set null,
  request_id uuid references public.session_requests(id) on delete set null,
  title text,
  status session_status_type not null default 'draft',
  assignment_mode assignment_mode_type not null default 'rotation_fair',
  fee_mode fee_mode_type not null default 'pay_per_session',
  allow_self_signup boolean not null default false,
  court_count integer not null default 1,
  planned_starts_at timestamptz not null,
  planned_ends_at timestamptz not null,
  started_at timestamptz,
  ended_at timestamptz,
  first_lock_charge_applied boolean not null default false,
  charge_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_play_sessions_court_count check (court_count > 0),
  constraint chk_play_sessions_time_order check (planned_ends_at > planned_starts_at)
);

create index if not exists idx_play_sessions_host on public.play_sessions(host_user_id, status, planned_starts_at desc);
create index if not exists idx_play_sessions_venue on public.play_sessions(venue_id, planned_starts_at desc);

create trigger trg_play_sessions_updated_at
before update on public.play_sessions
for each row execute function public.set_updated_at();

create table if not exists public.session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.play_sessions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  host_player_profile_id uuid references public.host_player_profiles(id) on delete set null,
  source_type session_participant_source_type not null,
  participant_status session_participant_status_type not null default 'pending',
  is_main_roster boolean not null default false,
  waitlist_order integer,
  self_level_snapshot smallint,
  confirmed_level_snapshot smallint,
  effective_level_snapshot smallint,
  level_adjustment smallint not null default 0,
  is_checked_in boolean not null default false,
  is_unavailable boolean not null default false,
  signup_at timestamptz not null default now(),
  joined_at timestamptz,
  left_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, player_id),
  constraint chk_session_participants_self_level check (self_level_snapshot is null or self_level_snapshot between 1 and 18),
  constraint chk_session_participants_confirmed_level check (confirmed_level_snapshot is null or confirmed_level_snapshot between 1 and 18),
  constraint chk_session_participants_effective_level check (effective_level_snapshot is null or effective_level_snapshot between 1 and 18),
  constraint chk_session_participants_level_adjustment check (level_adjustment between -3 and 3),
  constraint chk_session_participants_waitlist_order check (waitlist_order is null or waitlist_order > 0)
);

create index if not exists idx_session_participants_session on public.session_participants(session_id, participant_status);
create index if not exists idx_session_participants_waitlist on public.session_participants(session_id, waitlist_order) where waitlist_order is not null;
create index if not exists idx_session_participants_player on public.session_participants(player_id);

create trigger trg_session_participants_updated_at
before update on public.session_participants
for each row execute function public.set_updated_at();

create table if not exists public.session_waitlist_promotions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.play_sessions(id) on delete cascade,
  promoted_participant_id uuid not null references public.session_participants(id) on delete cascade,
  replaced_participant_id uuid references public.session_participants(id) on delete set null,
  promotion_order integer not null default 1,
  promoted_by_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_session_waitlist_promotions_session on public.session_waitlist_promotions(session_id, created_at);

create table if not exists public.session_player_status_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.play_sessions(id) on delete cascade,
  session_participant_id uuid not null references public.session_participants(id) on delete cascade,
  old_status session_participant_status_type,
  new_status session_participant_status_type not null,
  changed_by_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  change_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_session_player_status_logs_session on public.session_player_status_logs(session_id, created_at);

create table if not exists public.session_ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.play_sessions(id) on delete cascade,
  recommendation_status recommendation_status_type not null default 'draft',
  generated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  model_name text,
  rule_summary jsonb not null default '{}'::jsonb,
  recommendation_payload jsonb not null default '{}'::jsonb,
  explanation_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_session_ai_recommendations_session on public.session_ai_recommendations(session_id, created_at desc);

create trigger trg_session_ai_recommendations_updated_at
before update on public.session_ai_recommendations
for each row execute function public.set_updated_at();

-- =========================================================
-- 6. ROUNDS / MATCHES / SCORES
-- =========================================================

create table if not exists public.session_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.play_sessions(id) on delete cascade,
  round_no integer not null,
  status round_status_type not null default 'draft',
  generated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  generation_source generation_source_type not null default 'manual',
  ai_recommendation_id uuid references public.session_ai_recommendations(id) on delete set null,
  notes text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, round_no)
);

create index if not exists idx_session_rounds_session on public.session_rounds(session_id, round_no);

create trigger trg_session_rounds_updated_at
before update on public.session_rounds
for each row execute function public.set_updated_at();

create table if not exists public.round_matches (
  id uuid primary key default gen_random_uuid(),
  session_round_id uuid not null references public.session_rounds(id) on delete cascade,
  court_id uuid references public.courts(id) on delete set null,
  court_no integer,
  match_no integer not null,
  team_1_score integer,
  team_2_score integer,
  score_status score_submission_status_type not null default 'submitted',
  confirmed_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_round_id, match_no),
  constraint chk_round_matches_scores check (
    (team_1_score is null and team_2_score is null)
    or (team_1_score is not null and team_2_score is not null and team_1_score >= 0 and team_2_score >= 0)
  )
);

create index if not exists idx_round_matches_round on public.round_matches(session_round_id, match_no);

create trigger trg_round_matches_updated_at
before update on public.round_matches
for each row execute function public.set_updated_at();

create table if not exists public.round_match_players (
  id uuid primary key default gen_random_uuid(),
  round_match_id uuid not null references public.round_matches(id) on delete cascade,
  session_participant_id uuid not null references public.session_participants(id) on delete cascade,
  team_no smallint not null,
  position_no smallint not null default 1,
  created_at timestamptz not null default now(),
  unique(round_match_id, session_participant_id),
  unique(round_match_id, team_no, position_no),
  constraint chk_round_match_players_team_no check (team_no in (1,2)),
  constraint chk_round_match_players_position_no check (position_no in (1,2))
);

create index if not exists idx_round_match_players_match on public.round_match_players(round_match_id, team_no, position_no);
create index if not exists idx_round_match_players_session_participant on public.round_match_players(session_participant_id);

create table if not exists public.round_score_submissions (
  id uuid primary key default gen_random_uuid(),
  round_match_id uuid not null references public.round_matches(id) on delete cascade,
  submitted_by_player_id uuid not null references public.players(id) on delete cascade,
  team_1_score integer not null,
  team_2_score integer not null,
  status score_submission_status_type not null default 'submitted',
  submitted_at timestamptz not null default now(),
  reviewed_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  constraint chk_round_score_submissions_scores check (team_1_score >= 0 and team_2_score >= 0)
);

create index if not exists idx_round_score_submissions_match on public.round_score_submissions(round_match_id, submitted_at desc);

-- =========================================================
-- 7. SHARED NOTES / RATINGS
-- =========================================================

create table if not exists public.player_shared_notes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  note_type note_type not null default 'other',
  note_text text not null,
  created_by_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  current_version_no integer not null default 1,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_player_shared_notes_player on public.player_shared_notes(player_id, created_at desc);

create trigger trg_player_shared_notes_updated_at
before update on public.player_shared_notes
for each row execute function public.set_updated_at();

create table if not exists public.player_shared_note_versions (
  id uuid primary key default gen_random_uuid(),
  shared_note_id uuid not null references public.player_shared_notes(id) on delete cascade,
  version_no integer not null,
  note_type note_type not null,
  note_text text not null,
  edited_by_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(shared_note_id, version_no)
);

create index if not exists idx_player_shared_note_versions_note on public.player_shared_note_versions(shared_note_id, version_no desc);

create table if not exists public.player_ratings (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  rater_host_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  venue_owner_user_id uuid references public.app_user_profiles(id) on delete set null,
  quick_rating smallint,
  overall_stars smallint,
  punctuality_score smallint,
  attitude_score smallint,
  reliability_score smallint,
  skill_match_score smallint,
  comment_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_player_ratings_quick_rating check (quick_rating is null or quick_rating between 1 and 3),
  constraint chk_player_ratings_overall_stars check (overall_stars is null or overall_stars between 1 and 5),
  constraint chk_player_ratings_punctuality check (punctuality_score is null or punctuality_score between 1 and 5),
  constraint chk_player_ratings_attitude check (attitude_score is null or attitude_score between 1 and 5),
  constraint chk_player_ratings_reliability check (reliability_score is null or reliability_score between 1 and 5),
  constraint chk_player_ratings_skill_match check (skill_match_score is null or skill_match_score between 1 and 5)
);

create index if not exists idx_player_ratings_player on public.player_ratings(player_id, created_at desc);
create index if not exists idx_player_ratings_rater on public.player_ratings(rater_host_user_id, created_at desc);

create trigger trg_player_ratings_updated_at
before update on public.player_ratings
for each row execute function public.set_updated_at();

-- =========================================================
-- 8. BILLING / WALLET / SUBSCRIPTIONS
-- =========================================================

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  billing_interval billing_interval_type not null,
  price_amount numeric(12,2) not null,
  currency_code text not null default 'TWD',
  fee_mode fee_mode_type not null,
  trial_days integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_subscription_plans_price check (price_amount >= 0),
  constraint chk_subscription_plans_trial_days check (trial_days >= 0)
);

create trigger trg_subscription_plans_updated_at
before update on public.subscription_plans
for each row execute function public.set_updated_at();

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status subscription_status_type not null default 'trialing',
  started_at timestamptz not null default now(),
  trial_ends_at timestamptz,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  auto_renew boolean not null default true,
  external_customer_id text,
  external_subscription_id text,
  cancelled_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_user on public.subscriptions(user_id, status);

create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create table if not exists public.wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.app_user_profiles(id) on delete cascade,
  balance_amount numeric(12,2) not null default 0,
  currency_code text not null default 'TWD',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_wallet_accounts_balance check (balance_amount >= 0)
);

create trigger trg_wallet_accounts_updated_at
before update on public.wallet_accounts
for each row execute function public.set_updated_at();

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade,
  transaction_type wallet_transaction_type not null,
  status wallet_transaction_status_type not null default 'pending',
  amount numeric(12,2) not null,
  balance_before numeric(12,2),
  balance_after numeric(12,2),
  reference_type text,
  reference_id uuid,
  external_reference text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_wallet_transactions_amount check (amount <> 0)
);

create index if not exists idx_wallet_transactions_wallet on public.wallet_transactions(wallet_account_id, created_at desc);
create index if not exists idx_wallet_transactions_reference on public.wallet_transactions(reference_type, reference_id);

create trigger trg_wallet_transactions_updated_at
before update on public.wallet_transactions
for each row execute function public.set_updated_at();

create table if not exists public.usage_charges (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.play_sessions(id) on delete cascade,
  charged_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  amount numeric(12,2) not null,
  currency_code text not null default 'TWD',
  status usage_charge_status_type not null default 'pending',
  charge_reason text not null default 'session_first_lock_charge',
  wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null,
  external_payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_usage_charges_amount check (amount >= 0)
);

create index if not exists idx_usage_charges_user on public.usage_charges(charged_user_id, status, created_at desc);

create trigger trg_usage_charges_updated_at
before update on public.usage_charges
for each row execute function public.set_updated_at();

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_user_profiles(id) on delete set null,
  event_type text not null,
  provider_name text not null,
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider_name, provider_event_id)
);

create index if not exists idx_payment_events_user on public.payment_events(user_id, created_at desc);

-- =========================================================
-- 9. NOTIFICATIONS / AUDIT
-- =========================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  notification_type notification_type not null,
  title text not null,
  body_text text,
  payload jsonb not null default '{}'::jsonb,
  status notification_status_type not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists idx_notifications_user on public.notifications(user_id, status, created_at desc);

create trigger trg_notifications_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  action_type text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_actor on public.audit_logs(actor_user_id, created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs(entity_type, entity_id, created_at desc);

-- =========================================================
-- 10. OPTIONAL HELPER VIEWS
-- =========================================================

create or replace view public.v_player_rating_summary as
select
  pr.player_id,
  count(*) as rating_count,
  round(avg(pr.overall_stars)::numeric, 2) as avg_overall_stars,
  round(avg(pr.punctuality_score)::numeric, 2) as avg_punctuality_score,
  round(avg(pr.attitude_score)::numeric, 2) as avg_attitude_score,
  round(avg(pr.reliability_score)::numeric, 2) as avg_reliability_score,
  round(avg(pr.skill_match_score)::numeric, 2) as avg_skill_match_score,
  round(avg(pr.quick_rating)::numeric, 2) as avg_quick_rating
from public.player_ratings pr
group by pr.player_id;

create or replace view public.v_session_participant_stats as
select
  sp.session_id,
  sp.id as session_participant_id,
  sp.player_id,
  count(distinct rmp.round_match_id) as match_count,
  sum(case when rm.team_1_score is not null and rm.team_2_score is not null and (
    (rmp.team_no = 1 and rm.team_1_score > rm.team_2_score) or
    (rmp.team_no = 2 and rm.team_2_score > rm.team_1_score)
  ) then 1 else 0 end) as win_count
from public.session_participants sp
left join public.round_match_players rmp on rmp.session_participant_id = sp.id
left join public.round_matches rm on rm.id = rmp.round_match_id
group by sp.session_id, sp.id, sp.player_id;

commit;
