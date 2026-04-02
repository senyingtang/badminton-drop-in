'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './users.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UserRow = any

export default function AdminUsersPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<UserRow[]>([])
  const [search, setSearch] = useState('')

  // Wallet adjustment state
  const [walletModalOpen, setWalletModalOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null)
  const [adjustAmount, setAdjustAmount] = useState<number>(0)
  const [adjustReason, setAdjustReason] = useState('')

  const fetchUsers = async () => {
    setLoading(true)
    let query = supabase
      .from('app_user_profiles')
      .select('id, display_name, primary_role, is_active, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
      
    if (search) {
      query = query.ilike('display_name', `%${search}%`)
    }

    const { data } = await query
    setUsers(data || [])
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
    // Only update primary role for demo
    const { error } = await supabase
      .from('app_user_profiles')
      .update({ primary_role: targetRole })
      .eq('id', userId)
      
    if (error) {
      alert('更新失敗')
    } else {
        alert('更新成功')
        await supabase.from('kb_audit_logs').insert({
            action_type: 'update_role',
            target_entity_type: 'user',
            target_entity_id: userId,
            new_data: { primary_role: targetRole }
        })
      fetchUsers()
    }
  }

  const handleToggleActive = async (userId: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from('app_user_profiles')
      .update({ is_active: !currentStatus })
      .eq('id', userId)

    if (error) {
      alert('停權失敗')
    } else {
        await supabase.from('kb_audit_logs').insert({
            action_type: currentStatus ? 'ban_user' : 'unban_user',
            target_entity_type: 'user',
            target_entity_id: userId,
        })
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
    if (!selectedUser || !adjustAmount || !adjustReason) return
    setLoading(true)
    
    // 1. Get current wallet
    let { data: wallet } = await supabase.from('kb_wallets').select('id, balance').eq('user_id', selectedUser.id).single()
    if (!wallet) {
      // Create wallet if not exist
      const { data: newWallet } = await supabase.from('kb_wallets').insert({ user_id: selectedUser.id, balance: 0 }).select('id, balance').single()
      wallet = newWallet
    }

    if (!wallet) {
      alert('無法取得錢包')
      setLoading(false)
      return
    }

    const type = adjustAmount >= 0 ? 'topup' : 'adjustment'

    const { error: txError } = await supabase.from('kb_wallet_transactions').insert({
      wallet_id: wallet.id,
      transaction_type: type,
      amount: adjustAmount,
      balance_after: wallet.balance + adjustAmount,
      description: `管理員調整: ${adjustReason}`,
      status: 'completed',
      metadata: { admin_adjusted: true, reason: adjustReason }
    })

    if (!txError) {
       await supabase.from('kb_wallets').update({ balance: wallet.balance + adjustAmount }).eq('id', wallet.id)
       await supabase.from('kb_audit_logs').insert({
          action_type: 'wallet_adjustment',
          target_entity_type: 'user',
          target_entity_id: selectedUser.id,
          reason: adjustReason,
          new_data: { amount: adjustAmount }
       })
       alert('調整成功')
       setWalletModalOpen(false)
    } else {
       alert('調整失敗: ' + txError.message)
    }
    
    setLoading(false)
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>使用者管理</h1>
      
      <div className={styles.controls}>
        <input 
          type="text" 
          className="input" 
          placeholder="搜尋會員暱稱..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearchClick()}
        />
        <button className="btn btn-primary" onClick={handleSearchClick}>搜尋</button>
      </div>

      {loading ? (
        <div className={styles.loading}><div className={styles.spinner} /></div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>名稱</th>
                <th>目前身份</th>
                <th>狀態</th>
                <th>註冊時間</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.display_name}</td>
                  <td>
                    <select 
                      className={`input ${styles.roleSelect}`}
                      value={u.primary_role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    >
                      <option value="player">球員 (player)</option>
                      <option value="host">團主 (host)</option>
                      <option value="platform_admin">管理員 (admin)</option>
                    </select>
                  </td>
                  <td>
                    {u.is_active ? 
                      <span className="badge badge-green">正常</span> : 
                      <span className="badge badge-red">停權</span>
                    }
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleToggleActive(u.id, u.is_active)}
                      >
                        {u.is_active ? '停權' : '恢復'}
                      </button>
                      <button 
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleOpenWalletModal(u)}
                      >
                        調整餘額
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className={styles.empty}>找不到使用者</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Wallet Modal */}
      {walletModalOpen && selectedUser && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>調整 {selectedUser.display_name} 的錢包餘額</h3>
            <div className={styles.modalBody}>
               <label>調整金額 (可為負數)</label>
               <input 
                 type="number" 
                 className="input" 
                 value={adjustAmount} 
                 onChange={(e) => setAdjustAmount(Number(e.target.value))} 
               />
               <label>調整原因</label>
               <input 
                 type="text" 
                 className="input" 
                 value={adjustReason} 
                 onChange={(e) => setAdjustReason(e.target.value)} 
                 placeholder="例：客服補償點數"
               />
            </div>
            <div className={styles.modalActions}>
               <button className="btn btn-ghost" onClick={() => setWalletModalOpen(false)}>取消</button>
               <button className="btn btn-primary" onClick={handleSubmitWalletAdjustment} disabled={!adjustReason || adjustAmount === 0}>確認調整</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
