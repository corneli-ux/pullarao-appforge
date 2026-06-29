import { NextResponse } from 'next/server'
import { getAuthenticatedUserId } from '@/lib/auth-mobile'
import ZAI from 'z-ai-web-dev-sdk'

/**
 * Image generation proxy — students describe an image, platform calls GLM
 * image API with the platform's key, returns base64 PNG.
 */

let _zaiPromise: Promise<ZAI> | null = null
function getClient() { if (!_zaiPromise) _zaiPromise = ZAI.create(); return _zaiPromise }

export async function POST(req: Request) {
  const userId = await getAuthenticatedUserId(req)
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  if (!process.env.GLM_API_KEY) return NextResponse.json({ error: 'Platform not configured' }, { status: 503 })

  const body = await req.json().catch(() => null)
  if (!body?.prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 })

  try {
    const client = await getClient()
    const response = await client.images.generations.create({
      prompt: body.prompt,
      size: body.size || '1024x1024',
    })
    const base64 = response.data?.[0]?.base64
    if (!base64) return NextResponse.json({ error: 'No image returned' }, { status: 502 })
    return NextResponse.json({ base64, size: body.size || '1024x1024' })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
