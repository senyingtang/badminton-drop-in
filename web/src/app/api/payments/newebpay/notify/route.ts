import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST() {
  return new NextResponse(JSON.stringify({ ok: false, error: 'PROVIDER_NOT_CONFIGURED' }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  })
}

