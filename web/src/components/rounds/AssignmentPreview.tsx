'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import MatchCard from './MatchCard'
import { AssignmentResult, swapPlayers } from '@/lib/engine/assignment-engine'
import styles from './AssignmentPreview.module.css'

interface AssignmentPreviewProps {
  isOpen: boolean
  onClose: () => void
  result: AssignmentResult
  roundNo: number
  onConfirm: (result: AssignmentResult) => Promise<void>
  onRegenerate: () => void
}

export default function AssignmentPreview({
  isOpen,
  onClose,
  result: initialResult,
  roundNo,
  onConfirm,
  onRegenerate,
}: AssignmentPreviewProps) {
  const [result, setResult] = useState<AssignmentResult>(initialResult)
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  // Sync preview state when parent regenerates
  useEffect(() => {
    setResult(initialResult)
    setSelectedPlayerId(null)
    setConfirmError(null)
  }, [initialResult])

  const handlePlayerClick = (participantId: string) => {
    if (!selectedPlayerId) {
      setSelectedPlayerId(participantId)
    } else if (selectedPlayerId === participantId) {
      setSelectedPlayerId(null)
    } else {
      // Perform swap
      const swapped = swapPlayers(result, selectedPlayerId, participantId)
      setResult(swapped)
      setSelectedPlayerId(null)
    }
  }

  const handleConfirm = async () => {
    setConfirming(true)
    setConfirmError(null)
    try {
      await onConfirm(result)
      // Close on success
      onClose()
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: string }).message)
          : '建立失敗，請稍後再試'
      setConfirmError(msg)
    } finally {
      setConfirming(false)
    }
  }

  const handleRegenerate = () => {
    setSelectedPlayerId(null)
    setConfirmError(null)
    onRegenerate()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`第 ${roundNo} 輪排組預覽`} size="lg">
      <div className={styles.content}>
        {/* Stats */}
        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>上場人數</span>
            <span className={styles.statValue}>{result.debugInfo.playersAssigned}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>場地數</span>
            <span className={styles.statValue}>{result.assignments.length}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>上場平均級數</span>
            <span className={styles.statValue}>
              {(result.debugInfo.avgPlayingLevel ?? 0).toFixed(1)}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>隊伍級差平均</span>
            <span className={styles.statValue}>{result.debugInfo.avgLevelDiff.toFixed(1)}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>休息人數</span>
            <span className={styles.statValue}>{result.restingPlayers.length}</span>
          </div>
        </div>

        {/* Warnings */}
        {result.warnings.length > 0 && (
          <div className={styles.warnings}>
            {result.warnings.map((w, i) => (
              <div key={i} className={styles.warning}>⚠ {w}</div>
            ))}
          </div>
        )}

        {confirmError && (
          <div className={styles.warnings}>
            <div className={styles.warning}>✕ {confirmError}</div>
          </div>
        )}

        {/* Swap hint */}
        <div className={styles.hint}>
          {selectedPlayerId
            ? '👆 點擊第二位球員完成交換'
            : '💡 點擊任意球員開始交換位置'}
        </div>

        {/* Match cards */}
        <div className={styles.matchGrid}>
          {result.assignments.map((a) => (
            <MatchCard
              key={a.courtNo}
              courtNo={a.courtNo}
              matchLabel={`R${roundNo}-C${a.courtNo}`}
              team1={a.team1}
              team2={a.team2}
              status="draft"
              selectedPlayerId={selectedPlayerId}
              onPlayerClick={handlePlayerClick}
            />
          ))}
        </div>

        {/* Resting players */}
        {result.restingPlayers.length > 0 && (
          <div className={styles.restSection}>
            <h4 className={styles.restTitle}>
              本輪休息 ({result.restingPlayers.length})
            </h4>
            <div className={styles.restList}>
              {result.restingPlayers.map((p) => (
                <button
                  key={p.participantId}
                  className={`${styles.restPlayer} ${selectedPlayerId === p.participantId ? styles.restSelected : ''}`}
                  onClick={() => handlePlayerClick(p.participantId)}
                  type="button"
                >
                  <span>{p.displayName}</span>
                  <span className={styles.restLevel}>Lv.{p.level}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className={styles.actions}>
          <button className="btn btn-ghost" onClick={handleRegenerate} disabled={confirming}>
            🔄 重新產生
          </button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={confirming}>
            {confirming ? '寫入中...' : '✓ 確認並建立'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
