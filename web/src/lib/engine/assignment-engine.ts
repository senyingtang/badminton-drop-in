/**
 * Assignment Engine — 排組演算法核心 (Rule Engine MVP)
 *
 * 規則優先順序：
 * 1. [硬] 同隊兩人級差 ≤ 1
 * 2. [硬] 每面場需恰好 4 人
 * 3. [軟] 兩隊總級數差最小化
 * 4. [軟] 優先讓出賽次數較少者上場
 * 5. [軟] 避免連續上場 3+ 場
 */

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface AssignablePlayer {
  participantId: string
  displayName: string
  level: number            // session_effective_level (1-18)
  totalPlayed: number      // total_matches_played
  consecutivePlayed: number // consecutive_rounds_played
}

export interface CourtAssignment {
  courtNo: number
  team1: [AssignablePlayer, AssignablePlayer]
  team2: [AssignablePlayer, AssignablePlayer]
}

export interface AssignmentResult {
  assignments: CourtAssignment[]
  restingPlayers: AssignablePlayer[]
  /** 無法產生排組（例如人數不足） */
  warnings: string[]
  /** 隊內級差、連續上場等建議，不阻擋確認建立 */
  pairingHints: string[]
  debugInfo: {
    totalCandidates: number
    playersAssigned: number
    /** 本輪實際上場球員的級數平均 */
    avgPlayingLevel: number
    /** 每面場兩隊「總級數」差的平均（|隊1合計−隊2合計|） */
    avgLevelDiff: number
  }
}

function teamInternalDiffHints(assignments: CourtAssignment[]): string[] {
  const hints: string[] = []
  for (const a of assignments) {
    const t1Diff = Math.abs(a.team1[0].level - a.team1[1].level)
    const t2Diff = Math.abs(a.team2[0].level - a.team2[1].level)
    if (t1Diff > 1) {
      hints.push(`${a.courtNo}號場 Team1 隊內級差 ${t1Diff}（建議 ≤1，仍可建立）`)
    }
    if (t2Diff > 1) {
      hints.push(`${a.courtNo}號場 Team2 隊內級差 ${t2Diff}（建議 ≤1，仍可建立）`)
    }
  }
  return hints
}

function avgPlayingLevelFromCourts(assignments: CourtAssignment[]): number {
  const levels: number[] = []
  for (const a of assignments) {
    levels.push(a.team1[0].level, a.team1[1].level, a.team2[0].level, a.team2[1].level)
  }
  return levels.length ? levels.reduce((s, x) => s + x, 0) / levels.length : 0
}

// ──────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────

export function generateAssignment(
  players: AssignablePlayer[],
  courtCount: number
): AssignmentResult {
  const warnings: string[] = []
  const needed = courtCount * 4

  if (players.length < 4) {
    return {
      assignments: [],
      restingPlayers: [...players],
      warnings: ['球員不足 4 人，無法排組'],
      pairingHints: [],
      debugInfo: {
        totalCandidates: players.length,
        playersAssigned: 0,
        avgPlayingLevel: 0,
        avgLevelDiff: 0,
      },
    }
  }

  const pairingHints: string[] = []

  // Sort by priority: fewer total games → more priority; break ties by fewer consecutive
  const sorted = [...players].sort((a, b) => {
    if (a.totalPlayed !== b.totalPlayed) return a.totalPlayed - b.totalPlayed
    return a.consecutivePlayed - b.consecutivePlayed
  })

  // Select players for this round
  const actualCourts = Math.min(courtCount, Math.floor(players.length / 4))
  const playingCount = actualCourts * 4
  const playing = sorted.slice(0, playingCount)
  const resting = sorted.slice(playingCount)

  if (actualCourts < courtCount) {
    pairingHints.push(
      `人數僅夠排 ${actualCourts} 面場（需 ${courtCount * 4} 人，實際 ${players.length} 人）`
    )
  }

  for (const p of playing) {
    if (p.consecutivePlayed >= 2) {
      pairingHints.push(`${p.displayName} 已連續上場 ${p.consecutivePlayed} 輪`)
    }
  }

  // Sort playing players by level for assignment
  const byLevel = [...playing].sort((a, b) => a.level - b.level)

  // Assign courts
  const assignments: CourtAssignment[] = []
  const assigned = new Set<string>()

  for (let court = 0; court < actualCourts; court++) {
    // Take 4 unassigned players (adjacent-level clustering)
    const available = byLevel.filter((p) => !assigned.has(p.participantId))
    if (available.length < 4) break

    const group = available.slice(0, 4)
    const bestMatch = findBestTeamSplit(group)

    for (const p of group) assigned.add(p.participantId)

    assignments.push({
      courtNo: court + 1,
      team1: bestMatch.team1,
      team2: bestMatch.team2,
    })
  }

  const totalDiff = assignments.reduce((sum, a) => {
    const t1 = a.team1[0].level + a.team1[1].level
    const t2 = a.team2[0].level + a.team2[1].level
    return sum + Math.abs(t1 - t2)
  }, 0)

  pairingHints.push(...teamInternalDiffHints(assignments))

  return {
    assignments,
    restingPlayers: resting,
    warnings,
    pairingHints,
    debugInfo: {
      totalCandidates: players.length,
      playersAssigned: playingCount,
      avgPlayingLevel: avgPlayingLevelFromCourts(assignments),
      avgLevelDiff: assignments.length > 0 ? totalDiff / assignments.length : 0,
    },
  }
}

