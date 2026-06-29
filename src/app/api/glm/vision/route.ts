import { NextResponse } from 'next/server'
import { getAuthenticatedUserId } from '@/lib/auth-mobile'

export const runtime = 'nodejs'
export const maxDuration = 60

/** POST /api/glm/vision — vision analysis proxy */
export async function POST(req: Request) {
  const userId = await getAuthenticatedUserId(req)
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const apiKey = process.env.GLM_API_KEY
  const baseUrl = process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/'
  const model = process.env.GLM_MODEL || 'glm-5.2'
  if (!apiKey) return NextResponse.json({ error: 'Platform not configured' }, { status: 503 })

  const body = await req.json().catch(() => null)
  if (!body?.prompt || !body?.imageUrl) {
    return NextResponse.json({ error: 'prompt and imageUrl required' }, { status: 400 })
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: body.prompt },
          { type: 'image_url', image_url: { url: body.imageUrl } },
        ],
      }],
      thinking: { type: 'disabled' },
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    return NextResponse.json({ error: `GLM error ${res.status}: ${t.slice(0, 300)}` }, { status: 502 })
  }
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content ?? ''
  return NextResponse.json({ text })
}
