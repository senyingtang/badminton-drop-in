
-- 002_rls_policies.sql
-- 說明：
-- 1. 本檔為 Supabase RLS 初版，目標是讓 platform_admin / venue_owner / host / player 各自只能看到需要的資料。
-- 2. 金流 webhook 與系統後台匯出流程建議走 service role，因此 payment_provider_events 等表不開放一般 authenticated 使用者。
-- 3. 若前端使用 public signup code 進行未登入預覽，建議透過 Edge Function / server route 搭配 service role 控制，而不是直接依賴 anon RLS。

begin;

-- =========================================================
-- 1. Helper functions for RLS
-- =========================================================

create or replace function public.current_user_profile_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create or replace function public.current_app_role()
returns app_role
language sql
stable
as $$
  select primary_role
  from public.app_user_profiles
  where id = auth.uid()
  limit 1;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.app_user_profiles
    where id = auth.uid()
      and primary_role = 'platform_admin'
  );
$$;

create or replace function public.is_venue_owner()
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.app_user_profiles
    where id = auth.uid()
      and primary_role = 'venue_owner'
  );
$$;

create or replace function public.is_host()
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.app_user_profiles
    where id = auth.uid()
      and primary_role = 'host'
  );
$$;

create or replace function public.auth_player_id()
returns uuid
language sql
stable
as $$
  select p.id
  from public.players p
  where p.auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.user_manages_venue(input_venue_id uuid)
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.venues v
    where v.id = input_venue_id
      and v.owner_user_id = auth.uid()
  )
  or public.is_platform_admin();
$$;

create or replace function public.user_is_host_member_of_venue(input_venue_id uuid)
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.venue_host_memberships vhm
    where vhm.venue_id = input_venue_id
      and vhm.host_user_id = auth.uid()
      and vhm.is_active = true
  )
  or public.is_platform_admin();
$$;

create or replace function public.user_can_access_session(input_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.sessions s
    where s.id = input_session_id
      and (
        s.host_user_id = auth.uid()
        or public.user_manages_venue(s.venue_id)
        or exists (
          select 1
          from public.session_participants sp
          join public.players p on p.id = sp.player_id
          where sp.session_id = s.id
            and p.auth_user_id = auth.uid()
        )
      )
  )
  or public.is_platform_admin();
$$;

create or replace function public.user_is_session_host(input_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.sessions s
    where s.id = input_session_id
      and s.host_user_id = auth.uid()
  )
  or public.is_platform_admin();
$$;

-- Bypass RLS: used by sessions_select_related (avoids sessions → players → sessions loop)
create or replace function public.auth_user_is_session_participant(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.session_participants sp
    join public.players p on p.id = sp.player_id
    where sp.session_id = p_session_id
      and p.auth_user_id = auth.uid()
  );
$$;

create or replace function public.user_can_access_player(input_player_id uuid)
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.players p
    where p.id = input_player_id
      and p.auth_user_id = auth.uid()
  )
  or public.is_host()
  or public.is_venue_owner()
  or public.is_platform_admin();
$$;

-- =========================================================
-- 2. Enable RLS
-- =========================================================

alter table public.app_user_profiles enable row level security;
alter table public.user_role_memberships enable row level security;
alter table public.players enable row level security;
alter table public.host_player_profiles enable row level security;
alter table public.host_player_level_adjustments enable row level security;
alter table public.player_shared_notes enable row level security;
alter table public.player_shared_note_history enable row level security;
alter table public.player_ratings enable row level security;
alter table public.player_rating_summary enable row level security;
alter table public.venues enable row level security;
alter table public.courts enable row level security;
alter table public.venue_host_memberships enable row level security;
alter table public.venue_time_slots enable row level security;
alter table public.host_session_requests enable row level security;
alter table public.sessions enable row level security;
alter table public.session_participants enable row level security;
alter table public.session_waitlist_promotions enable row level security;
alter table public.session_events enable row level security;
alter table public.assignment_recommendations enable row level security;
alter table public.assignment_recommendation_items enable row level security;
alter table public.rounds enable row level security;
alter table public.matches enable row level security;
alter table public.match_teams enable row level security;
alter table public.match_team_players enable row level security;
alter table public.match_score_submissions enable row level security;
alter table public.billing_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.wallet_accounts enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.usage_charges enable row level security;
alter table public.payment_provider_customers enable row level security;
alter table public.payment_provider_payment_methods enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- =========================================================
-- 3. app_user_profiles / roles
-- =========================================================

