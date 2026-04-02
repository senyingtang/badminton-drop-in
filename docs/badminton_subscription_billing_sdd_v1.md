# Badminton Headless Platform — Subscription / Billing / Quota / Upgrade SDD v1

## 1. Purpose
This document defines the complete subscription, billing, quota, trial, overage charging, quota UI, and upgrade flow for the badminton pickup-session headless platform.

This document is written so that an AI Agent or engineer can:
1. understand all billing-domain entities;
2. implement the SQL schema and business rules;
3. implement frontend quota UI and upgrade flow in Next.js + Supabase;
4. know exactly when quota is consumed, when overage is charged, and how plan limits are enforced.

---

## 2. Product Packaging

### 2.1 Personal Plan
- plan_code: `personal_monthly_350`
- monthly_price_twd: `350`
- billing_cycle: `monthly`
- seats included: `1`
- monthly session quota per seat: `8`
- extra session overage price: `50` TWD per session
- player roster sharing: `false`
- cross-host player ratings visibility: `true`
- cross-host player comments visibility: `shared_rating_tags_only`, not raw private notes

### 2.2 Organization Plan
- plan_code: `org_5_hosts_1500`
- monthly_price_twd: `1500`
- billing_cycle: `monthly`
- included host seats: `5`
- monthly quota per host seat: `10`
- quota model: `per_host_per_month`
- extra session overage price: `50` TWD per extra session, billed to the organization owner wallet or invoice bucket
- player roster sharing: `false`
- cross-host player ratings visibility: `true`
- raw player private notes: `not shared`

### 2.3 Trial
- trial model: session-count based
- recommended default trial sessions:
  - personal: `3`
  - organization owner sandbox: `3` total org trial sessions OR `2` per host seat (choose one in config; default below)
- default implementation in this spec:
  - personal: `3` trial sessions
  - organization: `5` pooled trial sessions for the org before subscription activation
- after trial is exhausted:
  - subscription required;
  - if auto-renew authorization exists and subscription is active, normal quota is used;
  - if no active subscription and no wallet balance or no payment method, session start is blocked.

---

## 3. Core Billing Decisions

### 3.1 Quota ownership
- Personal plan quota is owned by the subscribing user.
- Organization plan quota is owned **per host seat**.
- The organization owner does not get to freely pool all host quotas into one big bucket in v1.
- Each host in an organization has an independent monthly quota counter.

### 3.2 Quota reset rule
- Quota resets on the subscription billing anchor day each month.
- Example:
  - subscription started on 2026-04-05;
  - quota period is 2026-04-05 00:00:00 to 2026-05-04 23:59:59 local billing timezone.
- This avoids ambiguity and keeps quota aligned to paid billing periods.

### 3.3 Unused quota carry-over
- No carry-over in v1.
- Unused quota expires at the end of the billing period.

### 3.4 Overage rule
- If quota is exhausted and subscription is still active, session start is still allowed.
- The system creates an overage charge at `50` TWD per extra started session.
- Overage can be handled in two ways:
  1. wallet debit immediately if wallet balance is sufficient;
  2. if wallet balance is insufficient, create accounts-receivable/open item and mark billing status as `pending_collection`.
- Default v1 behavior:
  - attempt wallet debit first;
  - if wallet insufficient, block the session start unless `allow_negative_wallet_for_overage = true` in settings.

### 3.5 When quota is consumed
Quota is consumed only once per session.
- Trigger point: the **first successful round lock / first official `開打`** for a session.
- Quota is not consumed when:
  - creating a draft session;
  - editing participants;
  - generating suggested groupings;
  - cancelling before first official start.

### 3.6 Billing idempotency
For every billable session start, the system must guarantee idempotency.
- same session may only consume quota once;
- same session may only create one overage charge once;
- retrying the RPC must not double-charge.

### 3.7 Subscription expiration behavior
If a subscription expires:
- all new session starts are blocked;
- data becomes read-only in the UI;
- exports require support intervention;
- active in-progress rounds may be allowed to finish if `grace_finish_active_session = true`.

Default v1:
- drafts remain visible but read-only;
- no new round lock allowed if not already billed/authorized.

---

## 4. Terms / Domain Model

### 4.1 Billing account
A billable owner.
- personal account => one user
- organization account => one organization entity

### 4.2 Subscription
The commercial agreement for a billing account to use a plan.

### 4.3 Entitlement
The effective access rights produced by an active subscription.
Examples:
- maximum host seats
- quota per period
- overage price
- trial allowance

### 4.4 Quota ledger
A record of quota consumption or return adjustment.
Examples:
- trial consumption
- monthly quota consumption
- manual admin adjustment
- reversal

### 4.5 Billing transaction
A money-related event.
Examples:
- subscription charge
- renewal
- overage charge
- wallet top-up
- refund

---

## 5. Access and Visibility Rules

