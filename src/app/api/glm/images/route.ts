import { NextResponse } from 'next/server'
import { getAuthenticatedUserId } from '@/lib/auth-mobile'

export const runtime = 'nodejs'
export const maxDuration = 60

/** POST /api/glm/images  — image generation proxy */
export async function POST(req: Request) {
  const userId = await getAuthenticatedUserId(req)
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const apiKey = process.env.GLM_API_KEY
  const baseUrl = process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/'
  if (!apiKey) return NextResponse.json({ error: 'Platform not configured' }, { status: 503 })

  const body = await req.json().catch(() => null)
  if (!body?.prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 })

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ prompt: body.prompt, size: body.size || '1024x1024' }),
  })
  if (!res.ok) {
    const t = await res.text()
    return NextResponse.json({ error: `GLM error ${res.status}: ${t.slice(0, 300)}` }, { status: 502 })
  }
  const data = await res.json()
  const base64 = data.data?.[0]?.base64
  if (!base64) return NextResponse.json({ error: 'No image returned' }, { status: 502 })
  return NextResponse.json({ base64, size: body.size || '1024x1024' })
}
