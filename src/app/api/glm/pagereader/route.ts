import { NextResponse } from 'next/server'
import { getAuthenticatedUserId } from '@/lib/auth-mobile'
import ZAI from 'z-ai-web-dev-sdk'

/**
 * Page reader proxy — students paste a URL, GLM reads & extracts content.
 */

let _zaiPromise: Promise<ZAI> | null = null
function getClient() { if (!_zaiPromise) _zaiPromise = ZAI.create(); return _zaiPromise }

export async function POST(req: Request) {
  const userId = await getAuthenticatedUserId(req)
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  if (!process.env.GLM_API_KEY) return NextResponse.json({ error: 'Platform not configured' }, { status: 503 })

  const body = await req.json().catch(() => null)
  if (!body?.url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  try {
    const client = await getClient()
    const result = await client.functions.invoke('page_reader', { url: body.url } as any)
    return NextResponse.json({ result })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
