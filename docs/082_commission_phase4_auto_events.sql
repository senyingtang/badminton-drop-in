-- 082_commission_phase4_auto_events.sql
-- Phase 4: payment success -> commission_events (earned). Run after 076.
-- Idempotent where possible. No payout / no reversal automation in this file.
--
-- REFUND / REVERSAL (future Phase 4.1 or Phase 5):
--   Do NOT delete earned rows. Add reversal event_type or void status with audit trail.
--
-- DELETED REFERRER (app policy, implemented in web helper):
--   If referrer app_user_profiles.is_deleted = true, skip auto commission (kb_admin_audit_logs).

begin;

-- ---------------------------------------------------------------------------
-- 1) Phase 3 partial unique (earned + source_id) is required for idempotency:
--    ux_commission_events_source_dedupe on (source_type, source_id, referrer_user_id, commission_item_key)
--    Apply docs/076_commission_phase3_events_ledger.sql before this file if missing.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 2) Helpful indexes for Phase 4 ops / diagnostics (non-breaking)
-- ---------------------------------------------------------------------------
create index if not exists idx_commission_events_source_type_created
  on public.commission_events (source_type, created_at desc);

create index if not exists idx_kb_admin_audit_logs_commission_auto
  on public.kb_admin_audit_logs (action, created_at desc)
  where action in (
    'commission_event_auto_create',
    'commission_event_auto_skip',
    'commission_event_auto_duplicate',
    'commission_event_auto_error'
  );

comment on index public.idx_commission_events_source_type_created is
  'Phase 4: filter auto events by source_type for support / diagnostics.';

commit;
