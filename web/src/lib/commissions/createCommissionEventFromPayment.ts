import type { SupabaseClient } from '@supabase/supabase-js'

export type RpcRateRow = {
  commission_item_id: string | null
  commission_item_key: string | null
  display_name: string | null
  default_rate: number | null
  personal_rate: number | null
  applied_rate: number | null
  personal_rate_active: boolean | null
}

export type CreateCommissionEventForPaymentInput = {
  referredUserId: string
  commissionItemKey: string
  sourceType: string
  sourceId: string | null
  sourceExternalId: string | null
  sourceOccurredAt: string
  sourceAmountCents: number
  metadata?: Record<string, unknown>
}

export type CreateCommissionEventForPaymentResult =
  | { ok: true; status: 'created'; eventId: string }
  | { ok: true; status: 'duplicate' }
  | { ok: true; status: 'skipped'; reason: string }
  | { ok: false; status: 'error'; message: string }

function commissionMonthFromIso(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

async function auditCommissionAuto(
  admin: SupabaseClient,
  action: 'commission_event_auto_create' | 'commission_event_auto_skip' | 'commission_event_auto_duplicate' | 'commission_event_auto_error',
  payload: {
    target_user_id?: string | null
    entity_id?: string | null
    before_data?: unknown
    after_data?: unknown
    note?: string | null
  },
) {
  const { error } = await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: null,
    target_user_id: payload.target_user_id ?? null,
    action,
    entity_type: 'commission_events',
    entity_id: payload.entity_id ?? null,
    before_data: payload.before_data ?? null,
    after_data: payload.after_data ?? null,
    note: payload.note ?? null,
  })
  if (error) {
    // best-effort audit; do not throw (webhook must still return 1|OK)
  }
}

async function emailSnapshot(admin: SupabaseClient, uid: string | null): Promise<string | null> {
  if (!uid) return null
  const { data: u } = await admin.auth.admin.getUserById(uid)
  return u.user?.email ?? null
}

/**
 * Phase 4: idempotent earned commission from a successful payment (wallet_topup / subscription).
 * Service-role only. Skips without error when no referral, inactive item, deleted referrer, etc.
 */
