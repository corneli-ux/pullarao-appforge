import { NextResponse } from 'next/server'
import { getAuthenticatedUserId } from '@/lib/auth-mobile'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GLM text-to-speech proxy.
 *
 * ARCHITECTURE NOTE (for students):
 * This endpoint returns raw audio bytes (not JSON) from GLM. We read those
 * bytes into a Buffer and re-encode as base64 so they fit cleanly inside a
 * JSON response the browser can play back with an <audio> element — the
 * same trick used for `/api/glm/images`, which returns base64 image data
 * instead of a binary response. Base64-in-JSON is a common pattern when you
 * want one uniform response shape across every endpoint on your API.
 */
export async function POST(req: Request) {
  const userId = await getAuthenticatedUserId(req)
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const apiKey = process.env.GLM_API_KEY
  const baseUrl = process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/'
  if (!apiKey) return NextResponse.json({ error: 'Platform not configured' }, { status: 503 })

  const body = await req.json().catch(() => null)
  if (!body?.text) return NextResponse.json({ error: 'text required' }, { status: 400 })

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GLM_TTS_MODEL || 'cogtts',
      input: body.text,
      voice: body.voice || 'tongtong',
      response_format: body.format || 'mp3',
      speed: body.speed ?? 1.0,
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    return NextResponse.json({ error: `GLM error ${res.status}: ${t.slice(0, 300)}` }, { status: 502 })
  }
  const arrayBuffer = await res.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  return NextResponse.json({ audioBase64: base64, format: body.format || 'mp3' })
}