create policy app_user_profiles_select_self_or_admin
on public.app_user_profiles
for select
using (id = auth.uid() or public.is_platform_admin());

create policy app_user_profiles_update_self_or_admin
on public.app_user_profiles
for update
using (id = auth.uid() or public.is_platform_admin())
with check (id = auth.uid() or public.is_platform_admin());

create policy app_user_profiles_insert_self
on public.app_user_profiles
for insert
with check (id = auth.uid() or public.is_platform_admin());

create policy user_role_memberships_read_related
on public.user_role_memberships
for select
using (
  user_id = auth.uid()
  or public.is_platform_admin()
);

-- =========================================================
-- 4. players / host player data
-- =========================================================

create policy players_select
on public.players
for select
using (public.user_can_access_player(id));

create policy players_insert_self_or_admin
on public.players
for insert
with check (
  auth_user_id = auth.uid()
  or public.is_platform_admin()
  or public.is_host()
  or public.is_venue_owner()
);

create policy players_update_self_or_admin
on public.players
for update
using (
  auth_user_id = auth.uid()
  or public.is_platform_admin()
)
with check (
  auth_user_id = auth.uid()
  or public.is_platform_admin()
);

create policy host_player_profiles_select_related
on public.host_player_profiles
for select
using (
  host_user_id = auth.uid()
  or public.is_platform_admin()
  or public.user_manages_venue(
    (select s.venue_id from public.sessions s where s.host_user_id = host_player_profiles.host_user_id limit 1)
  )
);

create policy host_player_profiles_insert_host_or_admin
on public.host_player_profiles
for insert
with check (
  host_user_id = auth.uid()
  or public.is_platform_admin()
);

create policy host_player_profiles_update_host_or_admin
on public.host_player_profiles
for update
using (
  host_user_id = auth.uid()
  or public.is_platform_admin()
)
with check (
  host_user_id = auth.uid()
  or public.is_platform_admin()
);

create policy hpla_select_related
on public.host_player_level_adjustments
for select
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.host_player_profiles hpp
    where hpp.id = host_player_level_adjustments.host_player_profile_id
      and hpp.host_user_id = auth.uid()
  )
);

create policy hpla_insert_related
on public.host_player_level_adjustments
for insert
with check (
  public.is_platform_admin()
  or exists (
    select 1
    from public.host_player_profiles hpp
    where hpp.id = host_player_level_adjustments.host_player_profile_id
      and hpp.host_user_id = auth.uid()
  )
);

-- =========================================================
-- 5. shared notes / ratings
-- =========================================================

create policy player_shared_notes_select_host_owner_admin
on public.player_shared_notes
for select
using (
  public.is_platform_admin()
  or public.is_host()
  or public.is_venue_owner()
);

create policy player_shared_notes_insert_host_owner_admin
on public.player_shared_notes
for insert
with check (
  public.is_platform_admin()
  or public.is_host()
  or public.is_venue_owner()
);

create policy player_shared_notes_update_creator_or_admin
on public.player_shared_notes
for update
using (
  created_by_host_user_id = auth.uid()
  or public.is_platform_admin()
)
with check (
  created_by_host_user_id = auth.uid()
  or public.is_platform_admin()
);

create policy player_shared_note_history_select_host_owner_admin
on public.player_shared_note_history
for select
using (
  public.is_platform_admin()
  or public.is_host()
  or public.is_venue_owner()
);

create policy player_ratings_select_host_owner_admin
on public.player_ratings
for select
using (
  public.is_platform_admin()
  or public.is_host()
  or public.is_venue_owner()
);

create policy player_ratings_insert_host_owner_admin
on public.player_ratings
for insert
with check (
  public.is_platform_admin()
  or public.is_host()
  or public.is_venue_owner()
);

create policy player_ratings_update_creator_or_admin
on public.player_ratings
for update
using (
  rated_by_host_user_id = auth.uid()
  or public.is_platform_admin()
)
with check (
  rated_by_host_user_id = auth.uid()
  or public.is_platform_admin()
);

create policy player_rating_summary_select_host_owner_admin
on public.player_rating_summary
for select
using (
  public.is_platform_admin()
  or public.is_host()
  or public.is_venue_owner()
);

-- =========================================================
-- 6. venue / slot / host memberships
-- =========================================================

create policy venues_select_related
on public.venues
for select
using (
  owner_user_id = auth.uid()
  or public.user_is_host_member_of_venue(id)
  or public.is_platform_admin()
);

create policy venues_insert_owner_or_admin
on public.venues
for insert
with check (
  owner_user_id = auth.uid()
  or public.is_platform_admin()
);

