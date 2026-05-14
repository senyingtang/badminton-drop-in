'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { displayNameForUserProfile } from '@/lib/deletedMemberDisplay'
import {
  pickNotifyRecipientUserId,
  resolveLinePushUiFromParticipantRow,
  type ParticipantLineNotifyRow,
} from '@/lib/lineNotifyRecipient'
import Modal from '@/components/ui/Modal'
import styles from './ParticipantList.module.css'

const statusLabels: Record<string, { label: string; color: string }> = {
  pending:                 { label: '待確認', color: 'blue' },
  confirmed_main:          { label: '正選',   color: 'green' },
  waitlist:                { label: '候補',   color: 'orange' },
  promoted_from_waitlist:  { label: '遞補',   color: 'purple' },
  cancelled:               { label: '已取消', color: 'red' },
  no_show:                 { label: '未到',   color: 'red' },
  unavailable:             { label: '無法出席', color: 'gray' },
  completed:               { label: '完成',   color: 'purple' },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ParticipantRow = any

function participantToNotifyPayload(p: ParticipantRow): ParticipantLineNotifyRow {
  return {
    notification_user_id: p.notification_user_id,
    registered_by_user_id: p.registered_by_user_id,
    is_guest_registration: p.is_guest_registration,
    guest_display_name: p.guest_display_name,
    session_display_name: p.session_display_name,
    players: p.players,
  }
}

function countLinePushStats(list: ParticipantRow[]) {
  let pushable = 0
  let not_bound = 0
  let unknown = 0
  for (const p of list) {
    const s = p.linePushStatus as string | undefined
    if (s === 'pushable') pushable++
    else if (s === 'not_bound') not_bound++
    else unknown++
  }
  return { pushable, not_bound, unknown, total: list.length }
}

/** RPC `list_session_participants_for_host` 一列（host_confirmed_level 需 DB 套用 023 後才有） */
interface ListHostParticipantRpcRow {
  session_participant_id: string
  session_id: string
  player_id: string
  source_type: string
  status: string
  priority_order: number | null
  waitlist_order: number | null
  self_level: number | null
  host_confirmed_level?: number | null
  session_effective_level: number | null
  signup_note: string | null
  is_removed: boolean
  created_at: string
  player_code: string | null
  display_name: string | null
  total_matches_played?: number
  consecutive_rounds_played?: number
  is_locked_for_current_round?: boolean
  role_in_session?: string | null
  leave_after_current_round?: boolean
}

const LEVEL_OPTIONS = Array.from({ length: 18 }, (_, i) => i + 1)

interface ParticipantListProps {
  sessionId: string
  sessionStatus: string
  sessionTitle: string
  /** 若提供，將「全選正選／廣播訊息」工具列傳送到此 DOM 節點（例如場次頁「球員名單」標題下方） */
  rosterToolbarAnchorEl?: HTMLElement | null
}

export default function ParticipantList({
  sessionId,
  sessionStatus,
  sessionTitle,
  rosterToolbarAnchorEl = null,
}: ParticipantListProps) {
  const supabase = createClient()
  const [participants, setParticipants] = useState<ParticipantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [paidLoading, setPaidLoading] = useState<string | null>(null)
  const [undo, setUndo] = useState<{
    participantId: string
    prevStatus: string
    prevWaitlistOrder: number | null
    expiresAt: number
  } | null>(null)

  const fetchParticipants = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await supabase.rpc('list_session_participants_for_host', {
      input_session_id: sessionId,
    })

    if (error) {
      console.error('fetchParticipants failed:', error)
      setLoadError(error.message)
      setParticipants([])
      setLoading(false)
      return
    }

    // 補抓 session_participants 額外欄位（一次性暱稱、繳費、代報名）
    const otMap = new Map<string, string>()
    const paidAtMap = new Map<string, string | null>()
    const extraMap = new Map<
      string,
      {
        is_guest_registration: boolean
        guest_display_name: string | null
        guest_level: number | null
        guest_player_code: string | null
        registered_by_user_id: string | null
        notification_user_id: string | null
      }
    >()

    const ensureExtra = (spId: string) => {
      let ex = extraMap.get(spId)
      if (!ex) {
        ex = {
          is_guest_registration: false,
          guest_display_name: null,
          guest_level: null,
          guest_player_code: null,
          registered_by_user_id: null,
          notification_user_id: null,
        }
        extraMap.set(spId, ex)
      }
      return ex
    }

    const ingestSpRow = (obj: Record<string, unknown>) => {
      const rawId = obj.id
      if (!rawId) return
      const id = String(rawId)
      const ex = ensureExtra(id)
      const sdn = obj.session_display_name
      if (typeof sdn === 'string') {
        const v = sdn.trim()
        if (v) otMap.set(id, v)
      }
      const paidAt = obj.paid_at
      if (Object.prototype.hasOwnProperty.call(obj, 'paid_at')) {
        paidAtMap.set(id, typeof paidAt === 'string' ? paidAt : paidAt == null ? null : String(paidAt))
      }
      if ('is_guest_registration' in obj) {
        ex.is_guest_registration = Boolean(obj.is_guest_registration)
      }
      if ('guest_display_name' in obj && typeof obj.guest_display_name === 'string') {
        ex.guest_display_name = obj.guest_display_name
      }
      if ('guest_level' in obj) {
        ex.guest_level =
          obj.guest_level == null || obj.guest_level === '' ? null : Number(obj.guest_level)
      }
      if ('guest_player_code' in obj && typeof obj.guest_player_code === 'string') {
        ex.guest_player_code = obj.guest_player_code
      }
      if ('registered_by_user_id' in obj) {
        ex.registered_by_user_id =
          typeof obj.registered_by_user_id === 'string' ? obj.registered_by_user_id : null
      }
      if ('notification_user_id' in obj) {
        ex.notification_user_id =
          typeof obj.notification_user_id === 'string' ? obj.notification_user_id : null
      }
    }

    const full = await supabase
      .from('session_participants')
      .select(
        'id, session_display_name, paid_at, is_guest_registration, guest_display_name, guest_level, guest_player_code, registered_by_user_id, notification_user_id, players(auth_user_id, line_oa_user_id, line_user_id)',
      )
      .eq('session_id', sessionId)

    if (full.error) {
      console.warn('session_participants extended select failed, falling back:', full.error.message)
      const fb = await supabase
        .from('session_participants')
        .select('id, session_display_name, paid_at')
        .eq('session_id', sessionId)
      if (!fb.error) {
        ;(fb.data || []).forEach((r: unknown) => {
          if (!r || typeof r !== 'object') return
          ingestSpRow(r as Record<string, unknown>)
        })
      } else {
        const msg = String(fb.error.message || '')
        if (msg.includes('paid_at') || msg.toLowerCase().includes('does not exist')) {
          const { data: onlyNames, error: otErr } = await supabase
            .from('session_participants')
            .select('id, session_display_name')
            .eq('session_id', sessionId)
          if (otErr) {
            console.warn('load session_display_name failed:', otErr.message)
          } else {
            ;(onlyNames || []).forEach((r: unknown) => {
              if (!r || typeof r !== 'object') return
              ingestSpRow(r as Record<string, unknown>)
            })
          }
        } else {
          console.warn('load session participant extra fields failed:', fb.error.message)
        }
      }
    } else {
      ;(full.data || []).forEach((r: unknown) => {
        if (!r || typeof r !== 'object') return
        ingestSpRow(r as Record<string, unknown>)
      })
    }

    const lineBySpId = new Map<
      string,
      { auth_user_id: string | null; line_oa_user_id: string | null; line_user_id: string | null }
    >()
    if (!full.error && full.data) {
      for (const raw of full.data) {
        if (!raw || typeof raw !== 'object') continue
        const o = raw as {
          id?: string
          players?: {
            auth_user_id?: string | null
            line_oa_user_id?: string | null
            line_user_id?: string | null
          } | null
        }
        if (!o.id) continue
        const pl = o.players
        if (pl && typeof pl === 'object') {
          lineBySpId.set(o.id, {
            auth_user_id: typeof pl.auth_user_id === 'string' ? pl.auth_user_id : null,
            line_oa_user_id: typeof pl.line_oa_user_id === 'string' ? pl.line_oa_user_id : null,
            line_user_id: typeof pl.line_user_id === 'string' ? pl.line_user_id : null,
          })
        }
      }
    }

    const regIds = Array.from(
      new Set(
        [...extraMap.values()]
          .map((e) => e.registered_by_user_id)
          .filter((x): x is string => typeof x === 'string' && x.length > 0)
      )
    )
    const profById = new Map<string, { display_name: string | null; is_deleted?: boolean | null }>()
    if (regIds.length > 0) {
      const { data: profs, error: pErr } = await supabase
        .from('app_user_profiles')
        .select('id, display_name, is_deleted')
        .in('id', regIds)
      if (pErr) {
        console.warn('load registrar profiles failed:', pErr.message)
      } else {
        ;(profs || []).forEach((p: unknown) => {
          if (!p || typeof p !== 'object') return
          const o = p as Record<string, unknown>
          if (typeof o.id === 'string') {
            profById.set(o.id, {
              display_name: typeof o.display_name === 'string' ? o.display_name : null,
              is_deleted: Boolean(o.is_deleted),
            })
          }
        })
      }
    }

    // Map RPC result shape back to existing UI shape
    const rows: ParticipantRow[] = (data || []).map((r: ListHostParticipantRpcRow) => {
      const ex = extraMap.get(r.session_participant_id)
      const regId = ex?.registered_by_user_id ?? null
      const regProf = regId ? profById.get(regId) : undefined
      const registrarLabel = regProf ? displayNameForUserProfile(regProf) : null
      const lx = lineBySpId.get(r.session_participant_id) || {
        auth_user_id: null as string | null,
        line_oa_user_id: null as string | null,
        line_user_id: null as string | null,
      }
      return {
        id: r.session_participant_id,
        session_id: r.session_id,
        player_id: r.player_id,
        source_type: r.source_type,
        status: r.status,
        priority_order: r.priority_order,
        waitlist_order: r.waitlist_order,
        self_level: r.self_level,
        host_confirmed_level: r.host_confirmed_level ?? null,
        session_effective_level: r.session_effective_level,
        total_matches_played: r.total_matches_played ?? 0,
        consecutive_rounds_played: r.consecutive_rounds_played ?? 0,
        is_locked_for_current_round: r.is_locked_for_current_round ?? false,
        role_in_session: r.role_in_session ?? null,
        leave_after_current_round: r.leave_after_current_round ?? false,
        signup_note: r.signup_note,
        is_removed: r.is_removed,
        created_at: r.created_at,
        session_display_name: otMap.get(r.session_participant_id) || null,
        paid_at: paidAtMap.get(r.session_participant_id) ?? null,
        is_guest_registration: ex?.is_guest_registration ?? false,
        guest_display_name: ex?.guest_display_name ?? null,
        guest_level: ex?.guest_level ?? null,
        guest_player_code: ex?.guest_player_code ?? null,
        registered_by_user_id: regId,
        notification_user_id: ex?.notification_user_id ?? null,
        registrar_display_label: registrarLabel,
        players: {
          id: r.player_id,
          player_code: r.player_code,
          display_name: r.display_name,
          auth_user_id: lx.auth_user_id,
          line_oa_user_id: lx.line_oa_user_id,
          line_user_id: lx.line_user_id,
        },
      }
    })

    const uidSet = new Set<string>()
    for (const row of rows) {
      const uid = pickNotifyRecipientUserId(participantToNotifyPayload(row))
      if (uid) uidSet.add(uid)
    }

    const lineByAuthUserId = new Map<string, { line_oa_user_id: string | null; line_user_id: string | null }>()
    if (uidSet.size > 0) {
      const { data: plRows, error: plErr } = await supabase
        .from('players')
        .select('auth_user_id, line_oa_user_id, line_user_id')
        .in('auth_user_id', Array.from(uidSet))
      if (plErr) {
        console.warn('LINE push prefetch (players by auth_user_id) failed:', plErr.message)
      } else {
        for (const raw of plRows || []) {
          if (!raw || typeof raw !== 'object') continue
          const o = raw as {
            auth_user_id?: string | null
            line_oa_user_id?: string | null
            line_user_id?: string | null
          }
          const aid = typeof o.auth_user_id === 'string' ? o.auth_user_id : ''
          if (!aid) continue
          lineByAuthUserId.set(aid, {
            line_oa_user_id: typeof o.line_oa_user_id === 'string' ? o.line_oa_user_id : null,
            line_user_id: typeof o.line_user_id === 'string' ? o.line_user_id : null,
          })
        }
        for (const uid of uidSet) {
          if (!lineByAuthUserId.has(uid)) {
            lineByAuthUserId.set(uid, { line_oa_user_id: null, line_user_id: null })
          }
        }
      }
    }

    const rowsWithLineUi = rows.map((row) => {
      const ui = resolveLinePushUiFromParticipantRow(participantToNotifyPayload(row), lineByAuthUserId)
      return {
        ...row,
        linePushStatus: ui.status,
        linePushPushesToDelegate: ui.pushesToDelegate,
      }
    })

    setParticipants(rowsWithLineUi)
    setLoading(false)
  }, [sessionId, supabase])

  // Initial fetch
  useEffect(() => {
    fetchParticipants()
  }, [fetchParticipants])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`session-participants-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_participants',
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          fetchParticipants()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId, supabase, fetchParticipants])

  const mainList = participants.filter(
    (p) => ['confirmed_main', 'promoted_from_waitlist', 'completed'].includes(p.status)
  )
  const waitlist = participants.filter((p) => p.status === 'waitlist')
  const pendingList = participants.filter((p) => p.status === 'pending')
  const otherList = participants.filter(
    (p) => ['cancelled', 'no_show', 'unavailable'].includes(p.status)
  )

  const sortByCreatedAtAsc = (a: ParticipantRow, b: ParticipantRow) =>
    String(a.created_at).localeCompare(String(b.created_at))

  const sortedMain = [...mainList].sort(sortByCreatedAtAsc)
  const sortedWaitlist = [...waitlist].sort((a, b) => {
    const ao = a.waitlist_order == null ? null : Number(a.waitlist_order)
    const bo = b.waitlist_order == null ? null : Number(b.waitlist_order)
    if (ao != null && bo != null && ao !== bo) return ao - bo
    if (ao == null && bo != null) return 1
    if (ao != null && bo == null) return -1
    return sortByCreatedAtAsc(a, b)
  })

  const [selectedMainIds, setSelectedMainIds] = useState<Set<string>>(new Set())
  const [contactModalParticipant, setContactModalParticipant] = useState<ParticipantRow | null>(null)
  const [contactMessageDraft, setContactMessageDraft] = useState('')
  const [contactSending, setContactSending] = useState(false)
  const [broadcastModalOpen, setBroadcastModalOpen] = useState(false)
  const [broadcastMessageDraft, setBroadcastMessageDraft] = useState('')
  const [broadcastSending, setBroadcastSending] = useState(false)

  const mainLineStats = useMemo(() => countLinePushStats(sortedMain), [sortedMain])
  const selectedLineStats = useMemo(() => {
    const sel = sortedMain.filter((p) => selectedMainIds.has(String(p.id)))
    return countLinePushStats(sel)
  }, [sortedMain, selectedMainIds])

  useEffect(() => {
    const allow = new Set(
      participants
        .filter((p) => ['confirmed_main', 'promoted_from_waitlist', 'completed'].includes(p.status))
        .map((p) => String(p.id)),
    )
    setSelectedMainIds((prev) => {
      const next = new Set<string>()
      prev.forEach((id) => {
        if (allow.has(id)) next.add(id)
      })
      if (next.size !== prev.size) return next
      for (const id of next) {
        if (!prev.has(id)) return next
      }
      return prev
    })
  }, [participants])

  const allMainSelected = sortedMain.length > 0 && sortedMain.every((p) => selectedMainIds.has(String(p.id)))

  const submitBroadcastLine = useCallback(async () => {
    const ids = sortedMain.filter((p) => selectedMainIds.has(String(p.id))).map((p) => String(p.id))
    if (ids.length === 0) return
    const msg = broadcastMessageDraft.trim()
    if (!msg) {
      alert('請輸入要廣播的訊息')
      return
    }
    setBroadcastSending(true)
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/participants/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: ids, message: msg }),
      })
      const j = (await res.json().catch(() => null)) as
        | { sent?: number; failed?: number; results?: { participantId: string; ok: boolean; errorCode?: string }[] }
        | { error?: string }
        | null
      if (!res.ok) {
        alert(`廣播失敗：${(j as { error?: string })?.error || res.status}`)
        return
      }
      const sent = Number((j as { sent?: number }).sent ?? 0)
      const failed = Number((j as { failed?: number }).failed ?? 0)
      const results = (j as { results?: { participantId: string; ok: boolean; errorCode?: string }[] }).results || []
      const failLines = results
        .filter((r) => !r.ok)
        .map((r) => {
          const p = sortedMain.find((x) => String(x.id) === r.participantId)
          const label = p ? String((p as ParticipantRow).guest_display_name || (p as ParticipantRow).players?.display_name || r.participantId) : r.participantId
          return `${label}：${r.errorCode || 'FAILED'}`
        })
      alert(
        `已送出廣播：成功 ${sent} 位，失敗 ${failed} 位。` +
          (failLines.length ? `\n\n失敗明細：\n${failLines.join('\n')}` : ''),
      )
      setBroadcastModalOpen(false)
      setBroadcastMessageDraft('')
    } catch (e) {
      console.error(e)
      alert('廣播請求失敗，請稍後再試')
    } finally {
      setBroadcastSending(false)
    }
  }, [broadcastMessageDraft, selectedMainIds, sessionId, sortedMain])

  const submitContactLine = useCallback(async () => {
    if (!contactModalParticipant) return
    if (contactModalParticipant.linePushStatus === 'not_bound') return
    const msg = contactMessageDraft.trim()
    if (!msg) {
      alert('請輸入訊息')
      return
    }
    setContactSending(true)
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(String(contactModalParticipant.id))}/contact`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg }),
        },
      )
      const j = (await res.json().catch(() => null)) as { ok?: boolean; errorCode?: string; detail?: string } | null
      if (!res.ok) {
        const code = j?.errorCode || `HTTP_${res.status}`
        alert(`發送失敗（${code}）${j?.detail ? `：${j.detail}` : ''}`)
        return
      }
      alert('已成功透過 LINE 發送訊息')
      setContactModalParticipant(null)
      setContactMessageDraft('')
    } catch (e) {
      console.error(e)
      alert('發送失敗，請稍後再試')
    } finally {
      setContactSending(false)
    }
  }, [contactMessageDraft, contactModalParticipant, sessionId])

  const handleStatusChange = async (participantId: string, newStatus: string, previousStatus?: string) => {
    setActionLoading(participantId)
    try {
      await supabase.rpc('confirm_participant_status', {
        input_session_participant_id: participantId,
        input_new_status: newStatus,
      })
      await fetchParticipants()
      if (
        previousStatus === 'waitlist' &&
        (newStatus === 'confirmed_main' || newStatus === 'promoted_from_waitlist')
      ) {
        void fetch('/api/line/notify-waitlist-promotion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionParticipantId: participantId }),
        }).catch(() => {})
      }
    } catch (err) {
      console.error('Status change failed:', err)
      alert('操作失敗，請稍後再試')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCancelWithUndo = async (p: ParticipantRow) => {
    const prevStatus = String(p.status)
    const prevWaitlistOrder = p.waitlist_order != null ? Number(p.waitlist_order) : null
    await handleStatusChange(p.id, 'cancelled')
    const expiresAt = Date.now() + 10_000
    setUndo({ participantId: p.id, prevStatus, prevWaitlistOrder, expiresAt })
    setTimeout(() => {
      setUndo((cur) =>
        cur && cur.participantId === p.id && cur.expiresAt === expiresAt ? null : cur
      )
    }, 10_000)
  }

  const handleUndo = async () => {
    if (!undo) return
    if (Date.now() > undo.expiresAt) {
      setUndo(null)
      return
    }
    setActionLoading(undo.participantId)
    try {
      await supabase.rpc('confirm_participant_status', {
        input_session_participant_id: undo.participantId,
        input_new_status: undo.prevStatus,
      })
      if (undo.prevStatus === 'waitlist' && undo.prevWaitlistOrder) {
        await supabase.rpc('host_set_waitlist_order', {
          input_session_participant_id: undo.participantId,
          input_new_order: undo.prevWaitlistOrder,
        })
      }
      await fetchParticipants()
      setUndo(null)
    } catch (err) {
      console.error('復原失敗:', err)
      alert('復原失敗，請稍後再試')
    } finally {
      setActionLoading(null)
    }
  }

  const handlePromote = async () => {
    setActionLoading('promote')
    try {
      await supabase.rpc('promote_next_waitlist_participant_simple', {
        input_session_id: sessionId,
      })
      await fetchParticipants()
    } catch (err) {
      console.error('Promotion failed:', err)
      alert('遞補失敗，請稍後再試（可能沒有候補球員）')
    } finally {
      setActionLoading(null)
    }
  }

  const rosterOpenStatuses = [
    'draft',
    'pending_confirmation',
    'registration_open',
    'ready_for_assignment',
    'assigned',
    'in_progress',
    'round_finished',
  ]
  const canManage = rosterOpenStatuses.includes(sessionStatus)
  const canEditLevels = [
    'draft',
    'pending_confirmation',
    'registration_open',
    'ready_for_assignment',
    'assigned',
    'in_progress',
    'round_finished',
  ].includes(sessionStatus)

  const canTogglePaid = true

  const handleTogglePaid = async (p: ParticipantRow, nextChecked: boolean) => {
    setPaidLoading(p.id)
    try {
      const { error } = await supabase.rpc('host_set_participant_paid_status', {
        input_session_participant_id: p.id,
        input_is_paid: nextChecked,
      })
      if (error) throw error
      await fetchParticipants()
    } catch (err) {
      console.error('Paid status update failed:', err)
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : ''
      if (msg.includes('Could not find the function') || msg.includes('does not exist')) {
        alert(
          '更新繳費狀態需要資料庫函式 host_set_participant_paid_status。請在 Supabase SQL Editor 執行 docs/045_session_participant_paid_status.sql 後再試。'
        )
      } else if (msg.includes('forbidden') || msg.includes('unauthorized')) {
        alert('沒有權限變更繳費狀態（僅主辦／場館管理者／平台管理員）。')
      } else {
        alert('更新繳費狀態失敗，請稍後再試。')
      }
    } finally {
      setPaidLoading(null)
    }
  }

  const handleHostLevelChange = async (participantId: string, newLevel: number) => {
    setActionLoading(participantId)
    try {
      const { error } = await supabase.rpc('host_set_participant_session_level', {
        input_session_participant_id: participantId,
        input_level: newLevel,
      })
      if (error) throw error
      await fetchParticipants()
    } catch (err) {
      console.error('Host level update failed:', err)
      const code =
        err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : ''
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : ''
      if (msg.includes('Could not find the function') || msg.includes('does not exist')) {
        alert(
          '更新級數需要資料庫函式 host_set_participant_session_level。請在 Supabase SQL Editor 執行 docs/024_host_set_participant_session_level_rpc.sql 後再試。'
        )
      } else if (code === 'P0001' || msg.includes('forbidden')) {
        alert('沒有權限變更此球員級數（僅主辦／場館管理者／平台管理員）。')
      } else {
        alert('更新級數失敗。若你確定是主辦，請確認已在 Supabase 套用 024 migration，或稍後再試。')
      }
    } finally {
      setActionLoading(null)
    }
  }

  const toggleLeaveAfterRound = async (p: ParticipantRow, next: boolean) => {
    setActionLoading(p.id)
    try {
      const { error } = await supabase.rpc('host_set_participant_leave_after_round', {
        p_session_participant_id: p.id,
        p_leave: next,
      })
      if (error) throw error
      await fetchParticipants()
    } catch (err) {
      console.error('leave_after_round failed:', err)
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : ''
      if (msg.includes('does not exist') || msg.includes('Could not find')) {
        alert('此功能需先在 Supabase 執行 docs/057_next_round_planning_and_flexible_session_roster.sql')
      } else {
        alert('更新失敗，請稍後再試')
      }
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    )
  }

  const mainRosterToolbarInner =
    canManage && sortedMain.length > 0 ? (
      <>
        <label className={styles.selectAllLabel}>
          <input
            type="checkbox"
            checked={allMainSelected}
            onChange={(e) => {
              if (e.target.checked) {
                setSelectedMainIds(new Set(sortedMain.map((p) => String(p.id))))
              } else {
                setSelectedMainIds(new Set())
              }
            }}
          />
          全選正選
        </label>
        <button
          type="button"
          className={`btn btn-ghost btn-sm ${styles.broadcastBtn}`}
          disabled={selectedMainIds.size === 0}
          onClick={() => {
            setBroadcastModalOpen(true)
            setBroadcastMessageDraft('')
          }}
        >
          廣播訊息
        </button>
        <div className={styles.toolbarLineStats} aria-live="polite">
          {selectedMainIds.size > 0 ? (
            <>
              已選 {selectedLineStats.total} 位，可推播 {selectedLineStats.pushable} 位，未綁定 {selectedLineStats.not_bound} 位
              {selectedLineStats.unknown > 0 ? `，狀態不明 ${selectedLineStats.unknown} 位` : ''}
            </>
          ) : (
            <>
              本場正選：可推播 {mainLineStats.pushable} 位，未綁定 {mainLineStats.not_bound} 位
              {mainLineStats.unknown > 0 ? `，狀態不明 ${mainLineStats.unknown} 位` : ''}
            </>
          )}
        </div>
      </>
    ) : null

  const renderParticipant = (p: ParticipantRow, displayIndex?: string) => {
    const st = statusLabels[p.status] || { label: p.status, color: 'gray' }
    const isHostAuto =
      p.source_type === 'host_auto' ||
      (typeof p.role_in_session === 'string' && p.role_in_session.toLowerCase().includes('host'))
    const canPickLevel =
      canEditLevels &&
      !['cancelled', 'no_show', 'unavailable', 'completed'].includes(p.status)
    const levelValue = Number(p.session_effective_level ?? p.self_level ?? 6)
    const showPlayedMeta = ['confirmed_main', 'promoted_from_waitlist', 'completed'].includes(p.status)
    const isMain = ['confirmed_main', 'promoted_from_waitlist', 'completed'].includes(p.status)
    const isPaid = Boolean(p.paid_at)
    const paidDisabled = paidLoading === p.id || actionLoading === p.id

    const guest = Boolean(p.is_guest_registration)
    const baseName = (p.players?.display_name || '未知') as string
    const guestName = (p.guest_display_name || '').trim()
    const shownName = guest ? (guestName || baseName) : baseName
    const nameSuffix =
      !guest && p.session_display_name ? ` - ${String(p.session_display_name)}` : ''
    const guestLevelSuffix =
      guest && p.guest_level != null && !Number.isNaN(Number(p.guest_level)) ? `（${p.guest_level} 級）` : ''

    const showContactBtn =
      canManage &&
      Boolean(p.players) &&
      !['cancelled', 'no_show', 'completed'].includes(p.status)

    const isMainRoster = ['confirmed_main', 'promoted_from_waitlist', 'completed'].includes(p.status)
    const showLinePushBadge = isMainRoster && canManage
    const contactLineBlocked = showContactBtn && p.linePushStatus === 'not_bound'
    const lineBadgeTitle =
      p.linePushStatus === 'pushable' && p.linePushPushesToDelegate
        ? '此球友由他人代報，訊息會推播給代報者／通知對象所綁定之 LINE。'
        : p.linePushStatus === 'pushable'
          ? '此球員可透過 LINE 接收通知'
          : p.linePushStatus === 'not_bound'
            ? '此球員尚未加入或綁定 LINE，無法推播'
            : '無法確認 LINE 綁定狀態；若送出失敗將顯示錯誤代碼'

    return (
      <div key={p.id} className={`${styles.row} ${canManage ? styles.rowHasToolbar : ''}`}>
        <div className={styles.playerInfo}>
          {canManage && isMain ? (
            <input
              type="checkbox"
              className={styles.rowSelectCb}
              checked={selectedMainIds.has(String(p.id))}
              onChange={(e) => {
                const on = e.target.checked
                setSelectedMainIds((prev) => {
                  const next = new Set(prev)
                  const id = String(p.id)
                  if (on) next.add(id)
                  else next.delete(id)
                  return next
                })
              }}
              aria-label={`選取正選 ${shownName}`}
            />
          ) : null}
          <div className={styles.playerIdentity}>
            <div className={styles.nameRow}>
              <span className={styles.playerName}>
                {displayIndex ? <span style={{ color: 'var(--text-tertiary)', marginRight: 6 }}>{displayIndex}</span> : null}
                {shownName}
                {guestLevelSuffix}
                {nameSuffix}
              </span>
              {p.players?.player_code ? (
                <span className={styles.playerCode}>{p.players.player_code}</span>
              ) : null}
              {guest && p.guest_player_code ? (
                <span className={styles.playerCode} title="代報名識別碼">
                  代報:{p.guest_player_code}
                </span>
              ) : null}
              {isHostAuto ? (
                <span className={styles.hostLevelTag} title="團主自動列入可排組名單">
                  團主
                </span>
              ) : null}
            </div>
            {guest && p.registrar_display_label ? (
              <div className={styles.subRow} style={{ color: 'var(--text-secondary)' }}>
                代報者：{p.registrar_display_label}
              </div>
            ) : null}
            {p.leave_after_current_round ? (
              <div className={styles.leaveStatusHint}>已標記下輪離場（打完本輪後離場）</div>
            ) : null}
            {(showPlayedMeta || p.signup_note) && (
              <div className={styles.detailRow}>
                {showPlayedMeta && (
                  <span className={styles.playedMeta}>上場 {Number(p.total_matches_played ?? 0)} 場</span>
                )}
                {p.signup_note ? (
                  <span className={styles.playerNote}>備註：{p.signup_note}</span>
                ) : null}
              </div>
            )}
            {p.status === 'waitlist' && (
              <div className={styles.subRow}>候補順序：{p.waitlist_order ?? '—'}</div>
            )}
          </div>
        </div>
        <div className={styles.rowToolbar}>
          <div className={styles.lineContactCluster}>
            {showLinePushBadge ? (
              <span
                className={`${styles.linePushBadge} ${
                  p.linePushStatus === 'pushable'
                    ? styles.linePushOk
                    : p.linePushStatus === 'not_bound'
                      ? styles.linePushNo
                      : styles.linePushUnknown
                }`}
                title={lineBadgeTitle}
              >
                {p.linePushStatus === 'pushable'
                  ? 'LINE 可聯絡'
                  : p.linePushStatus === 'not_bound'
                    ? '未綁定 LINE'
                    : 'LINE 狀態不明'}
              </span>
            ) : null}
            {showContactBtn ? (
              <button
                type="button"
                className={styles.contactBtn}
                title={
                  contactLineBlocked
                    ? '此球員尚未綁定 LINE，無法推播'
                    : '以 LINE 發送場次通知給此球員或代報者'
                }
                disabled={contactLineBlocked}
                onClick={() => {
                  if (contactLineBlocked) return
                  setContactModalParticipant(p)
                  setContactMessageDraft('')
                }}
              >
                聯絡
              </button>
            ) : null}
          </div>
          <div className={styles.levelCell}>
            {canPickLevel ? (
              <select
                className={styles.levelSelect}
                value={String(levelValue)}
                onChange={(e) => handleHostLevelChange(p.id, Number(e.target.value))}
                disabled={actionLoading === p.id}
                aria-label={`${shownName} 當場級數`}
              >
                {LEVEL_OPTIONS.map((n) => (
                  <option key={n} value={String(n)}>
                    Lv.{n}
                  </option>
                ))}
              </select>
            ) : (
              <div className={styles.level}>
                {p.session_effective_level
                  ? `Lv.${p.session_effective_level}`
                  : p.self_level
                    ? `自評 Lv.${p.self_level}`
                    : '—'}
              </div>
            )}
            {p.host_confirmed_level != null && (
              <span className={styles.hostLevelTag}>團主訂級</span>
            )}
          </div>
          <div className={styles.paidCell}>
            {isMain ? (
              <button
                type="button"
                className={styles.paidToggle}
                data-checked={isPaid ? 'true' : 'false'}
                onClick={() => {
                  if (!canTogglePaid) return
                  void handleTogglePaid(p, !isPaid)
                }}
                disabled={!canTogglePaid || paidDisabled}
                aria-disabled={!canTogglePaid || paidDisabled}
                title="切換繳費狀態"
              >
                <input
                  className={styles.paidCheckbox}
                  type="checkbox"
                  checked={isPaid}
                  onChange={(e) => {
                    if (!canTogglePaid) return
                    void handleTogglePaid(p, e.target.checked)
                  }}
                  disabled={!canTogglePaid || paidDisabled}
                  aria-label={`${shownName} 已繳費`}
                />
                已繳費
              </button>
            ) : (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>—</span>
            )}
          </div>
          <span className={`${styles.statusBadge} ${styles[st.color]}`}>{st.label}</span>
          {canManage && ['confirmed_main', 'promoted_from_waitlist'].includes(p.status) ? (
            <button
              type="button"
              className={`${styles.leavePill} ${p.leave_after_current_round ? styles.leavePillOn : ''}`}
              onClick={() => void toggleLeaveAfterRound(p, !Boolean(p.leave_after_current_round))}
              disabled={actionLoading === p.id}
              title="本輪結束後離場"
            >
              {p.leave_after_current_round ? '留場' : '下輪離場'}
            </button>
          ) : null}
          {canManage && (
            <div className={styles.actions}>
              {p.status === 'pending' && (
                <>
                  <button
                    className={styles.actionBtn}
                    onClick={() => handleStatusChange(p.id, 'confirmed_main', p.status)}
                    disabled={actionLoading === p.id}
                    title="確認正選"
                  >
                    ✓
                  </button>
                  <button
                    className={styles.actionBtn}
                    onClick={() => handleStatusChange(p.id, 'waitlist')}
                    disabled={actionLoading === p.id}
                    title="設為候補"
                  >
                    ⏳
                  </button>
                </>
              )}
              {['confirmed_main', 'promoted_from_waitlist'].includes(p.status) && (
                <>
                  <button
                    className={styles.actionBtn}
                    onClick={() => void handleStatusChange(p.id, 'unavailable')}
                    disabled={actionLoading === p.id || p.is_locked_for_current_round}
                    title={
                      p.is_locked_for_current_round
                        ? '本輪已鎖定出賽中，請打完本輪或使用「本輪後離場」'
                        : '暫停排組（無法出席）'
                    }
                  >
                    ⏸
                  </button>
                  <button
                    className={styles.actionBtn}
                    onClick={async () => {
                      setActionLoading(p.id)
                      try {
                        await supabase.rpc('host_move_participant_to_waitlist', {
                          input_session_participant_id: p.id,
                        })
                        await fetchParticipants()
                      } catch (err) {
                        console.error('Move to waitlist failed:', err)
                        alert('移到候補失敗，請稍後再試')
                      } finally {
                        setActionLoading(null)
                      }
                    }}
                    disabled={actionLoading === p.id}
                    title="移到候補"
                  >
                    ⏳
                  </button>
                  <button
                    className={`${styles.actionBtn} ${styles.dangerBtn}`}
                    onClick={() => handleCancelWithUndo(p)}
                    disabled={actionLoading === p.id}
                    title="取消"
                  >
                    ✕
                  </button>
                </>
              )}
              {p.status === 'unavailable' && (
                <>
                  <button
                    className={styles.actionBtn}
                    onClick={() => void handleStatusChange(p.id, 'confirmed_main')}
                    disabled={actionLoading === p.id}
                    title="恢復正選"
                  >
                    ▶ 恢復
                  </button>
                  <button
                    className={`${styles.actionBtn} ${styles.dangerBtn}`}
                    onClick={() => handleCancelWithUndo(p)}
                    disabled={actionLoading === p.id}
                    title="取消"
                  >
                    ✕
                  </button>
                </>
              )}
              {p.status === 'waitlist' && (
                <>
                  <button
                    className={styles.actionBtn}
                    onClick={() => handleStatusChange(p.id, 'confirmed_main', p.status)}
                    disabled={actionLoading === p.id}
                    title="轉正選"
                  >
                    ✓
                  </button>
                  <button
                    className={styles.actionBtn}
                    onClick={async () => {
                      const next = (p.waitlist_order || 1) - 1
                      if (next < 1) return
                      setActionLoading(p.id)
                      try {
                        await supabase.rpc('host_set_waitlist_order', {
                          input_session_participant_id: p.id,
                          input_new_order: next,
                        })
                        await fetchParticipants()
                      } finally {
                        setActionLoading(null)
                      }
                    }}
                    disabled={actionLoading === p.id || !p.waitlist_order || p.waitlist_order <= 1}
                    title="往前移"
                  >
                    ↑
                  </button>
                  <button
                    className={styles.actionBtn}
                    onClick={async () => {
                      const next = (p.waitlist_order || 0) + 1
                      setActionLoading(p.id)
                      try {
                        await supabase.rpc('host_set_waitlist_order', {
                          input_session_participant_id: p.id,
                          input_new_order: next,
                        })
                        await fetchParticipants()
                      } finally {
                        setActionLoading(null)
                      }
                    }}
                    disabled={actionLoading === p.id || !p.waitlist_order}
                    title="往後移"
                  >
                    ↓
                  </button>
                  <button
                    className={`${styles.actionBtn} ${styles.dangerBtn}`}
                    onClick={() => handleCancelWithUndo(p)}
                    disabled={actionLoading === p.id}
                    title="取消"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {mainRosterToolbarInner && rosterToolbarAnchorEl
        ? createPortal(
            <div className={`${styles.hostRosterToolbar} ${styles.hostRosterToolbarAnchored}`}>
              {mainRosterToolbarInner}
            </div>,
            rosterToolbarAnchorEl,
          )
        : null}
      {loadError && (
        <p className={styles.emptyHint} style={{ color: '#f87171' }}>
          讀取名單失敗：{loadError}
        </p>
      )}
      {undo && Date.now() < undo.expiresAt && (
        <div className={styles.undoBar}>
          <span>
            已取消報名，可於 {Math.ceil((undo.expiresAt - Date.now()) / 1000)} 秒內復原。
          </span>
          <button className={styles.undoBtn} onClick={handleUndo} type="button">
            復原
          </button>
        </div>
      )}
      {/* Pending */}
      {pendingList.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>
            待確認 <span className={styles.count}>{pendingList.length}</span>
          </h4>
          {pendingList.sort(sortByCreatedAtAsc).map((p, i) => renderParticipant(p, `${i + 1}.`))}
        </div>
      )}

      {/* Main List */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>
            正選名單 <span className={styles.count}>{sortedMain.length}</span>
            <span className={styles.count} style={{ marginLeft: 10 }}>
              候補 {sortedWaitlist.length} · 總計 {sortedMain.length + sortedWaitlist.length}
            </span>
          </h4>
          {mainRosterToolbarInner && !rosterToolbarAnchorEl ? (
            <div className={styles.hostRosterToolbar}>{mainRosterToolbarInner}</div>
          ) : null}
        </div>
        {sortedMain.length === 0 ? (
          <p className={styles.emptyHint}>尚無正選球員</p>
        ) : (
          sortedMain.map((p, i) => renderParticipant(p, `${i + 1}.`))
        )}
      </div>

      {/* Waitlist */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>
            候補名單 <span className={styles.count}>{sortedWaitlist.length}</span>
          </h4>
          {canManage && sortedWaitlist.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={handlePromote}
              disabled={actionLoading === 'promote'}
            >
              ⬆ 遞補下一位
            </button>
          )}
        </div>
        {sortedWaitlist.length === 0 ? (
          <p className={styles.emptyHint}>無候補球員</p>
        ) : (
          sortedWaitlist.map((p, i) => renderParticipant(p, `候補 ${i + 1}.`))
        )}
      </div>

      {/* Other (cancelled, no_show, etc.) */}
      {otherList.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>
            其他 <span className={styles.count}>{otherList.length}</span>
          </h4>
          {otherList.sort(sortByCreatedAtAsc).map((p, i) => renderParticipant(p, `${i + 1}.`))}
        </div>
      )}

      <Modal
        isOpen={contactModalParticipant != null}
        onClose={() => {
          if (!contactSending) setContactModalParticipant(null)
        }}
        title="聯絡球員（LINE）"
        size="sm"
      >
        {contactModalParticipant ? (
          <div className={styles.messageModal}>
            <p className={styles.modalHint}>場次：{sessionTitle.trim() || '（無標題）'}</p>
            <p className={styles.modalStrong}>
              {(() => {
                const p = contactModalParticipant
                const guest = Boolean(p.is_guest_registration)
                const baseName = (p.players?.display_name || '未知') as string
                const guestName = (p.guest_display_name || '').trim()
                return guest ? guestName || baseName : baseName
              })()}
            </p>
            {Boolean(contactModalParticipant.is_guest_registration) ? (
              <p className={styles.modalHint}>
                此為代報名：訊息將發送至代報者／通知對象（notification_user_id → registered_by_user_id）所綁定的 LINE；若對方未加 LINE 官方帳號或未綁定，將無法送達。
              </p>
            ) : (
              <p className={styles.modalHint}>訊息將發送至該球員已綁定之 LINE（Messaging API）。若未綁定則無法送達。</p>
            )}
            {contactModalParticipant.linePushPushesToDelegate ? (
              <p className={styles.modalHint} style={{ color: '#5eead4' }}>
                此筆將推播給代報者／通知對象所綁定之 LINE（與名單上顯示名稱可能不同）。
              </p>
            ) : null}
            <label className={styles.modalLabel} htmlFor="host-contact-msg">
              訊息內容
            </label>
            <textarea
              id="host-contact-msg"
              className={styles.modalTextarea}
              rows={5}
              value={contactMessageDraft}
              onChange={(e) => setContactMessageDraft(e.target.value)}
              placeholder="輸入要傳送給對方的文字…"
              disabled={contactSending}
            />
            <div className={styles.modalActions}>
              <button type="button" className="btn btn-ghost" disabled={contactSending} onClick={() => setContactModalParticipant(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  contactSending ||
                  (contactModalParticipant != null && contactModalParticipant.linePushStatus === 'not_bound')
                }
                onClick={() => void submitContactLine()}
              >
                {contactSending ? '送出中…' : '送出 LINE'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={broadcastModalOpen}
        onClose={() => {
          if (!broadcastSending) setBroadcastModalOpen(false)
        }}
        title="廣播訊息（LINE）"
        size="md"
      >
        <div className={styles.messageModal}>
          <p className={styles.modalHint}>
            已選取 {selectedMainIds.size} 位正選／遞補正選，將逐一發送相同訊息（最多 50 位）。
          </p>
          <div className={styles.broadcastEstimates}>
            <p className={styles.modalHint}>
              預估可推播：<strong>{selectedLineStats.pushable}</strong> 位
            </p>
            <p className={styles.modalHint}>
              未綁定 LINE：<strong>{selectedLineStats.not_bound}</strong> 位
            </p>
            {selectedLineStats.unknown > 0 ? (
              <p className={styles.modalHint}>
                狀態不明：<strong>{selectedLineStats.unknown}</strong> 位（送出時可能失敗）
              </p>
            ) : null}
          </div>
          {selectedLineStats.not_bound > 0 ? (
            <p className={styles.modalWarn}>
              其中 {selectedLineStats.not_bound} 位尚未綁定 LINE，送出時將略過或回報失敗（例如 LINE_NOT_BOUND）。
            </p>
          ) : null}
          <label className={styles.modalLabel} htmlFor="host-broadcast-msg">
            訊息內容
          </label>
          <textarea
            id="host-broadcast-msg"
            className={styles.modalTextarea}
            rows={6}
            value={broadcastMessageDraft}
            onChange={(e) => setBroadcastMessageDraft(e.target.value)}
            placeholder="輸入要廣播給所有已選取球員（或其代報者）的文字…"
            disabled={broadcastSending}
          />
          <div className={styles.modalActions}>
            <button type="button" className="btn btn-ghost" disabled={broadcastSending} onClick={() => setBroadcastModalOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" disabled={broadcastSending} onClick={() => void submitBroadcastLine()}>
              {broadcastSending ? '送出中…' : '送出 LINE 廣播'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