### 5.1 Shared vs private data
Shared cross-host data:
- player public handle / login ID if globally known;
- aggregate rating score;
- aggregate rating count;
- structured rating tags;
- warning status if designed as a shared moderation outcome.

Private per-host data:
- host-specific roster membership;
- host private comments;
- host internal notes;
- attendance-specific remarks.

### 5.2 Organization roster sharing
- Organization members do **not** automatically share player rosters in v1.
- Ratings remain visible across hosts and organizations according to the chosen policy.

---

## 6. SQL Implementation Strategy

### 6.1 New entities to add
The following tables must exist in addition to the core badminton session tables:
1. `kb_organizations`
2. `kb_organization_members`
3. `kb_plans`
4. `kb_plan_entitlements`
5. `kb_billing_accounts`
6. `kb_subscriptions`
7. `kb_subscription_periods`
8. `kb_payment_methods`
9. `kb_wallets`
10. `kb_wallet_transactions`
11. `kb_quota_buckets`
12. `kb_quota_ledger`
13. `kb_billing_charges`
14. `kb_billing_invoices`
15. `kb_billing_invoice_lines`
16. `kb_usage_events`
17. `kb_feature_flags`
18. `kb_system_settings`

### 6.2 Existing core tables touched by billing
These existing or planned session tables need billing references/columns:
1. `kb_sessions`
   - `billing_account_id`
   - `billing_status`
   - `first_started_at`
   - `quota_consumed_at`
   - `quota_ledger_id`
   - `overage_charge_id`
2. `kb_rounds`
   - no direct billing field required, but first round lock is the trigger
3. `kb_hosts` or host membership mapping
   - must connect host users to billing ownership route

---

## 7. Frontend MVP Scope for Billing

### 7.1 Required pages/components
1. `DashboardQuotaCard`
2. `BillingPlanCard`
3. `UsageProgressBar`
4. `UpgradePlanModal`
5. `ManageSeatsPanel` (organization only)
6. `WalletBalanceCard`
7. `RenewalStatusBanner`
8. `OverageWarningDialog`
9. `SessionStartBillingConfirmDialog`

### 7.2 Required routes
- `/dashboard`
- `/billing`
- `/billing/upgrade`
- `/billing/wallet`
- `/organization/members`
- `/session/[id]/live`

---

## 8. Quota UI Requirements

### 8.1 Dashboard quota card
For personal plan:
- plan name
- current period start/end
- used sessions / monthly quota
- remaining sessions
- overage sessions count this period
- next renewal date
- subscription status

For organization plan:
- organization plan name
- organization renewal date
- seat usage summary
- per-host quota cards:
  - host display name
  - used / quota
  - remaining
  - overage count
- CTA to manage seats

### 8.2 Threshold warnings
Show warnings when a user reaches:
- 70% of quota used
- 90% of quota used
- 100% of quota used
- entering overage

### 8.3 Session start confirmation
When host clicks `開打` for the first time in a session, the UI must call a preflight endpoint and display:
- session billability status
- remaining quota
- whether this action will consume quota or trial
- whether this action will create an overage charge
- whether wallet balance is sufficient
- confirm button

---

## 9. Upgrade Flow Requirements

### 9.1 Personal -> Organization
Flow:
1. user clicks `升級團體方案`;
2. UI loads available plans;
3. user chooses organization plan;
4. if user has no organization, create one;
5. assign self as organization owner;
6. collect or confirm payment method;
7. create subscription draft;
8. confirm pricing summary;
9. activate subscription;
10. create initial quota buckets for owner seat and available seats;
11. redirect to invite/manage host members.

### 9.2 Organization seat management
- owner can invite up to included seats;
- if trying to add beyond included seats:
  - either block;
  - or offer add-on seat pricing;
- v1 default: block above included seats.

### 9.3 Proration
v1 default:
- no proration complexity;
- upgrade becomes active immediately;
- any remaining personal period is not refunded automatically;
- support/admin can issue manual credit if desired.

---

## 10. API / RPC Requirements

### 10.1 Required RPC functions
1. `kb_billing_preflight_session_start(p_session_id uuid)`
   - validates host permission
   - resolves billing account
   - returns billing decision payload
2. `kb_billing_consume_on_session_start(p_session_id uuid)`
   - idempotent
   - consumes trial or quota or creates overage
3. `kb_wallet_topup_create(...)`
4. `kb_subscription_activate(...)`
5. `kb_subscription_renew(...)`
6. `kb_subscription_cancel_at_period_end(...)`
7. `kb_org_invite_host(...)`
8. `kb_org_assign_host_seat(...)`
9. `kb_get_quota_dashboard(p_user_id uuid default auth.uid())`

### 10.2 Session start sequence
When host clicks first `開打`:
1. frontend calls `kb_billing_preflight_session_start`;
2. frontend shows confirmation;
3. frontend calls `kb_billing_consume_on_session_start`;
4. if success, frontend calls round lock RPC;
5. if any step fails, do not lock round.

