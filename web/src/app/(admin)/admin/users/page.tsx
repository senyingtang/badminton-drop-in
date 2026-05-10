'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './users.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UserRow = any

type RoleFilter = 'all' | 'platform_admin' | 'venue_owner' | 'host' | 'player'

type HardDeletePreview = {
  userId: string
  email: string | null
  displayName: string | null
  role: string | null
  canHardDelete: boolean
  riskHints: string[]
  counts: {
    players: number
    sessionsHosted: number
    sessionsCreated: number
    participants: number
    matchScoreSubmissions: number
    walletBalanceCents: number
    walletTransactions: number
    billingEvents: number
    referralLinks: number
    subscriptions: number
    paymentOrders: number
  }
  reasons: Array<{ key: string; label: string; count?: number; message: string }>
  blockReasons: string[]
}

type ApiError = {
  ok: false
  code: string
  message: string
  reasons?: Array<{ key: string; label: string; count?: number; message: string }>
}

type PreviewOk = { ok: true; data: HardDeletePreview }

const ROLE_FILTERS: { id: RoleFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'platform_admin', label: '管理員' },
  { id: 'venue_owner', label: '場主' },
  { id: 'host', label: '團主' },
  { id: 'player', label: '球員' },
]

function roleLabel(role: string): string {
  const m: Record<string, string> = {
    platform_admin: '管理員',
    venue_owner: '場主',
    host: '團主',
    player: '球員',
  }
  return m[role] || role
}