create policy venues_update_owner_or_admin
on public.venues
for update
using (
  owner_user_id = auth.uid()
  or public.is_platform_admin()
)
with check (
  owner_user_id = auth.uid()
  or public.is_platform_admin()
);

create policy courts_select_related
on public.courts
for select
using (
  public.user_manages_venue(venue_id)
  or public.user_is_host_member_of_venue(venue_id)
);

create policy courts_write_owner_or_admin
on public.courts
for all
using (
  public.user_manages_venue(venue_id)
)
with check (
  public.user_manages_venue(venue_id)
);

create policy venue_host_memberships_select_related
on public.venue_host_memberships
for select
using (
  host_user_id = auth.uid()
  or public.user_manages_venue(venue_id)
  or public.is_platform_admin()
);

create policy venue_host_memberships_write_owner_or_admin
on public.venue_host_memberships
for all
using (
  public.user_manages_venue(venue_id)
)
with check (
  public.user_manages_venue(venue_id)
);

create policy venue_time_slots_select_related
on public.venue_time_slots
for select
using (
  public.user_manages_venue(venue_id)
  or public.user_is_host_member_of_venue(venue_id)
  or public.is_platform_admin()
);

create policy venue_time_slots_write_owner_or_admin
on public.venue_time_slots
for all
using (
  public.user_manages_venue(venue_id)
)
with check (
  public.user_manages_venue(venue_id)
);

create policy host_session_requests_select_related
on public.host_session_requests
for select
using (
  host_user_id = auth.uid()
  or public.user_manages_venue(venue_id)
  or public.is_platform_admin()
);

create policy host_session_requests_insert_host_or_admin
on public.host_session_requests
for insert
with check (
  host_user_id = auth.uid()
  or public.is_platform_admin()
);

create policy host_session_requests_update_related
on public.host_session_requests
for update
using (
  host_user_id = auth.uid()
  or public.user_manages_venue(venue_id)
  or public.is_platform_admin()
)
with check (
  host_user_id = auth.uid()
  or public.user_manages_venue(venue_id)
  or public.is_platform_admin()
);

-- =========================================================
-- 7. sessions / participants / rounds / matches
-- =========================================================

create policy sessions_select_related
on public.sessions
for select
using (
  host_user_id = auth.uid()
  or public.user_manages_venue(venue_id)
  or public.auth_user_is_session_participant(id)
  or public.is_platform_admin()
);

create policy sessions_insert_host_owner_admin
on public.sessions
for insert
with check (
  host_user_id = auth.uid()
  or created_by_user_id = auth.uid()
  or public.user_manages_venue(venue_id)
  or public.is_platform_admin()
);

create policy sessions_update_host_owner_admin
on public.sessions
for update
using (
  host_user_id = auth.uid()
  or public.user_manages_venue(venue_id)
  or public.is_platform_admin()
)
with check (
  host_user_id = auth.uid()
  or public.user_manages_venue(venue_id)
  or public.is_platform_admin()
);

create policy session_participants_select_related
on public.session_participants
for select
using (
  public.user_can_access_session(session_id)
);

create policy session_participants_insert_related
on public.session_participants
for insert
with check (
  public.user_is_session_host(session_id)
  or public.is_platform_admin()
  or (
    source_type = 'self_signup'
    and player_id = public.auth_player_id()
    and exists (
      select 1
      from public.sessions s
      where s.id = session_participants.session_id
        and s.allow_self_signup = true
    )
  )
);

create policy session_participants_update_related
on public.session_participants
for update
using (
  public.user_is_session_host(session_id)
  or public.is_platform_admin()
  or (
    player_id = public.auth_player_id()
    and status in ('pending','waitlist','cancelled')
  )
)
with check (
  public.user_is_session_host(session_id)
  or public.is_platform_admin()
  or (
    player_id = public.auth_player_id()
    and status in ('pending','waitlist','cancelled')
  )
);

create policy session_waitlist_promotions_select_related
on public.session_waitlist_promotions
for select
using (
  public.user_can_access_session(session_id)
);

create policy session_waitlist_promotions_insert_host_owner_admin
on public.session_waitlist_promotions
for insert
with check (
  public.user_is_session_host(session_id)
  or public.user_can_access_session(session_id) and public.is_venue_owner()
  or public.is_platform_admin()
);

create policy session_events_select_related
on public.session_events
for select
using (
  public.user_can_access_session(session_id)
);