export async function createCommissionEventForPayment(
  admin: SupabaseClient,
  input: CreateCommissionEventForPaymentInput,
): Promise<CreateCommissionEventForPaymentResult> {
  const {
    referredUserId,
    commissionItemKey,
    sourceType,
    sourceId,
    sourceExternalId,
    sourceOccurredAt,
    sourceAmountCents,
    metadata = {},
  } = input

  const baseAudit = {
    referred_user_id: referredUserId,
    commission_item_key: commissionItemKey,
    source_type: sourceType,
    source_id: sourceId,
    source_external_id: sourceExternalId,
    source_amount_cents: sourceAmountCents,
  }

  if (!sourceId) {
    await auditCommissionAuto(admin, 'commission_event_auto_skip', {
      target_user_id: referredUserId,
      after_data: { ...baseAudit, reason: 'missing_source_id' },
      note: 'missing_source_id',
    })
    return { ok: true, status: 'skipped', reason: 'missing_source_id' }
  }

  if (!Number.isFinite(sourceAmountCents) || sourceAmountCents <= 0) {
    await auditCommissionAuto(admin, 'commission_event_auto_skip', {
      target_user_id: referredUserId,
      after_data: { ...baseAudit, reason: 'zero_amount' },
      note: 'zero_amount',
    })
    return { ok: true, status: 'skipped', reason: 'zero_amount' }
  }

  const { data: link, error: linkErr } = await admin
    .from('member_referral_links')
    .select('id, referrer_user_id')
    .eq('referred_user_id', referredUserId)
    .eq('status', 'active')
    .maybeSingle()

  if (linkErr) {
    await auditCommissionAuto(admin, 'commission_event_auto_error', {
      target_user_id: referredUserId,
      after_data: { ...baseAudit, error: linkErr.message },
      note: linkErr.message,
    })
    return { ok: false, status: 'error', message: linkErr.message }
  }

  if (!link?.referrer_user_id) {
    await auditCommissionAuto(admin, 'commission_event_auto_skip', {
      target_user_id: referredUserId,
      after_data: { ...baseAudit, reason: 'no_active_referral_link' },
      note: 'no_active_referral_link',
    })
    return { ok: true, status: 'skipped', reason: 'no_active_referral_link' }
  }

  const referrerUserId = link.referrer_user_id as string

  const { data: refProf, error: refProfErr } = await admin
    .from('member_referral_profiles')
    .select('referral_code')
    .eq('user_id', referrerUserId)
    .maybeSingle()

  if (refProfErr || !refProf?.referral_code) {
    await auditCommissionAuto(admin, 'commission_event_auto_skip', {
      target_user_id: referredUserId,
      after_data: { ...baseAudit, referrer_user_id: referrerUserId, reason: 'referrer_no_referral_profile' },
      note: 'referrer_no_referral_profile',
    })
    return { ok: true, status: 'skipped', reason: 'referrer_no_referral_profile' }
  }

  const { data: refUser, error: refUserErr } = await admin
    .from('app_user_profiles')
    .select('is_deleted')
    .eq('id', referrerUserId)
    .maybeSingle()

  if (refUserErr) {
    await auditCommissionAuto(admin, 'commission_event_auto_error', {
      target_user_id: referredUserId,
      after_data: { ...baseAudit, error: refUserErr.message },
      note: refUserErr.message,
    })
    return { ok: false, status: 'error', message: refUserErr.message }
  }

  if (refUser?.is_deleted === true) {
    await auditCommissionAuto(admin, 'commission_event_auto_skip', {
      target_user_id: referredUserId,
      after_data: { ...baseAudit, referrer_user_id: referrerUserId, reason: 'referrer_deleted' },
      note: 'referrer_deleted',
    })
    return { ok: true, status: 'skipped', reason: 'referrer_deleted' }
  }

  const { data: rateData, error: rateErr } = await admin.rpc('resolve_commission_rate', {
    p_referrer_user_id: referrerUserId,
    p_commission_item_key: commissionItemKey,
  })
  if (rateErr) {
    await auditCommissionAuto(admin, 'commission_event_auto_error', {
      target_user_id: referredUserId,
      after_data: { ...baseAudit, error: rateErr.message },
      note: rateErr.message,
    })
    return { ok: false, status: 'error', message: rateErr.message }
  }

  const rateRow = (Array.isArray(rateData) ? rateData[0] : rateData) as RpcRateRow | undefined
  if (!rateRow?.commission_item_id || rateRow.applied_rate == null) {
    await auditCommissionAuto(admin, 'commission_event_auto_skip', {
      target_user_id: referredUserId,
      after_data: { ...baseAudit, referrer_user_id: referrerUserId, reason: 'item_inactive_or_unknown' },
      note: 'item_inactive_or_unknown',
    })
    return { ok: true, status: 'skipped', reason: 'item_inactive_or_unknown' }
  }

  const appliedRate = Number(rateRow.applied_rate)
  if (!Number.isFinite(appliedRate) || appliedRate <= 0) {
    await auditCommissionAuto(admin, 'commission_event_auto_skip', {
      target_user_id: referredUserId,
      after_data: { ...baseAudit, referrer_user_id: referrerUserId, reason: 'zero_or_invalid_rate' },
      note: 'zero_or_invalid_rate',
    })
    return { ok: true, status: 'skipped', reason: 'zero_or_invalid_rate' }
  }

  const commissionAmountCents = Math.round(sourceAmountCents * appliedRate)
  if (commissionAmountCents <= 0) {
    await auditCommissionAuto(admin, 'commission_event_auto_skip', {
      target_user_id: referredUserId,
      after_data: { ...baseAudit, referrer_user_id: referrerUserId, reason: 'commission_rounded_zero' },
      note: 'commission_rounded_zero',
    })
    return { ok: true, status: 'skipped', reason: 'commission_rounded_zero' }
  }

  const commissionMonth = commissionMonthFromIso(sourceOccurredAt)

  const [referrerEmail, referredEmail] = await Promise.all([
    emailSnapshot(admin, referrerUserId),
    emailSnapshot(admin, referredUserId),
  ])

  const rateSnapshot = {
    source: rateRow.personal_rate_active ? 'personal' : 'default',
    default_rate: rateRow.default_rate,
    personal_rate: rateRow.personal_rate,
    personal_rate_active: rateRow.personal_rate_active,
    applied_rate: appliedRate,
  }

  const sourceSnapshot = {
    auto: true,
    payment: {
      source_external_id: sourceExternalId,
      commission_item_key: commissionItemKey,
      ...((metadata?.payment as Record<string, unknown>) || {}),
    },
  }

  const insertRow = {
    referrer_user_id: referrerUserId,
    referred_user_id: referredUserId,
    referral_link_id: link.id as string,
    commission_item_id: rateRow.commission_item_id,
    commission_item_key: rateRow.commission_item_key,
    commission_item_display_name: rateRow.display_name || commissionItemKey,
    source_type: sourceType,
    source_id: sourceId,
    source_external_id: sourceExternalId,
    source_occurred_at: sourceOccurredAt,
    source_amount_cents: sourceAmountCents,
    currency: 'TWD',
    applied_rate: appliedRate,
    commission_amount_cents: commissionAmountCents,
    event_type: 'earned' as const,
    status: 'effective' as const,
    commission_month: commissionMonth,
    referrer_referral_code: refProf.referral_code as string,
    referrer_email_snapshot: referrerEmail,
    referred_email_snapshot: referredEmail,
    source_snapshot: sourceSnapshot,
    rate_snapshot: rateSnapshot,
    note: `自動：${sourceType}`,
    metadata: { auto: true, ...metadata },
    created_by_user_id: null as string | null,
    updated_by_user_id: null as string | null,
  }

  const { data: inserted, error: insErr } = await admin.from('commission_events').insert(insertRow).select('id').maybeSingle()

  if (insErr) {
    if (insErr.code === '23505') {
      await auditCommissionAuto(admin, 'commission_event_auto_duplicate', {
        target_user_id: referredUserId,
        after_data: { ...baseAudit, referrer_user_id: referrerUserId },
        note: 'duplicate_source_earned',
      })
      return { ok: true, status: 'duplicate' }
    }
    await auditCommissionAuto(admin, 'commission_event_auto_error', {
      target_user_id: referredUserId,
      after_data: { ...baseAudit, error: insErr.message },
      note: insErr.message,
    })
    return { ok: false, status: 'error', message: insErr.message }
  }

  await auditCommissionAuto(admin, 'commission_event_auto_create', {
    target_user_id: referredUserId,
    entity_id: (inserted?.id as string) || null,
    after_data: { event_id: inserted?.id, ...baseAudit, referrer_user_id: referrerUserId },
    note: null,
  })

  return { ok: true, status: 'created', eventId: inserted?.id as string }
}
