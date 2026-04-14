'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './users.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UserRow = any

type RoleFilter = 'all' | 'platform_admin' | 'venue_owner' | 'host' | 'player'

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
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<UserRow[]>([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')

  const [walletModalOpen, setWalletModalOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null)
  const [adjustAmount, setAdjustAmount] = useState<number>(0)
  const [adjustReason, setAdjustReason] = useState('')

  const filteredUsers = useMemo(() => {
    if (roleFilter === 'all') return users
    return users.filter((u) => u.primary_role === roleFilter)
  }, [users, roleFilter])

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
    }))

    setUsers(merged)
    setLoading(false)
  }

  useEffect(() => {
    fetchUsers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const handleOpenWalletModal = (u: UserRow) => {
    setSelectedUser(u)
    setAdjustAmount(0)
    setAdjustReason('')
    setWalletModalOpen(true)
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

      {loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>名稱</th>
                <th>身份</th>
                <th>錢包餘額</th>
                <th>狀態</th>
                <th>註冊時間</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id}>
                  <td>{u.display_name}</td>
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
                  <td className={styles.monoNum}>{formatTwd(u.wallet_balance)}</td>
                  <td>
                    {u.is_active ? (
                      <span className="badge badge-green">正常</span>
                    ) : (
                      <span className="badge badge-red">停權</span>
                    )}
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString('zh-TW')}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => handleToggleActive(u.id, u.is_active)}>
                        {u.is_active ? '停權' : '恢復'}
                      </button>
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => handleOpenWalletModal(u)}>
                        調整餘額
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className={styles.empty}>
                    找不到使用者
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
    </div>
  )
}