create policy session_events_insert_host_owner_admin
on public.session_events
for insert
with check (
  public.user_is_session_host(session_id)
  or public.user_manages_venue((select s.venue_id from public.sessions s where s.id = session_id))
  or public.is_platform_admin()
);

create policy assignment_recommendations_select_related
on public.assignment_recommendations
for select
using (
  public.user_can_access_session(session_id)
);

create policy assignment_recommendations_write_host_owner_admin
on public.assignment_recommendations
for all
using (
  public.user_is_session_host(session_id)
  or public.user_manages_venue((select s.venue_id from public.sessions s where s.id = session_id))
  or public.is_platform_admin()
)
with check (
  public.user_is_session_host(session_id)
  or public.user_manages_venue((select s.venue_id from public.sessions s where s.id = session_id))
  or public.is_platform_admin()
);

create policy assignment_recommendation_items_select_related
on public.assignment_recommendation_items
for select
using (
  exists (
    select 1
    from public.assignment_recommendations ar
    where ar.id = assignment_recommendation_items.recommendation_id
      and public.user_can_access_session(ar.session_id)
  )
);

create policy assignment_recommendation_items_write_host_owner_admin
on public.assignment_recommendation_items
for all
using (
  exists (
    select 1
    from public.assignment_recommendations ar
    join public.sessions s on s.id = ar.session_id
    where ar.id = assignment_recommendation_items.recommendation_id
      and (s.host_user_id = auth.uid() or public.user_manages_venue(s.venue_id) or public.is_platform_admin())
  )
)
with check (
  exists (
    select 1
    from public.assignment_recommendations ar
    join public.sessions s on s.id = ar.session_id
    where ar.id = assignment_recommendation_items.recommendation_id
      and (s.host_user_id = auth.uid() or public.user_manages_venue(s.venue_id) or public.is_platform_admin())
  )
);

create policy rounds_select_related
on public.rounds
for select
using (
  public.user_can_access_session(session_id)
);

create policy rounds_write_host_owner_admin
on public.rounds
for all
using (
  public.user_is_session_host(session_id)
  or public.user_manages_venue((select s.venue_id from public.sessions s where s.id = session_id))
  or public.is_platform_admin()
)
with check (
  public.user_is_session_host(session_id)
  or public.user_manages_venue((select s.venue_id from public.sessions s where s.id = session_id))
  or public.is_platform_admin()
);

create policy matches_select_related
on public.matches
for select
using (
  public.user_can_access_session(session_id)
);

create policy matches_write_host_owner_admin
on public.matches
for all
using (
  public.user_is_session_host(session_id)
  or public.user_manages_venue((select s.venue_id from public.sessions s where s.id = session_id))
  or public.is_platform_admin()
)
with check (
  public.user_is_session_host(session_id)
  or public.user_manages_venue((select s.venue_id from public.sessions s where s.id = session_id))
  or public.is_platform_admin()
);

create policy match_teams_select_related
on public.match_teams
for select
using (
  exists (
    select 1
    from public.matches m
    where m.id = match_teams.match_id
      and public.user_can_access_session(m.session_id)
  )
);

create policy match_teams_write_host_owner_admin
on public.match_teams
for all
using (
  exists (
    select 1
    from public.matches m
    join public.sessions s on s.id = m.session_id
    where m.id = match_teams.match_id
      and (s.host_user_id = auth.uid() or public.user_manages_venue(s.venue_id) or public.is_platform_admin())
  )
)
with check (
  exists (
    select 1
    from public.matches m
    join public.sessions s on s.id = m.session_id
    where m.id = match_teams.match_id
      and (s.host_user_id = auth.uid() or public.user_manages_venue(s.venue_id) or public.is_platform_admin())
  )
);

create policy match_team_players_select_related
on public.match_team_players
for select
using (
  exists (
    select 1
    from public.match_teams mt
    join public.matches m on m.id = mt.match_id
    where mt.id = match_team_players.match_team_id
      and public.user_can_access_session(m.session_id)
  )
);

create policy match_team_players_write_host_owner_admin
on public.match_team_players
for all
using (
  exists (
    select 1
    from public.match_teams mt
    join public.matches m on m.id = mt.match_id
    join public.sessions s on s.id = m.session_id
    where mt.id = match_team_players.match_team_id
      and (s.host_user_id = auth.uid() or public.user_manages_venue(s.venue_id) or public.is_platform_admin())
  )
)
with check (
  exists (
    select 1
    from public.match_teams mt
    join public.matches m on m.id = mt.match_id
    join public.sessions s on s.id = m.session_id
    where mt.id = match_team_players.match_team_id
      and (s.host_user_id = auth.uid() or public.user_manages_venue(s.venue_id) or public.is_platform_admin())
  )
);

