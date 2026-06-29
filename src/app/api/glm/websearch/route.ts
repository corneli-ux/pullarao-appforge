import { NextResponse } from 'next/server'
import { getAuthenticatedUserId } from '@/lib/auth-mobile'

export const runtime = 'nodejs'
export const maxDuration = 60

/** POST /api/glm/websearch — web search proxy via GLM function call */
export async function POST(req: Request) {
  const userId = await getAuthenticatedUserId(req)
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const apiKey = process.env.GLM_API_KEY
  const baseUrl = process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/'
  if (!apiKey) return NextResponse.json({ error: 'Platform not configured' }, { status: 503 })

  const body = await req.json().catch(() => null)
  if (!body?.query) return NextResponse.json({ error: 'query required' }, { status: 400 })

  // GLM exposes web_search as a function endpoint
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/tools/web-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: body.query,
      num: body.num || 10,
      recency_days: body.recency_days || 30,
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    return NextResponse.json({ error: `GLM error ${res.status}: ${t.slice(0, 300)}` }, { status: 502 })
  }
  const data = await res.json()
  return NextResponse.json({ results: data })
}