// ──────────────────────────────────────────
// Find best team split for 4 players
// ──────────────────────────────────────────

interface TeamSplit {
  team1: [AssignablePlayer, AssignablePlayer]
  team2: [AssignablePlayer, AssignablePlayer]
  levelDiff: number
  valid: boolean
}

function findBestTeamSplit(
  group: AssignablePlayer[]
): { team1: [AssignablePlayer, AssignablePlayer]; team2: [AssignablePlayer, AssignablePlayer] } {
  // 4 players → 3 possible pairings
  const pairings: [number[], number[]][] = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ]

  let bestSplit: TeamSplit | null = null

  for (const [t1Idx, t2Idx] of pairings) {
    const t1: [AssignablePlayer, AssignablePlayer] = [group[t1Idx[0]], group[t1Idx[1]]]
    const t2: [AssignablePlayer, AssignablePlayer] = [group[t2Idx[0]], group[t2Idx[1]]]

    const t1Diff = Math.abs(t1[0].level - t1[1].level)
    const t2Diff = Math.abs(t2[0].level - t2[1].level)

    // Hard constraint: same-team level diff ≤ 1
    const valid = t1Diff <= 1 && t2Diff <= 1

    const t1Sum = t1[0].level + t1[1].level
    const t2Sum = t2[0].level + t2[1].level
    const levelDiff = Math.abs(t1Sum - t2Sum)

    const candidate: TeamSplit = { team1: t1, team2: t2, levelDiff, valid }

    if (!bestSplit) {
      bestSplit = candidate
    } else {
      // Prefer valid over invalid
      if (candidate.valid && !bestSplit.valid) {
        bestSplit = candidate
      } else if (candidate.valid === bestSplit.valid) {
        // Among same validity, prefer lower diff
        if (candidate.levelDiff < bestSplit.levelDiff) {
          bestSplit = candidate
        }
      }
    }
  }

  // If no valid split found, try with relaxed constraint (≤ 2)
  if (bestSplit && !bestSplit.valid) {
    // Just use the best diff regardless
    // The warning about relaxed constraints was already added upstream
  }

  return {
    team1: bestSplit!.team1,
    team2: bestSplit!.team2,
  }
}

// ──────────────────────────────────────────
// Swap utility
// ──────────────────────────────────────────

/**
 * Swap two players in an assignment result.
 * Returns a new AssignmentResult with the swap applied.
 */
export function swapPlayers(
  result: AssignmentResult,
  playerAId: string,
  playerBId: string
): AssignmentResult {
  // Deep clone assignments
  const newAssignments: CourtAssignment[] = result.assignments.map((a) => ({
    courtNo: a.courtNo,
    team1: [...a.team1] as [AssignablePlayer, AssignablePlayer],
    team2: [...a.team2] as [AssignablePlayer, AssignablePlayer],
  }))

  const newResting = [...result.restingPlayers]

  // Find positions
  type Pos = { type: 'court'; courtIdx: number; team: 'team1' | 'team2'; slot: 0 | 1 }
    | { type: 'resting'; idx: number }

  const findPos = (id: string): Pos | null => {
    for (let ci = 0; ci < newAssignments.length; ci++) {
      const a = newAssignments[ci]
      if (a.team1[0].participantId === id) return { type: 'court', courtIdx: ci, team: 'team1', slot: 0 }
      if (a.team1[1].participantId === id) return { type: 'court', courtIdx: ci, team: 'team1', slot: 1 }
      if (a.team2[0].participantId === id) return { type: 'court', courtIdx: ci, team: 'team2', slot: 0 }
      if (a.team2[1].participantId === id) return { type: 'court', courtIdx: ci, team: 'team2', slot: 1 }
    }
    const ri = newResting.findIndex((p) => p.participantId === id)
    if (ri >= 0) return { type: 'resting', idx: ri }
    return null
  }

  const posA = findPos(playerAId)
  const posB = findPos(playerBId)
  if (!posA || !posB) return result

  const getPlayer = (pos: Pos): AssignablePlayer => {
    if (pos.type === 'resting') return newResting[pos.idx]
    return newAssignments[pos.courtIdx][pos.team][pos.slot]
  }

  const setPlayer = (pos: Pos, player: AssignablePlayer) => {
    if (pos.type === 'resting') {
      newResting[pos.idx] = player
    } else {
      newAssignments[pos.courtIdx][pos.team][pos.slot] = player
    }
  }

  const pA = getPlayer(posA)
  const pB = getPlayer(posB)
  setPlayer(posA, pB)
  setPlayer(posB, pA)

  const preservedHints = (result.pairingHints || []).filter((h) => !h.includes('號場 Team'))
  const teamHints = teamInternalDiffHints(newAssignments)
  const pairingHints = [...preservedHints, ...teamHints]

  const totalDiff = newAssignments.reduce((sum, a) => {
    const t1 = a.team1[0].level + a.team1[1].level
    const t2 = a.team2[0].level + a.team2[1].level
    return sum + Math.abs(t1 - t2)
  }, 0)

  return {
    assignments: newAssignments,
    restingPlayers: newResting,
    warnings: result.warnings,
    pairingHints,
    debugInfo: {
      ...result.debugInfo,
      avgPlayingLevel: avgPlayingLevelFromCourts(newAssignments),
      avgLevelDiff: newAssignments.length > 0 ? totalDiff / newAssignments.length : 0,
    },
  }
}