---

## 11. AI Agent Implementation Order

### Phase 1 — Billing foundation
1. run SQL migration for plans, accounts, subscriptions, wallets, quota, charges;
2. seed plans and entitlements;
3. create preflight and consume RPCs;
4. add billing columns to sessions;
5. write acceptance tests.

### Phase 2 — Dashboard UI
1. build `/billing` page;
2. build quota cards and progress bars;
3. build wallet card;
4. build renewal banner.

### Phase 3 — Upgrade flow
1. build upgrade page/modal;
2. build organization creation form;
3. build seat management view;
4. build payment method setup flow placeholder.

### Phase 4 — Session integration
1. wire session live page to preflight RPC;
2. show session billing confirmation;
3. consume quota/trial/overage before round lock;
4. show post-start success state.

---

## 12. Acceptance Criteria

### 12.1 Personal plan happy path
- user has active personal subscription;
- used quota 3/8;
- starts a new session;
- preflight returns `consume_mode = monthly_quota`;
- consume RPC increments used to 4/8;
- session gets `quota_consumed_at` and `billing_status = quota_consumed`.

### 12.2 Personal overage path
- user has active personal subscription;
- used quota 8/8;
- wallet balance >= 50;
- starts a new session;
- preflight returns `consume_mode = overage`;
- consume RPC debits wallet by 50;
- creates billing charge;
- session billing status becomes `overage_charged`.

### 12.3 Personal blocked overage
- used quota 8/8;
- wallet balance < 50;
- negative overage disabled;
- preflight returns `will_block = true`;
- UI shows top-up required;
- round lock is prevented.

### 12.4 Organization per-host quota
- organization has 2 hosts;
- host A used 9/10;
- host B used 2/10;
- host A starts session;
- only host A counter becomes 10/10;
- host B remains 2/10.

### 12.5 Trial path
- personal user has no paid subscription;
- trial remaining 2;
- session start consumes 1 trial;
- after reaching 0, next session requires subscription or wallet/blocked path according to settings.

### 12.6 Idempotency
- same session start consume RPC called twice;
- only one ledger row created;
- session points to single ledger record;
- no double charge.

---

## 13. Payment / Ops Checklist Before Production
To implement auto-renew in production, owner must prepare:
1. legal entity / payee information;
2. bank settlement account;
3. payment provider account;
4. terms of service;
5. privacy policy;
6. refund policy;
7. support contact info;
8. invoice/receipt handling strategy;
9. webhook endpoint handling in server layer.

---

## 14. Recommended Frontend Data Contracts

### 14.1 Quota dashboard payload example
```json
{
  "billing_account_type": "organization",
  "plan_code": "org_5_hosts_1500",
  "subscription_status": "active",
  "period_start": "2026-04-05T00:00:00+08:00",
  "period_end": "2026-05-04T23:59:59+08:00",
  "wallet_balance": 1200,
  "organization": {
    "id": "uuid",
    "name": "Taipei Friday Group"
  },
  "hosts": [
    {
      "user_id": "uuid-host-a",
      "display_name": "Host A",
      "quota_limit": 10,
      "quota_used": 9,
      "quota_remaining": 1,
      "overage_count": 0
    },
    {
      "user_id": "uuid-host-b",
      "display_name": "Host B",
      "quota_limit": 10,
      "quota_used": 2,
      "quota_remaining": 8,
      "overage_count": 0
    }
  ]
}
```

### 14.2 Session start preflight payload example
```json
{
  "session_id": "uuid",
  "can_start": true,
  "consume_mode": "monthly_quota",
  "billing_account_id": "uuid",
  "host_user_id": "uuid",
  "plan_code": "personal_monthly_350",
  "quota_limit": 8,
  "quota_used": 4,
  "quota_remaining": 4,
  "trial_remaining": 0,
  "overage_price": 50,
  "wallet_balance": 120,
  "will_block": false,
  "message": "This session start will consume 1 monthly session quota."
}
```

---

## 15. Implementation Notes for Next.js
- Use server actions or route handlers for upgrade activation and payment confirmation.
- Use Supabase RPC for billing preflight and consumption.
- Do not let client-side state decide billable outcome.
- All billable decisions must happen in database transaction or server function.
- For UI, optimistic updates are allowed only after successful RPC response.

---

## 16. Final Build Guidance for AI Agent
1. Read SQL schema first.
2. Apply migrations in order.
3. Seed plans.
4. Create sample personal and organization subscriptions.
5. Verify quota dashboard view output.
6. Build `/billing` page using the dashboard payload.
7. Build `/billing/upgrade` page.
8. Integrate preflight on the live session page.
9. Prevent first-round lock if preflight blocks.
10. Add tests for idempotent session starts.