create policy match_score_submissions_select_related
on public.match_score_submissions
for select
using (
  exists (
    select 1
    from public.matches m
    where m.id = match_score_submissions.match_id
      and public.user_can_access_session(m.session_id)
  )
);

create policy match_score_submissions_insert_player_host_admin
on public.match_score_submissions
for insert
with check (
  public.is_platform_admin()
  or exists (
    select 1
    from public.matches m
    join public.match_teams mt on mt.match_id = m.id
    join public.match_team_players mtp on mtp.match_team_id = mt.id
    join public.session_participants sp on sp.id = mtp.participant_id
    where m.id = match_score_submissions.match_id
      and sp.player_id = match_score_submissions.submitted_by_player_id
      and match_score_submissions.submitted_by_player_id = public.auth_player_id()
  )
);

create policy match_score_submissions_update_host_owner_admin
on public.match_score_submissions
for update
using (
  exists (
    select 1
    from public.matches m
    join public.sessions s on s.id = m.session_id
    where m.id = match_score_submissions.match_id
      and (s.host_user_id = auth.uid() or public.user_manages_venue(s.venue_id) or public.is_platform_admin())
  )
)
with check (
  exists (
    select 1
    from public.matches m
    join public.sessions s on s.id = m.session_id
    where m.id = match_score_submissions.match_id
      and (s.host_user_id = auth.uid() or public.user_manages_venue(s.venue_id) or public.is_platform_admin())
  )
);

-- =========================================================
-- 8. billing / wallet / notifications
-- =========================================================

create policy billing_plans_select_all_authenticated
on public.billing_plans
for select
using (auth.uid() is not null);

create policy billing_plans_write_admin_only
on public.billing_plans
for all
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy subscriptions_select_owner_or_admin
on public.subscriptions
for select
using (
  subscriber_user_id = auth.uid()
  or public.is_platform_admin()
);

create policy subscriptions_write_owner_or_admin
on public.subscriptions
for all
using (
  subscriber_user_id = auth.uid()
  or public.is_platform_admin()
)
with check (
  subscriber_user_id = auth.uid()
  or public.is_platform_admin()
);

create policy wallet_accounts_select_owner_or_admin
on public.wallet_accounts
for select
using (
  owner_user_id = auth.uid()
  or public.is_platform_admin()
);

create policy wallet_accounts_write_owner_or_admin
on public.wallet_accounts
for all
using (
  owner_user_id = auth.uid()
  or public.is_platform_admin()
)
with check (
  owner_user_id = auth.uid()
  or public.is_platform_admin()
);

create policy wallet_transactions_select_owner_or_admin
on public.wallet_transactions
for select
using (
  exists (
    select 1
    from public.wallet_accounts wa
    where wa.id = wallet_transactions.wallet_account_id
      and (wa.owner_user_id = auth.uid() or public.is_platform_admin())
  )
);

create policy wallet_transactions_insert_owner_or_admin
on public.wallet_transactions
for insert
with check (
  exists (
    select 1
    from public.wallet_accounts wa
    where wa.id = wallet_transactions.wallet_account_id
      and (wa.owner_user_id = auth.uid() or public.is_platform_admin())
  )
);

create policy usage_charges_select_owner_or_admin
on public.usage_charges
for select
using (
  billed_user_id = auth.uid()
  or public.is_platform_admin()
);

create policy payment_provider_customers_select_owner_or_admin
on public.payment_provider_customers
for select
using (
  user_id = auth.uid()
  or public.is_platform_admin()
);

create policy payment_provider_payment_methods_select_owner_or_admin
on public.payment_provider_payment_methods
for select
using (
  user_id = auth.uid()
  or public.is_platform_admin()
);

create policy payment_provider_payment_methods_write_owner_or_admin
on public.payment_provider_payment_methods
for all
using (
  user_id = auth.uid()
  or public.is_platform_admin()
)
with check (
  user_id = auth.uid()
  or public.is_platform_admin()
);

create policy notifications_select_owner_or_admin
on public.notifications
for select
using (
  user_id = auth.uid()
  or public.is_platform_admin()
);

create policy notifications_update_owner_or_admin
on public.notifications
for update
using (
  user_id = auth.uid()
  or public.is_platform_admin()
)
with check (
  user_id = auth.uid()
  or public.is_platform_admin()
);

create policy audit_logs_select_admin_only
on public.audit_logs
for select
using (
  public.is_platform_admin()
);

commit;
