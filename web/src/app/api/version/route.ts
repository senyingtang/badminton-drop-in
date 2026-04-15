import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/** 用於確認前端是否已部署到最新版本（避免快取/未部署造成誤判） */
export async function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    ''

  return NextResponse.json({
    sha,
    sha_short: sha ? sha.slice(0, 7) : '',
    env: process.env.VERCEL_ENV || process.env.NODE_ENV || '',
  })
}

