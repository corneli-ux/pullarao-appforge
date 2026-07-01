import { NextResponse } from 'next/server'
import { getAuthenticatedUserId } from '@/lib/auth-mobile'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GLM speech-to-text (ASR) proxy.
 *
 * ARCHITECTURE NOTE (for students):
 * This is the one GLM endpoint that takes `multipart/form-data` instead of
 * JSON, because it's uploading a binary audio file rather than sending text.
 * The browser's <input type="file"> + FormData API produces multipart data
 * natively, so the client here doesn't need to do any base64 conversion —
 * it just appends the File object straight into a FormData and we forward
 * that same FormData on to GLM. Compare this with `/api/glm/vision`, which
 * instead expects an already-hosted image URL — two different ways of
 * getting binary media to an AI API (upload vs. reference-by-URL).
 */
export async function POST(req: Request) {
  const userId = await getAuthenticatedUserId(req)
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const apiKey = process.env.GLM_API_KEY
  const baseUrl = process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/'
  if (!apiKey) return NextResponse.json({ error: 'Platform not configured' }, { status: 503 })

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file (multipart) required' }, { status: 400 })
  }

  const forward = new FormData()
  forward.append('file', file, file.name || 'audio.wav')
  forward.append('model', process.env.GLM_ASR_MODEL || 'glm-asr')

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: forward,
  })
  if (!res.ok) {
    const t = await res.text()
    return NextResponse.json({ error: `GLM error ${res.status}: ${t.slice(0, 300)}` }, { status: 502 })
  }
  const data = await res.json()
  return NextResponse.json({ text: data.text ?? '' })
}
