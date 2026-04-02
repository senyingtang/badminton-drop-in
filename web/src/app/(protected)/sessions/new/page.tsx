'use client'

import CreateSessionForm from '@/components/sessions/CreateSessionForm'

export default function NewSessionPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, marginBottom: 'var(--space-2)' }}>
          建立場次
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          填寫場次基本資訊，建立後可加入球員名單
        </p>
      </div>
      <CreateSessionForm />
    </div>
  )
}
