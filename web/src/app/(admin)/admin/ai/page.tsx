'use client'

import AiIntegrationCard from '@/components/settings/AiIntegrationCard'
import styles from './ai.module.css'

export default function AdminAiPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>AI 整合（僅開發團隊／平台管理）</h1>
        <p className={styles.subtitle}>
          此區塊僅用於檢查伺服端 AI 環境變數是否已正確設定。團主不需要也不應看到此頁。
        </p>
      </header>

      <AiIntegrationCard />
    </div>
  )
}

