'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { hasPublicSupabaseConfig } from '@/lib/supabase/env'
import styles from './audit.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuditLog = any

export default function AdminAuditPage() {
  const supabase = createClient()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchLogs = async () => {
      if (!hasPublicSupabaseConfig()) {
        setLogs([])
        setLoading(false)
        return
      }
      const { data } = await supabase
        .from('kb_audit_logs')
        .select(`
          id,
          action_type,
          target_entity_type,
          target_entity_id,
          reason,
          new_data,
          created_at,
          app_user_profiles(display_name)
        `)
        .order('created_at', { ascending: false })
        .limit(100)

      setLogs(data || [])
      setLoading(false)
    }

    fetchLogs()
  }, [supabase])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>操作稽核紀錄</h1>
      <p className={styles.subtitle}>追蹤全站高風險與敏感操作</p>

      {loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>時間</th>
                <th>操作者</th>
                <th>主旨 (Action)</th>
                <th>目標種類</th>
                <th>目標 ID</th>
                <th>異動資料/原因</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.created_at).toLocaleString('zh-TW')}</td>
                  <td>{log.app_user_profiles?.display_name || '系統'}</td>
                  <td>
                    <span className={styles.actionBadge}>{log.action_type}</span>
                  </td>
                  <td>{log.target_entity_type}</td>
                  <td>
                    <span className={styles.idTruncated} title={log.target_entity_id}>
                      {log.target_entity_id ? log.target_entity_id.split('-')[0] + '...' : '-'}
                    </span>
                  </td>
                  <td>
                    <div className={styles.reason}>
                      {log.reason && <span>{log.reason}</span>}
                      {log.new_data && (
                        <pre className={styles.jsonData}>
                          {JSON.stringify(log.new_data)}
                        </pre>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className={styles.empty}>目前沒有稽核紀錄</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
