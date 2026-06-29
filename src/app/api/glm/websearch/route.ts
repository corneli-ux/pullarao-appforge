import { NextResponse } from 'next/server'
import { getAuthenticatedUserId } from '@/lib/auth-mobile'
import ZAI from 'z-ai-web-dev-sdk'

/**
 * Web search proxy — students search the web via GLM's web_search function.
 */

let _zaiPromise: Promise<ZAI> | null = null
function getClient() { if (!_zaiPromise) _zaiPromise = ZAI.create(); return _zaiPromise }

export async function POST(req: Request) {
  const userId = await getAuthenticatedUserId(req)
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  if (!process.env.GLM_API_KEY) return NextResponse.json({ error: 'Platform not configured' }, { status: 503 })

  const body = await req.json().catch(() => null)
  if (!body?.query) return NextResponse.json({ error: 'query required' }, { status: 400 })

  try {
    const client = await getClient()
    const results = await client.functions.invoke('web_search', {
      query: body.query,
      num: body.num || 10,
      recency_days: body.recency_days || 30,
    } as any)
    return NextResponse.json({ results })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
