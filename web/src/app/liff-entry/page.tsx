import { Suspense } from 'react'
import LiffEntryClient from './LiffEntryClient'

export const metadata = {
  title: 'LINE 快速報名',
}

export default function LiffEntryPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>載入中…</div>
      }
    >
      <LiffEntryClient />
    </Suspense>
  )
}