function formatTwd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `NT$ ${Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export default function AdminUsersPage() {
  const supabase = createClient()
  const [actorUserId, setActorUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<UserRow[]>([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [banner, setBanner] = useState<string | null>(null)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkRole, setBulkRole] = useState<'player' | 'host' | 'venue_owner' | 'platform_admin'>('player')
  const [bulkLoading, setBulkLoading] = useState(false)

  const [membershipModalOpen, setMembershipModalOpen] = useState(false)
  const [membershipUser, setMembershipUser] = useState<UserRow | null>(null)
  const [membershipPlanCode, setMembershipPlanCode] = useState('personal_monthly_500')
  const [membershipStatus, setMembershipStatus] = useState<'active' | 'trialing' | 'canceled' | 'suspended'>('active')
  const [membershipStart, setMembershipStart] = useState<string>(() => new Date().toISOString())
  const [membershipEnd, setMembershipEnd] = useState<string>(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return d.toISOString()
  })
  const [membershipQuotaTotal, setMembershipQuotaTotal] = useState<number>(10)
  const [membershipProvider, setMembershipProvider] = useState<'manual' | 'ecpay' | 'newebpay' | 'stripe' | 'other'>('manual')
  const [membershipAutoRenew, setMembershipAutoRenew] = useState(false)
  const [membershipNote, setMembershipNote] = useState('')
  const [membershipLoading, setMembershipLoading] = useState(false)

  const [walletAdjNote, setWalletAdjNote] = useState('')
  const [walletAdjCents, setWalletAdjCents] = useState<number>(0)

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null)
  const [deletePreview, setDeletePreview] = useState<HardDeletePreview | null>(null)
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false)
  const [deleteExecLoading, setDeleteExecLoading] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [walletModalOpen, setWalletModalOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null)
  const [adjustAmount, setAdjustAmount] = useState<number>(0)
  const [adjustReason, setAdjustReason] = useState('')

  const filteredUsers = useMemo(() => {
    if (roleFilter === 'all') return users
    return users.filter((u) => u.primary_role === roleFilter)
  }, [users, roleFilter])

  const allFilteredIds = useMemo(() => filteredUsers.map((u) => String(u.id)), [filteredUsers])
  const allSelected = selectedIds.length > 0 && allFilteredIds.every((id) => selectedIds.includes(id))

  const fetchUsers = async () => {
    setLoading(true)
    let q = supabase
      .from('app_user_profiles')
      .select('id, display_name, primary_role, is_active, created_at')
      .order('created_at', { ascending: false })
      .limit(100)

    if (search.trim()) {
      q = q.ilike('display_name', `%${search.trim()}%`)
    }

    const [{ data: userData }, { data: walletData, error: walletErr }] = await Promise.all([
      q,
      supabase.from('kb_wallets').select('balance, kb_billing_accounts(owner_user_id, account_type)'),
    ])

    if (walletErr) {
      console.warn('Admin wallet list fetch:', walletErr.message)
    }

    const balanceByUser = new Map<string, number>()
    for (const row of walletData || []) {
      const acc = (row as { kb_billing_accounts?: { owner_user_id?: string; account_type?: string } | { owner_user_id?: string; account_type?: string }[] }).kb_billing_accounts
      const a = Array.isArray(acc) ? acc[0] : acc
      if (a?.account_type === 'personal' && a.owner_user_id) {
        balanceByUser.set(a.owner_user_id, Number((row as { balance: number }).balance))
      }
    }

    const merged = (userData || []).map((u: UserRow) => ({
      ...u,
      wallet_balance: balanceByUser.has(u.id) ? balanceByUser.get(u.id)! : null,
      // membership fields will be populated lazily (server-side API in future); keep placeholders for now
    }))

    setUsers(merged)
    setLoading(false)
    setSelectedIds([])
  }

  useEffect(() => {
    fetchUsers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setActorUserId(data.user?.id ?? null)
    })
  }, [supabase])

  const handleSearchClick = () => {
    fetchUsers()
  }

  const handleRoleChange = async (userId: string, targetRole: string) => {
    const { error } = await supabase.from('app_user_profiles').update({ primary_role: targetRole }).eq('id', userId)

    if (error) {
      alert('更新失敗')
    } else {
      try {
        await supabase.from('kb_audit_logs').insert({
          action_type: 'update_role',
          target_entity_type: 'user',
          target_entity_id: userId,
          new_data: { primary_role: targetRole },
        })
      } catch {
        /* audit 表若無 insert 權限則略過 */
      }
      alert('更新成功')
      fetchUsers()
    }
  }

  const handleToggleActive = async (userId: string, currentStatus: boolean) => {
    const { error } = await supabase.from('app_user_profiles').update({ is_active: !currentStatus }).eq('id', userId)

    if (error) {
      alert('停權失敗')
    } else {
      try {
        await supabase.from('kb_audit_logs').insert({
          action_type: currentStatus ? 'ban_user' : 'unban_user',
          target_entity_type: 'user',
          target_entity_id: userId,
        })
      } catch {
        /* ignore */
      }
      fetchUsers()
    }
  }

  const callBulkApi = async (path: string, body: unknown) => {
    setBulkLoading(true)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; failed?: Array<{ user_id: string; reason: string }> }
        | null
      if (!res.ok || !j?.ok) {
        alert(`批次操作失敗：${j?.error || `HTTP ${res.status}`}`)
        return
      }
      if (j.failed && j.failed.length > 0) {
        const sample = j.failed.slice(0, 5).map((f) => `${f.user_id}: ${f.reason}`).join('\n')
        alert(`部分失敗（前 5 筆）：\n${sample}`)
      }
      await fetchUsers()
    } finally {
      setBulkLoading(false)
    }
  }

  const openDeleteUserModal = async (u: UserRow) => {
    setDeleteTarget(u)
    setDeleteConfirmText('')
    setDeleteError(null)
    setDeletePreview(null)
    setDeleteModalOpen(true)
    setDeletePreviewLoading(true)
    try {
      const res = await fetch('/api/admin/users/delete-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id }),
      })
      const j = (await res.json().catch(() => null)) as PreviewOk | ApiError | null
      if (!res.ok || !j || j.ok === false) {
        const msg = j && j.ok === false ? j.message : `HTTP ${res.status}`
        const reasonMsgs = j && j.ok === false && j.reasons ? j.reasons.map((r) => r.message).join('\n') : ''
        setDeleteError(reasonMsgs || msg)
        return
      }
      setDeletePreview(j.data)
    } finally {
      setDeletePreviewLoading(false)
    }
  }

  const submitHardDelete = async () => {
    if (!deleteTarget || !deletePreview?.canHardDelete) return
    setDeleteExecLoading(true)
    setDeleteError(null)
    try {
      const res = await fetch('/api/admin/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: deleteTarget.id, confirmationText: deleteConfirmText.trim() }),
      })
      const j = (await res.json().catch(() => null)) as { ok: true } | ApiError | null
      if (!res.ok || !j || (j as ApiError).ok === false) {
        const err = j as ApiError | null
        const msg = err?.message || `HTTP ${res.status}`
        const reasonMsgs = err?.reasons ? err.reasons.map((r) => r.message).join('\n') : ''
        setDeleteError(reasonMsgs || msg)
        return
      }
      setDeleteModalOpen(false)
      setDeleteTarget(null)
      setDeletePreview(null)
      setDeleteConfirmText('')
      setBanner('使用者已刪除')
      await fetchUsers()
    } finally {
      setDeleteExecLoading(false)
    }
  }

  const handleOpenWalletModal = (u: UserRow) => {
    setSelectedUser(u)
    setAdjustAmount(0)
    setAdjustReason('')
    setWalletModalOpen(true)
  }

  const handleOpenMembershipModal = (u: UserRow) => {
    setMembershipUser(u)
    setMembershipPlanCode('personal_monthly_500')
    setMembershipStatus('active')
    setMembershipQuotaTotal(10)
    setMembershipProvider('manual')
    setMembershipAutoRenew(false)
    setMembershipNote('')
    const now = new Date()
    setMembershipStart(now.toISOString())
    const end = new Date(now)
    end.setMonth(end.getMonth() + 1)
    setMembershipEnd(end.toISOString())
    setWalletAdjNote('')
    setWalletAdjCents(0)
    setMembershipModalOpen(true)
  }

  const handleGrantSubscription = async () => {
    if (!membershipUser) return
    setMembershipLoading(true)
    try {
      const res = await fetch('/api/admin/users/grant-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: membershipUser.id,
          planCode: membershipPlanCode,
          status: membershipStatus,
          periodStart: membershipStart,
          periodEnd: membershipEnd,
          quotaTotal: membershipQuotaTotal,
          provider: membershipProvider,
          autoRenew: membershipAutoRenew,
          note: membershipNote,
        }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !j?.ok) {
        alert(`開通/調整失敗：${j?.error || `HTTP ${res.status}`}`)
        return
      }
      alert('已更新會員資格')
      setMembershipModalOpen(false)
      await fetchUsers()
    } finally {
      setMembershipLoading(false)
    }
  }

  const handleCancelSubscription = async (mode: 'immediate' | 'period_end') => {
    if (!membershipUser) return
    setMembershipLoading(true)
    try {
      const res = await fetch('/api/admin/users/cancel-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: membershipUser.id, mode, note: membershipNote }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !j?.ok) {
        alert(`取消失敗：${j?.error || `HTTP ${res.status}`}`)
        return
      }
      alert('已取消訂閱')
      setMembershipModalOpen(false)
      await fetchUsers()
    } finally {
      setMembershipLoading(false)
    }
  }

  const handleAdjustQuota = async () => {
    if (!membershipUser) return
    setMembershipLoading(true)
    try {
      const res = await fetch('/api/admin/users/adjust-quota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: membershipUser.id, delta: membershipQuotaTotal, note: membershipNote }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !j?.ok) {
        alert(`補 quota 失敗：${j?.error || `HTTP ${res.status}`}`)
        return
      }
      alert('已調整 quota')
      await fetchUsers()
    } finally {
      setMembershipLoading(false)
    }
  }

  const handleAdjustWallet = async () => {
    if (!membershipUser) return
    setMembershipLoading(true)
    try {
      const res = await fetch('/api/admin/users/adjust-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: membershipUser.id, amount_cents: walletAdjCents, note: walletAdjNote || membershipNote }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !j?.ok) {
        alert(`調整儲值金失敗：${j?.error || `HTTP ${res.status}`}`)
        return
      }
      alert('已調整儲值金')
      await fetchUsers()
    } finally {
      setMembershipLoading(false)
    }
  }

  const handleSubmitWalletAdjustment = async () => {
    if (!selectedUser || adjustAmount === 0 || !adjustReason.trim()) return
    setLoading(true)
    try {
      const { error } = await supabase.rpc('kb_admin_adjust_user_wallet', {
        p_target_user_id: selectedUser.id,
        p_delta: adjustAmount,
        p_reason: adjustReason.trim(),
      })
      if (error) {
        const msg = error.message || ''
        if (msg.includes('Could not find') || msg.includes('does not exist')) {
          alert('請在 Supabase 執行 docs/028_kb_wallet_admin_and_self_topup.sql 後再試。')
        } else {
          alert('調整失敗：' + msg)
        }
        return
      }
      alert('調整成功')
      setWalletModalOpen(false)
      await fetchUsers()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>使用者管理</h1>
      <p className={styles.subtitle}>
        依身份檢視會員；錢包欄為<strong>個人計費帳戶</strong>錢包餘額（與場次超額扣款相同來源）。
      </p>

      {banner && (
        <div className={styles.bannerSuccess} role="status">
          <span>{banner}</span>
          <button type="button" className={styles.bannerDismiss} onClick={() => setBanner(null)} aria-label="關閉提示">
            ✕
          </button>
        </div>
      )}

      <div className={styles.controls}>
        <input
          type="text"
          className="input"
          placeholder="搜尋會員暱稱..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearchClick()}
        />
        <button className="btn btn-primary" type="button" onClick={handleSearchClick}>
          搜尋
        </button>
      </div>

      <div className={styles.roleFilters} role="tablist" aria-label="依身份篩選">
        {ROLE_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={roleFilter === f.id}
            className={`${styles.roleFilterBtn} ${roleFilter === f.id ? styles.roleFilterBtnActive : ''}`}
            onClick={() => setRoleFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {selectedIds.length > 0 && (
        <div className={styles.bulkBar}>
          <div className={styles.bulkText}>
            已選取 <strong>{selectedIds.length}</strong> 位
          </div>
          <select className="input" value={bulkRole} onChange={(e) => setBulkRole(e.target.value as any)}>
            <option value="player">球員 (player)</option>
            <option value="host">團主 (host)</option>
            <option value="venue_owner">場主 (venue_owner)</option>
            <option value="platform_admin">管理員 (platform_admin)</option>
          </select>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={bulkLoading}
            onClick={() => {
              if (!confirm(`確定要批次修改 ${selectedIds.length} 位使用者身份為 ${roleLabel(bulkRole)}？`)) return
              void callBulkApi('/api/admin/users/bulk-update-role', { user_ids: selectedIds, target_role: bulkRole })
            }}
          >
            批次修改身份
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={bulkLoading}
            onClick={() => {
              if (!confirm(`確定要批次停用 ${selectedIds.length} 位使用者？`)) return
              void callBulkApi('/api/admin/users/bulk-disable', { user_ids: selectedIds })
            }}
          >
            批次停用
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={bulkLoading}
            onClick={() => {
              if (!confirm(`確定要批次恢復 ${selectedIds.length} 位使用者？`)) return
              void callBulkApi('/api/admin/users/bulk-restore', { user_ids: selectedIds })
            }}
          >
            批次恢復
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => setSelectedIds([])} disabled={bulkLoading}>
            清除選取
          </button>
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      ) : (
        <div className={styles.tableContainer}>
          <div className={styles.tableScroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: 48 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds(Array.from(new Set([...selectedIds, ...allFilteredIds])))
                        else setSelectedIds(selectedIds.filter((id) => !allFilteredIds.includes(id)))
                      }}
                      aria-label="全選"
                    />
                  </th>
                  <th style={{ width: 160 }}>名稱</th>
                  <th style={{ width: 260 }}>身份</th>
                  <th style={{ width: 120 }}>錢包餘額</th>
                  <th style={{ width: 260 }}>會員</th>
                  <th style={{ width: 100 }}>狀態</th>
                  <th style={{ width: 130 }}>註冊時間</th>
                  <th style={{ width: 180 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(String(u.id))}
                        onChange={(e) => {
                          const id = String(u.id)
                          setSelectedIds((prev) => (e.target.checked ? [...prev, id] : prev.filter((x) => x !== id)))
                        }}
                        aria-label={`選取 ${u.display_name}`}
                      />
                    </td>
                    <td title={u.display_name}>{u.display_name}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span className="badge badge-blue">{roleLabel(u.primary_role)}</span>
                        <select
                          className={`input ${styles.roleSelect}`}
                          value={u.primary_role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        >
                          <option value="player">球員 (player)</option>
                          <option value="host">團主 (host)</option>
                          <option value="venue_owner">場主 (venue_owner)</option>
                          <option value="platform_admin">管理員 (platform_admin)</option>
                        </select>
                      </div>
                    </td>
                    <td className={styles.monoNum} title={formatTwd(u.wallet_balance)}>
                      {formatTwd(u.wallet_balance)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span className={styles.membershipHint}>會員摘要待接</span>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => handleOpenMembershipModal(u)}>
                          調整會員
                        </button>
                      </div>
                    </td>
                    <td>
                      {u.is_active ? (
                        <span className="badge badge-green">正常</span>
                      ) : (
                        <span className="badge badge-red">停權</span>
                      )}
                    </td>
                    <td title={new Date(u.created_at).toISOString()}>{new Date(u.created_at).toLocaleDateString('zh-TW')}</td>
                    <td>
                      <div className={styles.cellActions}>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => handleToggleActive(u.id, u.is_active)}>
                          {u.is_active ? '停權' : '恢復'}
                        </button>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => handleOpenWalletModal(u)}>
                          調整餘額
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={actorUserId != null && String(u.id) === actorUserId}
                          onClick={() => void openDeleteUserModal(u)}
                        >
                          刪除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={8} className={styles.empty}>
                      找不到使用者
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && (
        <div className={styles.mobileList}>
          {filteredUsers.map((u) => (
            <div key={u.id} className={styles.userCard}>
              <div className={styles.cardTop}>
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(String(u.id))}
                    onChange={(e) => {
                      const id = String(u.id)
                      setSelectedIds((prev) => (e.target.checked ? [...prev, id] : prev.filter((x) => x !== id)))
                    }}
                    aria-label={`選取 ${u.display_name}`}
                  />
                  <span className={styles.cardName} title={u.display_name}>
                    {u.display_name}
                  </span>
                </label>
                {u.is_active ? <span className="badge badge-green">正常</span> : <span className="badge badge-red">停權</span>}
              </div>

              <div className={styles.cardMeta}>
                <span>身份：{roleLabel(u.primary_role)}</span>
                <span className={styles.monoNum}>錢包：{formatTwd(u.wallet_balance)}</span>
                <span>會員：會員摘要待接</span>
                <span>註冊：{new Date(u.created_at).toLocaleDateString('zh-TW')}</span>
              </div>

              <div className={styles.cardActions}>
                <button className="btn btn-ghost" type="button" onClick={() => handleToggleActive(u.id, u.is_active)}>
                  {u.is_active ? '停權' : '恢復'}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => handleOpenWalletModal(u)}>
                  調整餘額
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => handleOpenMembershipModal(u)}>
                  調整會員
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={actorUserId != null && String(u.id) === actorUserId}
                  onClick={() => void openDeleteUserModal(u)}
                >
                  刪除
                </button>
              </div>
            </div>
          ))}
          {filteredUsers.length === 0 && <div className={styles.empty}>找不到使用者</div>}
        </div>
      )}

      {walletModalOpen && selectedUser && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>調整 {selectedUser.display_name} 的錢包餘額</h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-tertiary)' }}>
              目前餘額：<strong>{formatTwd(selectedUser.wallet_balance)}</strong>
            </p>
            <div className={styles.modalBody}>
              <label>調整金額 (可為負數，單位 NT$)</label>
              <input type="number" className="input" value={adjustAmount} onChange={(e) => setAdjustAmount(Number(e.target.value))} />
              <label>調整原因（必填）</label>
              <input
                type="text"
                className="input"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="例：客服補償點數"
              />
            </div>
            <div className={styles.modalActions}>
              <button className="btn btn-ghost" type="button" onClick={() => setWalletModalOpen(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={handleSubmitWalletAdjustment}
                disabled={!adjustReason.trim() || adjustAmount === 0 || loading}
              >
                確認調整
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModalOpen && deleteTarget && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>永久刪除使用者</h3>
            <div className={styles.modalBody}>
              {deletePreviewLoading && <p style={{ margin: 0, color: 'var(--text-tertiary)' }}>載入刪除預覽中…</p>}
              {deleteError && (
                <p style={{ margin: 0, color: '#fca5a5', fontSize: 14, whiteSpace: 'pre-line' }} role="alert">
                  {deleteError}
                </p>
              )}
              {deletePreview && !deletePreviewLoading && (
                <>
                  <p style={{ margin: 0, fontSize: 14 }}>
                    <strong>Email：</strong>
                    {deletePreview.email || '—'}
                  </p>
                  <p style={{ margin: 0, fontSize: 14 }}>
                    <strong>顯示名稱：</strong>
                    {deletePreview.displayName || deleteTarget.display_name || '—'}
                  </p>
                  <p style={{ margin: 0, fontSize: 14 }}>
                    <strong>身份：</strong>
                    {roleLabel(deletePreview.role || '')}
                  </p>
                  <dl className={styles.previewCounts}>
                    <dt>球員（players）</dt>
            <dd>{deletePreview.counts.players}</dd>
                    <dt>主辦場次（host）</dt>
            <dd>{deletePreview.counts.sessionsHosted}</dd>
                    <dt>建立場次（created_by）</dt>
            <dd>{deletePreview.counts.sessionsCreated}</dd>
                    <dt>參與報名（participants）</dt>
            <dd>{deletePreview.counts.participants}</dd>
                    <dt>錢包餘額（分）</dt>
            <dd>{deletePreview.counts.walletBalanceCents}</dd>
                    <dt>錢包流水筆數</dt>
            <dd>{deletePreview.counts.walletTransactions}</dd>
                    <dt>帳務事件</dt>
            <dd>{deletePreview.counts.billingEvents}</dd>
                    <dt>推薦連結（referrer+referred）</dt>
            <dd>{deletePreview.counts.referralLinks}</dd>
                    <dt>訂閱</dt>
            <dd>{deletePreview.counts.subscriptions}</dd>
                    <dt>付款訂單</dt>
            <dd>{deletePreview.counts.paymentOrders}</dd>
                    <dt>比分提交</dt>
            <dd>{deletePreview.counts.matchScoreSubmissions}</dd>
                    <dt>候補晉升紀錄</dt>
            <dd>—</dd>
                  </dl>
                  {deletePreview.riskHints.length > 0 && (
                    <ul className={styles.riskHintList}>
                      {deletePreview.riskHints.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                  )}
          {!deletePreview.canHardDelete && deletePreview.reasons.length > 0 && (
                    <div>
                      <div className={styles.modalSectionTitle}>無法刪除</div>
                      <ul className={styles.blockReasonList}>
                {deletePreview.reasons.map((r) => (
                  <li key={r.key}>{r.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {deletePreview.canHardDelete && (
                    <>
                      <label htmlFor="hard-delete-confirm">請輸入 DELETE 以確認永久刪除</label>
                      <input
                        id="hard-delete-confirm"
                        className="input"
                        autoComplete="off"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="DELETE"
                      />
                    </>
                  )}
                </>
              )}
            </div>
            <div className={styles.modalActions}>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={deleteExecLoading}
                onClick={() => {
                  setDeleteModalOpen(false)
                  setDeleteTarget(null)
                  setDeletePreview(null)
                  setDeleteError(null)
                  setDeleteConfirmText('')
                }}
              >
                關閉
              </button>
              {deletePreview?.canHardDelete && (
                <button
                  className={`btn ${styles.btnDanger}`}
                  type="button"
                  disabled={deleteExecLoading || deleteConfirmText.trim() !== 'DELETE' || deletePreviewLoading}
                  onClick={() => void submitHardDelete()}
                >
                  {deleteExecLoading ? '刪除中…' : '永久刪除'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {membershipModalOpen && membershipUser && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>調整會員：{membershipUser.display_name}</h3>
            <div className={styles.modalBody}>
              <div className={styles.modalSectionTitle}>會員方案</div>
              <div className={styles.modalGrid2}>
                <div>
                  <label>方案</label>
                  <select className="input" value={membershipPlanCode} onChange={(e) => setMembershipPlanCode(e.target.value)}>
                    <option value="free_wallet_only">儲值金用戶 (free_wallet_only)</option>
                    <option value="personal_monthly_500">個人月費 (personal_monthly_500)</option>
                  </select>
                </div>
                <div>
                  <label>狀態</label>
                  <select className="input" value={membershipStatus} onChange={(e) => setMembershipStatus(e.target.value as any)}>
                    <option value="active">active</option>
                    <option value="trialing">trialing</option>
                    <option value="canceled">canceled</option>
                    <option value="suspended">suspended</option>
                  </select>
                </div>
              </div>

              <div className={styles.modalSectionTitle}>期間與 quota</div>
              <div className={styles.modalGrid2}>
                <div>
                  <label>開始日期（ISO）</label>
                  <input className="input" value={membershipStart} onChange={(e) => setMembershipStart(e.target.value)} />
                </div>
                <div>
                  <label>結束日期（ISO）</label>
                  <input className="input" value={membershipEnd} onChange={(e) => setMembershipEnd(e.target.value)} />
                </div>
                <div>
                  <label>本期 quota（personal_monthly_500 預設 10）</label>
                  <input
                    type="number"
                    className="input"
                    value={membershipQuotaTotal}
                    onChange={(e) => setMembershipQuotaTotal(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label>Provider</label>
                  <select className="input" value={membershipProvider} onChange={(e) => setMembershipProvider(e.target.value as any)}>
                    <option value="manual">manual</option>
                    <option value="ecpay">ecpay</option>
                    <option value="newebpay">newebpay</option>
                    <option value="stripe">stripe</option>
                    <option value="other">other</option>
                  </select>
                </div>
              </div>

              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={membershipAutoRenew} onChange={(e) => setMembershipAutoRenew(e.target.checked)} />
                auto_renew（自動續費）
              </label>

              <div className={styles.modalSectionTitle}>補 quota</div>
              <div className={styles.modalGrid2}>
                <div>
                  <label>delta（正數；使用上方 quota 欄位）</label>
                  <button className="btn btn-secondary" type="button" disabled={membershipLoading} onClick={() => void handleAdjustQuota()}>
                    補 quota
                  </button>
                </div>
              </div>

              <div className={styles.modalSectionTitle}>儲值金調整</div>
              <div className={styles.modalGrid2}>
                <div>
                  <label>amount_cents（可正可負；不得讓餘額變負）</label>
                  <input type="number" className="input" value={walletAdjCents} onChange={(e) => setWalletAdjCents(Number(e.target.value))} />
                </div>
                <div>
                  <label>備註（錢包調整用）</label>
                  <input className="input" value={walletAdjNote} onChange={(e) => setWalletAdjNote(e.target.value)} placeholder="例：客服補償/人工收款" />
                </div>
                <div>
                  <button className="btn btn-secondary" type="button" disabled={membershipLoading} onClick={() => void handleAdjustWallet()}>
                    調整儲值金
                  </button>
                </div>
              </div>

              <div className={styles.modalSectionTitle}>備註與操作</div>
              <div className={styles.modalGrid2}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label>備註</label>
                  <input
                    className="input"
                    value={membershipNote}
                    onChange={(e) => setMembershipNote(e.target.value)}
                    placeholder="例如：測試帳號/人工收款/補償"
                  />
                </div>
              </div>
            </div>

            <div className={styles.modalActions} style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" type="button" disabled={membershipLoading} onClick={() => void handleCancelSubscription('immediate')}>
                  取消會員（立即）
                </button>
                <button className="btn btn-ghost" type="button" disabled={membershipLoading} onClick={() => void handleCancelSubscription('period_end')}>
                  取消會員（到期）
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" type="button" onClick={() => setMembershipModalOpen(false)} disabled={membershipLoading}>
                  關閉
                </button>
                <button className="btn btn-primary" type="button" onClick={() => void handleGrantSubscription()} disabled={membershipLoading}>
                  {membershipLoading ? '處理中…' : '開通/更新會員'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
