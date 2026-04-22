import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const shareCode = (url.searchParams.get('code') || '').trim()
  if (!shareCode) return NextResponse.json({ ok: false, error: 'missing_code' }, { status: 400 })

  const supabase = await createClient()

  // 若已登入，帶 viewer player id 讓回傳名單可標示「您」
  const {
    data: { user },
  } = await supabase.auth.getUser()
  let viewerPlayerId: string | null = null
  if (user?.id) {
    const { data: p } = await supabase.from('players').select('id').eq('auth_user_id', user.id).maybeSingle()
    viewerPlayerId = (p?.id as string) || null
  }

  const { data, error } = await supabase.rpc('get_public_session_roster_by_share_code', {
    p_share_code: shareCode,
    p_viewer_player_id: viewerPlayerId,
  })
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, rows: data || [] })
}

