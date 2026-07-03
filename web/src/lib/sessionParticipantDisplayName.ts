/** 供 UI 顯示球友名稱（排組、名單、未繳費提醒等）；優先報名暱稱，LINE 名稱僅 fallback。 */
export type SessionParticipantDisplayNameInput = {
  id?: string | null
  session_participant_id?: string | null
  session_display_name?: string | null
  guest_display_name?: string | null
  guest_player_code?: string | null
  /** RPC `list_session_participants_for_host` 的 players.display_name */
  display_name?: string | null
  players?: { display_name?: string | null } | null
}

function nullifTrim(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function participantIdShort(participant: SessionParticipantDisplayNameInput): string {
  const raw = participant.session_participant_id ?? participant.id
  if (typeof raw !== 'string' || !raw) return '未知'
  return raw.slice(0, 8)
}

/**
 * 顯示名稱優先序：
 * 1. session_display_name（報名當下填寫）
 * 2. guest_display_name（代報名）
 * 3. players.display_name / display_name
 * 4. guest_player_code
 * 5. participant id 短碼
 */
export function getSessionParticipantDisplayName(
  participant: SessionParticipantDisplayNameInput,
): string {
  return (
    nullifTrim(participant.session_display_name) ??
    nullifTrim(participant.guest_display_name) ??
    nullifTrim(participant.players?.display_name) ??
    nullifTrim(participant.display_name) ??
    nullifTrim(participant.guest_player_code) ??
    participantIdShort(participant)
  )
}
